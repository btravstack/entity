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
the use case they serve (`create`, `update`, `make`, `make`) instead of one
generic `make`.

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
- **validators** — `Organization.input` / `.output` / `.createInput` /
  `.updateInput`, four plain `ZodObject`s a contract layer can hand straight
  to a JSON Schema converter, while the class itself is a zod schema that
  parses straight to an instance;
- **behaviour** — the class body (`greeting` above) plus built-in
  `update`/`encode`/`toJSON`/`equals`;
- **composability** — `Organization` is a field like any other, so an
  aggregate is itself an entity rather than a bare schema, and the entities
  inside it keep their behaviour.

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

// Bind the effect sources once, at the composition root. The entity itself
// never reads a clock or generates an id — see "No I/O" below.
const createOrg = Organization.factory({
  id: () => ids.next(),
  createdAt: () => clock.now(),
});

// A create use case: the caller supplies only request fields.
const org = createOrg({
  slug: "acme" as z.infer<typeof Slug>,
  name: "Acme" as z.infer<typeof DisplayName>,
}).getOrThrow();

org.slug; // "acme" — typed, read-only
org.update({ name: "Acme Inc" as z.infer<typeof DisplayName> }); // a NEW entity; Result<Organization, InvalidEntity>
org.toJSON(); // the stored data — never carries `_tag`
org.equals(otherOrg); // true when both are `Organization` and their stored data is equal

// A row mapper, or an event fold's final step:
Organization.make(rowFromDatabase);

// A full untrusted payload — an import, a replayed integration event:
Organization.make(rawJson);
```

`new Organization(...)` does not compile — construction is **sealed**; see
[Sealed construction](#sealed-construction).

## The four schema members, and the class itself

```ts
Organization.input; // ZodObject — everything make() accepts
Organization.output; // ZodObject — stored state and response body
Organization.createInput; // ZodObject — input minus generated
Organization.updateInput; // ZodObject — output minus immutable, partial

Organization; // …is itself a zod schema, parsing to a class instance
```

**Contracts compose the four `ZodObject`s. Domain code composes the class.**
This is the rule the whole design turns on, and it comes from a real
constraint in zod's schema-to-JSON-Schema conversion:

A schema that carries a `.transform()` — which is what turns parsed data into
a class instance — **has no output representation**. The class does exactly
that (it parses to `Organization`, not to plain data), so:

```ts
z.toJSONSchema(Organization.output, { io: "output" }); // ✓ real JSON Schema
z.toJSONSchema(Organization, { io: "output" }); // ✗ throws — by design
```

The four plain `ZodObject`s (`input`, `output`, `createInput`,
`updateInput`) generate JSON Schema in **both** `"input"` and `"output"`
directions, so an HTTP contract layer can hand them straight to a schema
converter with no hand-written omit lists:

```ts
const CreateBody = Organization.createInput;
const UpdateBody = Organization.updateInput;
const ResponseBody = Organization.output;
```

The class is the composable surface for domain code — the only one that
produces real class instances. It is a valid **field**, so an aggregate is an
entity in its own right, with the invariants, immutability and entry points
that implies:

```ts
class Order extends Entity("Order")({
  id: OrderId,
  customer: Customer,
  watchers: z.array(Customer),
}) {}

const order = Order.make(row).getOrThrow();
order.customer instanceof Customer; // true
order.customer.shout; // the nested entity keeps its computed fields
order.customer._tag; // and its tag, for `P.tag(...)` matching
```

An invariant can span the outer entity and a nested one, a nested failure
reports the full path (`["customer", "name"]`), and `JSON.stringify` walks the
whole tree down to plain data.

The same class composes anywhere zod takes a schema:

```ts
z.object({ organization: Organization });
z.array(Organization);
z.optional(Organization); // the function forms — see below
```

and, being a zod schema, it is a [Standard Schema](https://standardschema.dev),
so it hands straight to a router, a form library, or
`@unthrown/standard-schema`'s `fromSchema`:

```ts
import { fromSchema } from "@unthrown/standard-schema";

