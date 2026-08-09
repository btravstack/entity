---
title: Getting started
description: Build a working entity from nothing — declare it, create one, watch a bad value fail as a value, update it, and send it over the wire.
---

# Getting started

By the end of this page you will have declared an entity, created one through a
factory, seen a bad value come back as a `Result` instead of an exception,
updated it into a new instance, and projected it to the shape you would store or
respond with.

The snippets build on one another, so follow along in a `.ts` file. Each step
shows only what changed; the two lines marked `// ✗` are meant not to compile,
and that is the point of them.

## Install

```sh
pnpm add @btravstack/entity zod unthrown @unthrown/standard-schema
```

All four, because `zod`, `unthrown` and `@unthrown/standard-schema` are **peer**
dependencies — the package hands you back _your_ copies of them rather than its
own. ([Why](/explanation/peer-dependencies).) Any zod `^4.3.0` works; the floor
is measured, not guessed.

## 1. Brand your fields

Every field of an entity must be **nominal** — a schema that carries a brand, a
narrow literal union, a boolean, or another entity. A bare `z.string()` is a
compile error.

```ts
import { z } from "zod";

const OrgId = z.uuid().brand("OrgId");
const Slug = z.string().min(1).brand("Slug");
const DisplayName = z.string().min(1).brand("DisplayName");
const Instant = z.iso.datetime().brand("Instant");
```

The reason is the one every domain modeller already knows: with plain strings,
`findOrg(slug, name)` type-checks with the arguments swapped. Branded, it does
not. ([The full argument](/explanation/branded-fields).)

## 2. Declare the entity

```ts
import { Entity } from "@btravstack/entity";

class Organization extends Entity("Organization")({
  id: OrgId,
  slug: Slug,
  name: DisplayName,
  createdAt: Instant,
}) {}
```

That single declaration already gives you four validators and a class that is
itself a zod schema:

```ts
Organization.input; // ZodObject — everything make() accepts
Organization.output; // ZodObject — the stored shape / response body
Organization.createInput; // ZodObject — the create request
Organization.updateInput; // ZodObject — the update request, partial
```

Right now `createInput` has the same shape as `input`, and `updateInput` is
just `output` made partial — though each is its own object, so a registry keyed
by schema identity keeps all four. The next step is what makes their shapes
differ.

## 3. Say which fields the domain owns

`id` and `createdAt` are not the caller's to supply, and never change once set.
Declare that:

```ts
class Organization extends Entity("Organization")(
  { id: OrgId, slug: Slug, name: DisplayName, createdAt: Instant },
  {
    generated: ["id", "createdAt"],
    immutable: ["id", "createdAt", "slug"],
  },
) {}
```

- `generated` drops those fields from `createInput` — a create request cannot
  carry them.
- `immutable` drops them from `updateInput` — and `update()` rejects them at
  runtime even if something smuggles them past the type, so a change that
  cannot happen is reported rather than quietly ignored.

Both are keyed off the field names, so a typo is a compile error rather than a
silently-inert entry.

## 4. Create one

The package reads no clock and generates no id. Instead you bind the **sources**
once — at your composition root, next to the ports you already have:

```ts
const createOrganization = Organization.factory({
  id: () => crypto.randomUUID(),
  createdAt: () => new Date().toISOString(),
});
```

Now a create use case supplies only the caller's fields:

```ts
const created = createOrganization({
  slug: "acme" as z.infer<typeof Slug>,
  name: "Acme" as z.infer<typeof DisplayName>,
});

const org = created.getOrThrow();
org.name; // "Acme"
org.id; // a fresh uuid
```

Generators are **functions**, called once per create — so a factory built at
startup still yields a fresh id per entity. And a test can bind fixed generators
instead of stubbing globals. ([Why no I/O](/explanation/no-io).)

