# @btravstack/entity

**A domain-entity builder for [TypeScript](https://www.typescriptlang.org/), on [zod](https://zod.dev) v4 — branded fields, immutable data, sealed construction, and `Result` instead of throws.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-blue?logo=typescript)](https://www.typescriptlang.org/)

## What an entity is, and why this exists

An entity is simultaneously four things: a **type** your domain code programs
against, a **validator** for data crossing a trust boundary, a **value with
behaviour** (methods, invariants), and something that **nests inside other
entities**. Most tools in the TypeScript ecosystem give you two or three of
these at once — a validation library gives you a type and a validator; a
plain class gives you a type and behaviour — and stitching the rest together
by hand is exactly the kind of repetitive, error-prone work a library should
absorb.

[Effect's `Schema.Class`](https://www.effect.website/docs/v3/schema/classes)
gets all four right at once, and is the closest existing prior art. This
package targets the same shape of solution on top of **zod v4** and
**[Standard Schema](https://standardschema.dev)**, with entry points named for
the use case they serve (`create`, `update`, `make`, `decode`) instead of one
generic `decode`.

```ts
import { z } from "zod";
import { Entity } from "@btravstack/entity";

const OrgId = z.uuid().brand("OrgId");
const Slug = z.string().min(1).brand("Slug");
const DisplayName = z.string().min(1).brand("DisplayName");
const Instant = z.iso.datetime().brand("Instant");

class Organization extends Entity("Organization")(
  { id: OrgId, slug: Slug, name: DisplayName, createdAt: Instant },
  {
    generated: ["id", "createdAt"],
    immutable: ["id", "createdAt", "slug"],
    invariants: (d) => (d.name.length > 0 ? [] : ["name must not be empty"]),
  },
) {
  get greeting(): string {
    return `Welcome, ${this.name}`;
  }
}
```

That one declaration gives you:

- a **type** — `Organization`'s data fields, read-only, each carrying a
  branded (nominal) type;
- **validators** — `Organization.encoded` / `.decoded` / `.createInput` /
  `.updateInput`, four plain `ZodObject`s a contract layer can hand straight
  to a JSON Schema converter, plus `Organization.instance` for decoding
  straight to a class instance;
- **behaviour** — the class body (`greeting` above) plus built-in
  `update`/`encode`/`toJSON`/`equals`;
- **composability** — `Organization.instance` nests inside `z.object({...})`
  or `z.array(...)` and decodes to a real `Organization`, so an aggregate can
  hold other entities without losing their behaviour.

Every fallible operation returns an
[`unthrown`](https://github.com/btravstack/unthrown) `Result<T, InvalidEntity>`
instead of throwing — call `.getOrThrow()`, `.match()`, or any other `Result`
combinator on it.

## Install

```sh
pnpm add @btravstack/entity zod unthrown @unthrown/standard-schema
```

`zod`, `unthrown` and `@unthrown/standard-schema` are **peer dependencies**
(see [Peer dependencies](#peer-dependencies) for why) — install all three
alongside `@btravstack/entity`.

## Quick start

```ts
import { z } from "zod";
import { Entity } from "@btravstack/entity";

const OrgId = z.uuid().brand("OrgId");
const Slug = z.string().min(1).brand("Slug");
const DisplayName = z.string().min(1).brand("DisplayName");
const Instant = z.iso.datetime().brand("Instant");

class Organization extends Entity("Organization")(
  { id: OrgId, slug: Slug, name: DisplayName, createdAt: Instant },
  {
    generated: ["id", "createdAt"],
    immutable: ["id", "createdAt", "slug"],
  },
) {}

// A create use case: the caller supplies request fields, the domain supplies
// identity and the timestamp from injected sources (never `Date.now()`/`crypto.randomUUID()`
// inline — see "No I/O" below).
const org = Organization.create(
  {
    slug: "acme" as z.infer<typeof Slug>,
    name: "Acme" as z.infer<typeof DisplayName>,
  },
  {
    id: "0199b1f4-1b1e-7000-8000-000000000000" as z.infer<typeof OrgId>,
    createdAt: "2026-08-06T09:00:00Z" as z.infer<typeof Instant>,
  },
).getOrThrow();

org.slug; // "acme" — typed, read-only
org.update({ name: "Acme Inc" as z.infer<typeof DisplayName> }); // a NEW entity; Result<Organization, InvalidEntity>
org.encode(); // the stored data — never carries `_tag`
org.equals(otherOrg); // true when both are `Organization` and their encoded data is equal

// A row mapper, or an event fold's final step:
Organization.make(rowFromDatabase);

// A full untrusted payload — an import, a replayed integration event:
Organization.decode(rawJson);
```

`new Organization(...)` does not compile — construction is **sealed**; see
[Sealed construction](#sealed-construction).

## The five schema members

```ts
Organization.encoded; // ZodObject — full wire object; decode() accepts
Organization.decoded; // ZodObject — stored state and response body; make() accepts
Organization.createInput; // ZodObject — encoded minus generated
Organization.updateInput; // ZodObject — decoded minus immutable, partial
Organization.instance; // ZodType<Organization> — decodes to a class instance
```

**Contracts compose the four `ZodObject`s. Domain code composes `instance`.**
This is the rule the whole design turns on, and it comes from a real
constraint in zod's schema-to-JSON-Schema conversion:

A schema that carries a `.transform()` — which is what turns parsed data into
a class instance — **has no output representation**. `instance` does exactly
that (it decodes to `Organization`, not to plain data), so:

```ts
z.toJSONSchema(Organization.decoded, { io: "output" }); // ✓ real JSON Schema
z.toJSONSchema(Organization.instance, { io: "output" }); // ✗ throws — by design
```

The four plain `ZodObject`s (`encoded`, `decoded`, `createInput`,
`updateInput`) generate JSON Schema in **both** `"input"` and `"output"`
directions, so an HTTP contract layer can hand them straight to a schema
converter with no hand-written omit lists:

```ts
const CreateBody = Organization.createInput;
const UpdateBody = Organization.updateInput;
const ResponseBody = Organization.decoded;
```

`instance` is the composable surface for domain code — the only member that
produces real class instances:

```ts
const Aggregate = z.object({
  organization: Organization.instance,
  members: z.array(Member.instance),
});
Aggregate.parse(raw).organization instanceof Organization; // true
```

`instance` is also a [Standard Schema](https://standardschema.dev) — the
class itself carries a non-enumerable `~standard` property delegating to
`instance`, so `@unthrown/standard-schema`'s `fromSchema(Organization)`
returns a `(raw) => Result<Organization, Issues>` validator directly:

```ts
import { fromSchema } from "@unthrown/standard-schema";

const parseOrg = fromSchema(Organization);
parseOrg(raw).getOrThrow(); // Organization
```

It does **not** make `z.object({ owner: Organization })` work — zod requires
a real `ZodType`, so nesting always goes through `Organization.instance`.

## The four entry points

| Entry point                       | Input                                   | Use                                          |
| --------------------------------- | --------------------------------------- | -------------------------------------------- |
| `Entity.create(input, generated)` | caller fields + domain-generated fields | a create use case                            |
| `entity.update(patch)`            | a partial of the mutable fields         | an update use case                           |
| `Entity.make(state)`              | full stored state                       | row mappers, event folds                     |
| `Entity.decode(raw)`              | full encoded payload                    | untrusted input already carrying every field |

The types and the schemas are derived from the same declarations, so the
rules are compile-time facts:

```ts
Organization.create({ slug, name }, { id: ids.next(), createdAt: clock.now() });
Organization.create({ slug, name, id }, generated); // ✗ id is generated

org.update({ name }); // ✓ Result<Organization, InvalidEntity>
org.update({ id }); // ✗ id is immutable
```

**Why `create` takes the generated values rather than producing them.**
Generating a uuid or reading the clock is I/O; this package does none of it.
The use case supplies `id`/`createdAt` (or whatever else is `generated`) from
an injected id source and clock, so the entity stays pure and a test passes
fixed values instead of stubbing `crypto.randomUUID`/`Date.now`. What stays in
the domain is the _rule_ — which fields the domain owns, and that a caller may
never send them.

**Why `decode` survives alongside `create`/`update`/`make`.** `create` and
`update` cover the use-case paths and `make` covers rehydration from state
that's already valid shape (a database row, a folded event stream). `decode`
remains for a full encoded payload from an untrusted source that legitimately
carries every field: an import, a replayed integration event, an entity
nested inside another entity's payload (`instance` runs `decode` under the
hood, which is why nesting works).

`update` returns a **new** entity — data is immutable — and re-runs
`invariants`, so a patch where every individual field is valid but the
combination is not still fails.

`decode(x.encode())` does **not** round-trip for an entity with a `decoded`
option (see below) — a consumed field like a raw secret is absent from
`encode()` by design:

```ts
ApiKey.decode(apiKey.encode()); // ✗ Err(InvalidEntity) — `secret` is required and absent
ApiKey.make(apiKey.encode()); // ✓ Ok(ApiKey)
```

## `generated` and `immutable`

```ts
{
  generated: ["id", "createdAt"], // omitted from createInput; a caller may never send them
  immutable: ["id", "createdAt", "slug"], // omitted from updateInput; update() drops them even if smuggled in at runtime
}
```

Both are **arrays of field names**, and both are keyed off `keyof S`
(`generated`) or `keyof decoded` (`immutable`), so a typo — `immutable:
["slugg"]` — is a compile error, not a silently-mutable field.

## The `decoded: { omit, add }` split

With no `decoded` option, the stored ("decoded") shape is identical to the
wire ("encoded") shape. When they differ — a secret that's consumed but never
kept, a value that's derived rather than stored — `decoded.omit` drops fields
and `decoded.add`, via the curried `add` helper, declares computed ones:

```ts
import { Entity, add } from "@btravstack/entity";

const Secret = z.string().min(16).brand("Secret");
const Fingerprint = z.string().length(12).brand("Fingerprint");

class ApiKey extends Entity("ApiKey")(
  { id: ApiKeyId, orgId: OrgId, secret: Secret, createdAt: Instant },
  {
    generated: ["id", "createdAt"],
    immutable: ["id", "orgId", "createdAt"],
    decoded: {
      omit: ["secret"],
      add: add({ fingerprint: Fingerprint })((e) => ({
        fingerprint: e.secret.slice(0, 12) as z.infer<typeof Fingerprint>,
      })),
    },
  },
) {}
```

`add(fields)(fn)` is two calls: the first fixes the added fields' schemas, the
second declares how to produce them. `e`, the parameter of the second call, is
the **encoded** shape — so an omitted field like `secret` is still visible to
compute from, even though it never reaches `decoded` — and the callback's
return type is checked against the declared fields, so `fingerprint` must
already be branded `Fingerprint`, not a bare `string`.

`create` and `decode` re-validate **only the fields `add` produced**, never
the kept fields (those were already validated once, against `encoded`, and
re-running a field schema that carries a non-idempotent `.transform()` would
apply it twice). `add`'s function necessarily returns an unchecked `as Brand`
cast — constructing a branded value has no other spelling — and re-validating
its output is what makes that cast honest: if `add` ever produces data its own
declared schema would reject, that is a **defect** (a bug in domain code), not
ordinary bad input. See [Error handling](#error-handling).

## `invariants`

An invariant is a rule spanning two or more fields that no single field's
schema can express:

```ts
class Organization extends Entity("Organization")(
  { id: OrgId, name: DisplayName, createdAt: Instant, trialEndsAt: Instant },
  {
    generated: ["id", "createdAt"],
    immutable: ["id", "createdAt"],
    invariants: (d) =>
      d.trialEndsAt > d.createdAt
        ? []
        : ["trialEndsAt must be after createdAt"],
  },
) {}
```

`invariants` receives the stored (`decoded`) data and returns the messages of
the broken rules — an empty array means valid, and it can return **more than
one** message, so a caller violating two rules at once learns about both:

```ts
invariants: (d) => [
  ...(d.trialEndsAt > d.createdAt
    ? []
    : ["trialEndsAt must be after createdAt"]),
  ...(d.seatLimit >= d.seatsUsed
    ? []
    : ["seatsUsed must not exceed seatLimit"]),
];
```

It runs before the instance exists, on **every** entry point — `create`,
`update`, `make` and `decode`. Because data is _deeply_ immutable once
constructed — frozen values, not just locked bindings, see
[Immutability](#immutability) — a rule that holds at construction holds for
the instance's entire lifetime: an entity that rejects three tags cannot be
pushed into holding three tags afterwards.

## `equals`

Two entities are equal when they are instances of the **same entity** and
their **encoded data is deep-equal**:

```ts
const a = Organization.make(state).getOrThrow();
const b = Organization.make(state).getOrThrow();
a === b; // false — different instances
a.equals(b); // true — same encoded data

a.equals(a.update({ name: other }).getOrThrow()); // false — data differs
someOrg.equals(someApiKey); // false — different entities, even with identical field values
```

The comparison serialises both sides' `encode()` output, which is what makes
two entities holding **equal arrays** compare equal — a naive
reference-equality check gets this wrong, because arrays compare by
reference even when their contents match.

## `_tag` is runtime-only

Every entity instance carries a non-enumerable `_tag` — the string passed to
`Entity(tag)` — installed for pattern matching with `unthrown`'s `P.tag(...)`:

```ts
import { match, P } from "unthrown";

match(member)
  .with(P.tag("User"), (u) => u.email)
  .with(P.tag("ServiceAccount"), (s) => s.label)
  .exhaustive();
```

**It never reaches the wire.** It is absent from every schema, from
`encode()`, `toJSON()`, `JSON.stringify(entity)`, `Object.keys(entity)` and
`{ ...entity }`. That has a direct consequence for unions: **a union that must
survive a JSON round-trip cannot discriminate on `_tag`** — it isn't there
after serialisation. Declare the discriminant as an ordinary domain field
instead:

```ts
class User extends Entity("User")({
  kind: z.literal("user"),
  id: UserId,
  email: Email,
}) {}
class ServiceAccount extends Entity("ServiceAccount")({
  kind: z.literal("service_account"),
  id: SvcId,
  label: Label,
}) {}

const Member = z.discriminatedUnion("kind", [
  User.decoded,
  ServiceAccount.decoded,
]);
```

This parses both members, rejects an unknown discriminant, and generates JSON
Schema in both directions with one branch per member — because `kind` is a
real field on a real `ZodObject`, not framework metadata layered on top. A
union of the `instance` surfaces decodes to the right class:

```ts
const Instances = z.union([User.instance, ServiceAccount.instance]);
Instances.parse(userRow) instanceof User; // true
```

and `_tag` still serves in domain code, exactly as in the `match` example
above — the two mechanisms solve different problems. A brand is _per field_
and _type-only_ (it disappears at runtime); the tag is _per entity_ and
_runtime-present_, which is what makes it matchable.

## Error handling

Every fallible entry point returns `Result<T, InvalidEntity>`:

```ts
class InvalidEntity extends TaggedError("InvalidEntity")<{
  readonly entity: string;
  readonly issues: SchemaIssues; // readonly StandardSchemaV1.Issue[]
}> {}
```

| Failure                                             | Channel                              | Why                                                                                         |
| --------------------------------------------------- | ------------------------------------ | ------------------------------------------------------------------------------------------- |
| schema validation (a field fails its own zod check) | `InvalidEntity`, issue has a `path`  | bad input, expected                                                                         |
| a broken `invariants` rule                          | `InvalidEntity`, issue has no `path` | bad input, expected — the rule spans the entity, not one field                              |
| `add`'s output failing its own declared schema      | **defect**                           | `add` is pure, total, and typed — a violation is a bug in domain code, not bad caller input |
| any of the above, reached through `instance`        | zod issues, paths composed           | a nested field failure reports the full path                                                |

`issues` is carried **structured**, exactly as the validator produced it, not
rendered into prose — so keying a field-level error response is a `path`
lookup rather than a string parse. A schema issue has the failing field's
path (`["tags", 0]`, `["address", "city"]`); an `invariants` violation has
none, which is what distinguishes a whole-entity rule from a field complaint.

```ts
ApiKey.decode({ ...raw, secret: "short" });
// Err(InvalidEntity {
//   entity: "ApiKey",
//   issues: [{ path: ["secret"], message: "Too small: expected string to have >=16 characters" }],
// })

Trial.decode(brokenRow);
// Err(InvalidEntity {
//   entity: "Trial",
//   issues: [{ message: "trialEndsAt must be after createdAt" }], // an invariant: no path
// })

// through `instance`, paths compose with the position of the nested entity:
z.object({ owner: Organization.instance }).safeParse({ owner: { slug: "" } });
// issues: [{ path: ["owner", "slug"], message: "Too small: …" }]
z.object({ owner: Organization.instance }).safeParse({ owner: brokenRow });
// issues: [{ path: ["owner"], message: "trialEndsAt must be after createdAt" }]
```

A `Defect` — the unexpected-failure channel `unthrown`'s `Result` reserves
separately from `E` — is never folded into an ordinary validation issue, even
through `instance`: an unmodelled bug in domain code stays distinguishable
from bad caller input all the way to the edge.

## Sealed construction

`new SomeEntity(...)` does not compile, from outside the package or inside a
consumer's code:

```ts
new Organization({ id, slug, name, createdAt }); // ✗ compile error
```

The constructor is closed by a module-private `unique symbol` the package
never exports, so no outside code can produce a value satisfying it — every
instance is built through `create`/`update`/`make`/`decode`, which means
`invariants` has run and the stored data is exactly the shape `decoded`
describes. This is a compile-time-only mechanism (there is no runtime
constructor guard to keep in sync, and none is needed for the type-level
guarantee it gives you), and it survives a published build: the package's
`dist/*.d.ts` carries the seal, verified by this repository's own CI against
the compiled package, not just the source.

## Immutability

Immutability is **deep**, and enforced twice. Each data field is installed
with `Object.defineProperty(..., { writable: false })` at construction _and_
its value is deep-frozen; the instance type is `DeepReadonly<...>`, not a
shallow `Readonly<...>`. So mutation is a compile error first, and a
`TypeError` only if a consumer casts around the type system:

```ts
org.slug = otherSlug; // ✗ compile error — read-only property
(org as never as Record<string, unknown>).slug = "hacked"; // TypeError: Cannot assign to read only property 'slug'

// on a `Team` declared with `tags: z.array(Tag)` and `address: Address`
team.tags.push(tag); // ✗ compile error — tags is `readonly Tag[]`
(team.tags as never as string[]).push("hacked"); // TypeError: object is not extensible
team.address.city = "Paris"; // ✗ compile error — nested objects are readonly too
```

Locking the binding alone would not be enough: `writable: false` stops
`team.tags = [...]` but not `team.tags.push(...)`, and a shallow `Readonly<D>`
types an array field as a mutable `Tag[]`, because `z.infer` of
`z.array(Tag)` is `Tag[]`. Both halves matter, because the second one is what
lets `invariants` mean anything after construction: an entity that rejects
three tags at every entry point cannot be pushed into holding three tags
afterwards.

The deep freeze covers the plain data zod produces — arrays, objects,
records, tuples, all the way down — and freezes a `Date` (a partial
guarantee: its timestamp lives in an internal slot, so `setTime` still
works). It deliberately leaves `Map`, `Set` and anything a `z.custom(...)` or
`z.instanceof(...)` field hands through untouched, since freezing those is
either ineffective (a frozen `Map` still accepts `.set`) or destructive. A
field whose schema yields a live mutable object is outside the guarantee.

`encode()` and `toJSON()` still return the plain `decoded` shape: they build
a fresh object, so assigning to _its_ keys is fine and mappers keep working
unchanged (the values inside it are the entity's own, and stay frozen).

`Object.freeze(this)` is **not** used, and cannot be: a subclass's field
initialisers run after `super()` returns, so the instance itself has to stay
extensible. Freezing the field values individually leaves that intact:

```ts
class OrgWithCache extends Organization {
  cachedSummary = "";
}
const org = OrgWithCache.decode(raw).getOrThrow();
org.cachedSummary = "computed"; // ✓ still writable — it isn't declared data
org.encode(); // does NOT include cachedSummary — encode() projects only the declared schema's keys
```

## Helper types

Four generic type-level helpers name each schema by reading it off an entity
class, instead of re-declaring the shape by hand:

```ts
import type { CreateInput, Decoded, Encoded, Patch } from "@btravstack/entity";

type OrgWire = Encoded<typeof Organization>; // what the wire sends — mapper/request signatures
type OrgState = Decoded<typeof Organization>; // what make() takes — repository signatures
type OrgCreate = CreateInput<typeof Organization>; // what create() takes from a caller
type OrgPatch = Patch<typeof Organization>; // what update() takes
```

## No I/O, by design

This package reads no clock and generates no id. `create`'s `generated`
parameter, not an internal `crypto.randomUUID()`/`Date.now()` call, is how a
domain-generated value reaches the entity — the _rule_ (which fields the
domain owns, and that a caller may never supply them) lives in the entity
declaration; the _values_ come from whatever your application injects (a
clock port, an id generator), which keeps the entity pure and your tests able
to pass fixed values instead of stubbing globals.

## Peer dependencies

`zod`, `unthrown` and `@unthrown/standard-schema` are **peer dependencies**,
not bundled dependencies. `@btravstack/entity` hands back real `ZodObject`s
and real `Result`s built from _your_ copies of those packages — if this
package pinned its own instead, a consumer would end up with two copies of
`zod` (or `unthrown`) in the dependency tree, and identity checks like
`result instanceof Result`, `schema instanceof z.ZodType`, or composing this
package's `instance` schema into the consumer's own `z.object({...})` can
silently misbehave across the module boundary between two copies of the same
package.

## Development

This is a pnpm + turbo monorepo with a single package, `packages/entity`
(published as `@btravstack/entity`).

```sh
git clone https://github.com/btravstack/entity.git
cd entity
pnpm install
pnpm build        # tsdown, dual CJS/ESM + .d.ts
pnpm test          # vitest
pnpm typecheck      # tsc --noEmit, including the .test-d.ts compile-error assertions
pnpm lint            # oxlint
pnpm format          # oxfmt
```

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the full contribution gate and
the commit/changeset conventions.

## License

[MIT](./LICENSE) © Benoit TRAVERS