const parseOrg = fromSchema(Organization);
parseOrg(raw).getOrThrow(); // Organization
```

**The class carries zod's slots, not zod's methods.** That is deliberate:
inheriting the full `ZodType` surface would put a throwing `.parse()` on every
entity, beside the `make` that returns a `Result` — the exact thing this
package exists to avoid. So use `make` to parse directly, and zod's _function_
forms to wrap:

```ts
Organization.make(raw); // ✓ Result<Organization, InvalidEntity>
z.optional(Organization); // ✓
Organization.parse(raw); // ✗ does not exist
Organization.optional(); // ✗ does not exist
```

## The three entry points

| Entry point                   | Input                           | Use                                                                |
| ----------------------------- | ------------------------------- | ------------------------------------------------------------------ |
| `Entity.factory(gens)(input)` | caller fields only              | a create use case                                                  |
| `entity.update(patch)`        | a partial of the mutable fields | an update use case                                                 |
| `Entity.make(data)`           | everything `input` describes    | a row, a folded event stream, an untrusted import, a nested entity |

`create` is the one reached through a factory, because it is the only one that
needs values the domain generates rather than receives.

The types and the schemas are derived from the same declarations, so the
rules are compile-time facts:

```ts
const createOrg = Organization.factory({
  id: () => ids.next(),
  createdAt: () => clock.now(),
});

createOrg({ slug, name }); // ✓
createOrg({ slug, name, id }); // ✗ id is generated

org.update({ name }); // ✓ Result<Organization, InvalidEntity>
org.update({ id }); // ✗ id is immutable
```

**Why `create` goes through a factory rather than producing the values itself.**
Generating a uuid or reading the clock is I/O; this package does none of it.
The factory is built where your ports already live, so the entity stays pure
and a test binds fixed generators instead of stubbing
`crypto.randomUUID`/`Date.now`. What stays in
the domain is the _rule_ — which fields the domain owns, and that a caller may
never send them.

**Why one `make` and not a separate `decode`.** They would be the same
function. Rehydrating a database row and validating an untrusted import differ
in where the data came from, not in what has to happen to it — parse against
`input`, re-derive the computed fields, check the invariants, construct. A
second name for that would be an alias, so there is one: `make`. The class as
a schema runs it under the hood, which is why nesting works.

`update` returns a **new** entity — data is immutable — and re-runs
`invariants`, so a patch where every individual field is valid but the
combination is not still fails.

`toJSON()` returns the **stored** shape, so it pairs naturally with `make`.
`make` accepts it too: the stored shape is the wire shape plus the computed
fields, and a computed field is re-derived rather than read, so the extra keys
are simply ignored.

```ts
Person.make(person.toJSON()); // ✓ the natural pairing
Person.make(person.toJSON()); // ✓ also fine — computed keys are re-derived
```

## `generated` and `immutable`

```ts
{
  generated: ["id", "createdAt"], // omitted from createInput; a caller may never send them
  immutable: ["id", "createdAt", "slug"], // omitted from updateInput; update() drops them even if smuggled in at runtime
}
```

A field may not be named `_tag`, `equals`, `toJSON` or `update`: those are
installed on every instance, and a data field of the same name would shadow
one silently. The field map rejects them.

Both are **arrays of field names**, and both are keyed off `keyof S`
(`generated`) or `keyof output` (`immutable`), so a typo — `immutable:
["slugg"]` — is a compile error, not a silently-mutable field.

## `computed`

A computed field is derived from the declared ones, carries a schema, and is
**re-derived on every construction** — `make`, `make` and `update` alike:

```ts
import { z } from "zod";
import { Entity, computed } from "@btravstack/entity";

const PersonId = z.uuid().brand("PersonId");
const NamePart = z.string().min(1).brand("NamePart");
const FullName = z.string().min(1).brand("FullName");
const Initials = z.string().min(1).brand("Initials");