Note the asymmetry between the two blocks. A generator hands its value to the
entity, which validates it, so `crypto.randomUUID()` needs nothing; a caller
field is a branded value you are supplying, so it has to be minted. The cast
above is the shortest spelling for a tutorial — real code declares a helper per
piece of vocabulary and writes `slug("acme")`
([Branded fields](/explanation/branded-fields#everywhere-else-parse-through-a-mint-helper)).

::: tip `getOrThrow()` is for a tutorial
It is the shortest way to get at a value while you are exploring. Real code
handles the `Result` — [step 6](#_6-handle-failure-as-a-value) does.
:::

## 5. Try to break it

The entity is immutable in both halves — the binding is non-writable and the
value is deep-frozen:

```ts
org.name = "Other" as z.infer<typeof DisplayName>; // ✗ compile error — read-only property
```

And you cannot sidestep the entry points:

```ts
new Organization(org.toJSON()); // ✗ does not compile — the constructor is sealed
```

The constructor takes a value no outside code can produce. That is what
guarantees every instance in your program went through validation and the
invariants. ([Sealed construction](/explanation/sealed-construction).)

## 6. Handle failure as a value

Nothing throws. `make` is the general entry point — a database row, a folded
event stream, an untrusted import all come in the same way — and it returns a
`Result`:

```ts
import { P } from "unthrown";

const outcome = Organization.make({
  id: "not-a-uuid",
  slug: "acme",
  name: "Acme",
  createdAt: "2026-01-01T00:00:00.000Z",
}).match({
  ok: (o) => `created ${o.slug}`,
  errCases: (m) => m.with(P.tag("InvalidEntity"), (e) => e.issues),
  defect: (cause) => {
    console.error(cause);
    return "bug";
  },
});
```

`outcome` is the issue list: `[{ path: ["id"], message: "Invalid UUID" }]`.
Structured, exactly as the validator produced it — keying a field-level error
response is a `path` lookup, not a string parse.

The third branch is not decoration. `defect` is a separate channel for a bug in
your own domain code, and it is never folded into `errCases`. ([Errors are
values, and defects are separate](/explanation/errors-are-values).)

## 7. Add a rule that spans fields

A single field's schema cannot express "these two fields must agree".
`invariants` can:

```ts
class Organization extends Entity("Organization")(
  { id: OrgId, slug: Slug, name: DisplayName, createdAt: Instant },
  {
    generated: ["id", "createdAt"],
    immutable: ["id", "createdAt", "slug"],
    invariants: [
      Entity.invariant(
        (d) => d.name.length <= 80,
        "name must be at most 80 characters",
      ),
    ],
  },
) {}
```

`ensure` returning **true** means valid, so a rule reads as the assertion it
makes. `d` is contextually typed — no annotation needed. Every failing rule
reports, not just the first, and an invariant's issue carries no `path`: it is a
complaint about the entity, not about one field.

Invariants re-run on every construction path, including `update`.

## 8. Derive a field, and add behaviour

Two different things live in a class, and they go in two different places:

```ts
const Upper = z.string().min(1).brand("Upper");

class Organization extends Entity("Organization")(
  { id: OrgId, slug: Slug, name: DisplayName, createdAt: Instant },
  {
    generated: ["id", "createdAt"],
    immutable: ["id", "createdAt", "slug"],
    computed: {
      shout: Entity.computed(Upper, (d) => d.name.toUpperCase()),
    },
  },
) {
  get greeting(): string {
    return `Welcome, ${this.name}`;
  }
}

org.shout; // "ACME" — data: in `output`, in toJSON(), in the JSON Schema
org.greeting; // "Welcome, Acme" — behaviour: on the prototype, never serialised
```

A `computed` field is **data**. A getter is **behaviour**. If it belongs in the
response body, it is `computed`. ([Why `computed`
re-derives](/explanation/computed-fields).)

## 9. Update

`update` returns a **new** entity — the original is untouched:

```ts
const renamed = org
  .update({ name: "Acme Corp" as z.infer<typeof DisplayName> })
  .getOrThrow();

renamed.name; // "Acme Corp"
renamed.shout; // "ACME CORP" — re-derived, never stale
org.name; // "Acme" — the original is unchanged
renamed.equals(org); // false
```

`org.update({ slug })` does not compile: `slug` is `immutable`.

## 10. Send it over the wire

`toJSON()` projects exactly `output`'s keys — never `_tag`, never `greeting`,
never anything your class body added:

```ts
console.log(renamed.toJSON());
// { id, slug, name, createdAt, shout } — that object is what you store or respond with
```

And the four schema members are plain `ZodObject`s, so a contract layer converts
them to JSON Schema in **both** directions:

```ts
z.toJSONSchema(Organization.createInput, { io: "input" }); // ✓
z.toJSONSchema(Organization.output, { io: "output" }); // ✓
z.toJSONSchema(Organization, { io: "output" }); // ✗ throws — by design
```

That last line is the rule the whole package turns on: **contracts compose the
four plain `ZodObject`s; domain code composes the class itself.** The class
carries a `.transform()` (that is what produces an instance), and a transform has
no output representation.

## Where to go next

- [Expose an HTTP contract](/how-to/http-contract) — the contract layer, worked
  end to end.
- [Persist and rehydrate](/how-to/persist-and-rehydrate) — repositories, and why
  computed columns heal themselves.
- [Evolve an entity](/how-to/evolve-an-entity) — changing the model once rows
  are stored.
- [Model an aggregate](/how-to/model-an-aggregate) — entities nested in entities,
  and `Entity.union`.
- [Test domain logic](/how-to/test-domain-logic) — deterministic tests with no
  global stubbing.
- [Reference](/reference/declaration) — every member, option and type.
- [Why entity?](/explanation/why-entity) — the design, and what was measured.