class Person extends Entity("Person")(
  { id: PersonId, first: NamePart, last: NamePart },
  {
    immutable: ["id"],
    computed: {
      fullName: computed(
        FullName,
        (d) => `${d.first} ${d.last}` as z.infer<typeof FullName>,
      ),
      initials: computed(
        Initials,
        (d) => `${d.first[0]}${d.last[0]}` as z.infer<typeof Initials>,
      ),
    },
  },
) {}

const p = Person.make({
  id: "0199b1f4-1b1e-7000-8000-000000000000",
  first: "Ada",
  last: "Lovelace",
}).getOrThrow();

p.fullName; // "Ada Lovelace"
p.update({ last: "Byron" as z.infer<typeof NamePart> }).getOrThrow().fullName; // "Ada Byron"
```

One entry per derived field, each pairing a schema with the function that
produces it — the same shape as the field map itself. `d` is the declared
shape, contextually typed so it needs no annotation, and each return value is
checked against **that field's** schema, so a wrong brand reports on the field
that produced it rather than on the whole map.

**Why not a getter?** Because a getter carries no schema. It cannot appear in
`output`, cannot generate JSON Schema, and is skipped by `toJSON()` — it lives
on the prototype, not in the data. The rule:

|                                                    | use        |
| -------------------------------------------------- | ---------- |
| derived, needed in the response body / JSON Schema | `computed` |
| derived, domain-only behaviour                     | a getter   |

**Re-derived, not stored-and-trusted.** `make` validates against the _declared_
fields and recomputes the rest, so a row heals whether its stored value merely
drifted, is outright invalid, or predates the computed field entirely. That is what keeps a computed field from drifting out of step with its
sources — the failure mode a compute-once design has, where renaming a person
leaves `fullName` frozen at the old value.

It follows that a computed field is **not patchable**: it is absent from
`updateInput` and from the `Patch` type, and `update()` drops it even if
smuggled in at runtime. Patching a derived value would only be overwritten by
the next derivation.

The computed output is re-validated against its own declared schemas — never
the declared fields, which were already validated once, and re-running a field
schema that carries a non-idempotent `.transform()` would apply it twice.
`from` necessarily returns an unchecked `as Brand` cast, since constructing a
branded value has no other spelling, and validating its output is what makes
that cast honest: if `from` ever produces data its own schema would reject,
that is a **defect** (a bug in domain code), not ordinary bad input. See
[Error handling](#error-handling).

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

`invariants` receives the stored (`output`) data and returns the messages of
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
`update`, `make` and `make`. Because data is _deeply_ immutable once
constructed — frozen values, not just locked bindings, see
[Immutability](#immutability) — a rule that holds at construction holds for
the instance's entire lifetime: an entity that rejects three tags cannot be
pushed into holding three tags afterwards.

## `equals`

Two entities are equal when they are instances of the **same entity** and
their **stored data is deep-equal**:

```ts
const a = Organization.make(state).getOrThrow();
const b = Organization.make(state).getOrThrow();
a === b; // false — different instances
a.equals(b); // true — same stored data

a.equals(a.update({ name: other }).getOrThrow()); // false — data differs
someOrg.equals(someApiKey); // false — different entities, even with identical field values
```

The comparison serialises both sides' `toJSON()` output, which is what makes
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
`toJSON()`, `JSON.stringify(entity)`, `Object.keys(entity)` and
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

const Member = Entity.union("kind", [User, ServiceAccount]);
```

`union` gives you one artifact with both halves, rather than making you choose:

```ts
Member.make(row).getOrThrow(); // User | ServiceAccount — the real class
Member.input; // discriminated union, one branch per member
Member.output; // ditto — JSON Schema in both directions
Member; // …is itself a schema; parses to the member class, nests like any other
Member.members; // the tuple, for registries and exhaustiveness
```

The union **dispatches on the discriminant** rather than trying each branch in
turn, so a member whose own validation fails reports _its_ issues — `path:
["email"]` — instead of a pile of every branch's complaints. An unrecognised
discriminant names the key and lists what was expected.

A union is a valid field too, so an aggregate can hold one:

```ts
class Audit extends Entity("Audit")({ id: AuditId, actor: Member }) {}
```

**Why the discriminant is a declared field and not the tag.** `_tag` is
non-enumerable and absent after serialisation, so a union built on it could not
survive a JSON round trip. The two are not redundant: `kind` discriminates
_data_, `_tag` matches an _instance_ with `P.tag(...)`. `union` needs the
first; the second keeps working on whatever it returns.

and `_tag` still serves in domain code, exactly as in the `match` example
above — the two mechanisms solve different problems. A brand is _per field_
and _type-only_ (it disappears at runtime); the tag is _per entity_ and
_runtime-present_, which is what makes it matchable.

The same string is also readable from the class itself, as `entityName`:

```ts
Organization.entityName; // "Organization" — typed as the literal, not `string`
```

`_tag` and `entityName` are one concept with two access paths, not two names
for it: `_tag` exists on an **instance** and is what `P.tag(...)` matches on,
while `entityName` is the only way to read the tag from code holding the
**class** and no instance — a registry keyed by entity, or an error message
naming the entity a repository failed to load. Neither substitutes for the
other, and both derive from the single `Entity(tag)` declaration.

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
| any of the above, reached through the class         | zod issues, paths composed           | a nested field failure reports the full path                                                |

`issues` is carried **structured**, exactly as the validator produced it, not
rendered into prose — so keying a field-level error response is a `path`
lookup rather than a string parse. A schema issue has the failing field's
path (`["tags", 0]`, `["address", "city"]`); an `invariants` violation has
none, which is what distinguishes a whole-entity rule from a field complaint.

```ts
ApiKey.make({ ...raw, secret: "short" });
// Err(InvalidEntity {
//   entity: "ApiKey",
//   issues: [{ path: ["secret"], message: "Too small: expected string to have >=16 characters" }],
// })

Trial.make(brokenRow);
// Err(InvalidEntity {
//   entity: "Trial",
//   issues: [{ message: "trialEndsAt must be after createdAt" }], // an invariant: no path
// })

// nested, paths compose with the position of the nested entity:
z.object({ owner: Organization }).safeParse({ owner: { slug: "" } });
// issues: [{ path: ["owner", "slug"], message: "Too small: …" }]
z.object({ owner: Organization }).safeParse({ owner: brokenRow });
// issues: [{ path: ["owner"], message: "trialEndsAt must be after createdAt" }]
```

A `Defect` — the unexpected-failure channel `unthrown`'s `Result` reserves
separately from `E` — is never folded into an ordinary validation issue, even
when nested: an unmodelled bug in domain code stays distinguishable
from bad caller input all the way to the edge.

## Sealed construction

`new SomeEntity(...)` does not compile, from outside the package or inside a
consumer's code:

```ts
new Organization({ id, slug, name, createdAt }); // ✗ compile error
```

The constructor is closed by a module-private `unique symbol` the package
never exports, so no outside code can produce a value satisfying it — every
instance is built through `create`/`update`/`make`/`make`, which means
`invariants` has run and the stored data is exactly the shape `output`
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

`toJSON()` still returns the plain `output` shape: it builds a fresh object,
so assigning to _its_ keys is fine and mappers keep working unchanged (the
values inside it are the entity's own, and stay frozen).

`Object.freeze(this)` is **not** used, and cannot be: a class body's field
initialisers run after `super()` returns, so the instance itself has to stay
extensible. Freezing the field values individually leaves that intact:

```ts
class OrgWithCache extends Entity("OrgWithCache")({ id: OrgId, slug: Slug }) {
  cachedSummary = "";
}
const org = OrgWithCache.make(raw).getOrThrow();
org.cachedSummary = "computed"; // ✓ still writable — it isn't declared data
org.toJSON(); // does NOT include cachedSummary — toJSON() projects only the declared schema's keys
```

## `extend`

An entity can be extended into a **new** entity carrying its fields plus more:

```ts
class Person extends Entity("Person")({ id: PersonId, name: Name }) {}

class PersonWithAge extends Person.extend("PersonWithAge")({ age: Age }) {
  get isAdult(): boolean {
    return this.age >= 18;
  }
}
```

The result is its own entity, not a variant of `Person`: its own tag, its own
schemas, and its own identity under `equals` — `child.equals(parent)` is
`false` even when the shared fields match. That is the difference between this
and the bare subclassing below, which has none of those and is refused.

The parent's options are **inherited and merged per key, child winning**, so an
extension is never quietly laxer than what it extends — `immutable`,
`invariants` and `computed` all carry over unless the child names them. An
extension can itself be extended.

One limit worth knowing: `extend` rebuilds from the **declaration** — the field
map and the options. A getter written in the parent's class body is part of
neither, so it does not come along. Re-declare it on the extension, or put
shared behaviour in a plain function.

## Entities are not subclassable

One `extends` is the declaration form, and `extend` above builds a new entity
from an existing one. Subclassing the _result_ is neither, and fails at
construction with a `Defect`:

```ts
class Sub extends Organization {}
Sub.make(raw); // Defect — not an InvalidEntity: this is a bug in domain code
```

Put the behaviour in the entity's own class body, which is what it is for:

```ts
class Organization extends Entity("Organization")({ ...fields }) {
  get greeting(): string {
    return `Welcome, ${this.name}`;
  }
}
```

A subclass buys nothing the body does not, and it adds a second place to look
for an entity's methods. Redeclaring a data field is doubly blocked — the
compiler reports TS4114 (`must have an 'override' modifier`), and the field is
installed non-writable and non-configurable, so construction fails with
`TypeError: Cannot redefine property`.

The prohibition is a **runtime** one: TypeScript has no `final`, and a
`private`/`protected` constructor cannot express "extendable once" — measured,
`TS2675` for `private` (the declaration form stops compiling) and `TS2684` for
`protected` (the statics stop returning the subclass). So `class Sub extends
Organization {}` compiles, and reports on first construction.

## Helper types

Four generic type-level helpers name each schema by reading it off an entity
class, instead of re-declaring the shape by hand:

```ts
import type { CreateInput, Input, Output, Patch } from "@btravstack/entity";

type OrgWire = Input<typeof Organization>; // what the wire sends — mapper/request signatures
type OrgState = Output<typeof Organization>; // what make() takes — repository signatures
type OrgCreate = CreateInput<typeof Organization>; // what create() takes from a caller
type OrgPatch = Patch<typeof Organization>; // what update() takes
```

## No I/O, by design

This package reads no clock and generates no id. A factory's generators, not
an internal `crypto.randomUUID()`/`Date.now()` call, are how a domain-generated
value reaches the entity — the _rule_ (which fields the domain owns, and that a
caller may never supply them) lives in the entity declaration; the _sources_
are bound once at your composition root, which keeps the entity pure and your
tests able to bind fixed generators instead of stubbing globals.

Generators are **functions, never values**, and each is called once per
`create` — a factory built at startup still yields a fresh id per entity. Pass
an arrow, not a bare method reference, or a port method loses its `this`:

```ts
Organization.factory({ id: ids.next }); // ✗ `this` is lost inside next()
Organization.factory({ id: () => ids.next() }); // ✓
```

`factoryAsync` is the same thing for generators that return a promise — an id
from a database sequence, say. Its `create` returns an `AsyncResult`, and a
generator that _rejects_ surfaces as a `Defect`: infrastructure failing is not
the same as bad domain input.

```ts
const createOrgAsync = Organization.factoryAsync({
  id: () => ids.nextFromSequence(),
  createdAt: () => clock.now(),
});
(await createOrgAsync({ slug, name })).getOrThrow();
```

## Peer dependencies

`zod`, `unthrown` and `@unthrown/standard-schema` are **peer dependencies**,
not bundled dependencies. `@btravstack/entity` hands back real `ZodObject`s
and real `Result`s built from _your_ copies of those packages — if this
package pinned its own instead, a consumer would end up with two copies of
`zod` (or `unthrown`) in the dependency tree, and identity checks like
`result instanceof Result`, `schema instanceof z.ZodType`, or composing this
package's entity class into the consumer's own `z.object({...})` can
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
