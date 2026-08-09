---
title: Branded fields
description: Why every field must be nominal, what counts as nominal, why the compile error is a type name, and where a branded value actually has to be minted.
---

# Branded fields

Every field of an entity must be **nominal**: a branded schema, a narrow
literal union, a boolean, or another entity class. A bare `z.string()` is a
compile error naming `DomainFieldMustBeBrandedOrAnEntity`. This is the
package's most opinionated constraint, and it is the one place where it makes
your declaration longer rather than shorter — so it has to earn itself.

## The bug the rule removes

With plain primitives, a domain model is a bag of interchangeable strings.
`findOrg(slug, name)` type-checks with the arguments swapped; a repository
keyed by `userId: string` happily takes an `orgId`; a function returning a
"validated email" returns something the type system cannot tell from the raw
input it started with. Every one of these compiles, and every one of them is a
runtime bug waiting on the right call site — the class of defect the
literature calls _primitive obsession_.

A brand makes the type nominal:

```ts
const Slug = z.string().min(1).brand("Slug");
const DisplayName = z.string().min(1).brand("DisplayName");

declare function findOrg(
  slug: z.infer<typeof Slug>,
  name: z.infer<typeof DisplayName>,
): void;

findOrg(name, slug); // ✗ compile error — the arguments are swapped
```

At runtime a branded value is the plain primitive — the brand is a phantom
property that exists only in the type. It costs nothing to store, serialise or
compare; it only refuses to be confused with a different string.

The rule is enforced rather than recommended because a brand only pays for
itself when it is unbroken: one bare `string` field is a hole every
unvalidated value in the program can flow through, and the field map is the
one place a library can check the whole perimeter at once.

## What counts as nominal

The check (`OnlyNominal`, applied to the field map) accepts a field whose
inferred type is already non-interchangeable:

- a **branded schema** — `z.string().brand("Slug")`, `z.uuid().brand("OrgId")`,
  a branded object, a branded number;
- a **narrow literal union** — `z.enum(["active", "inactive"])`,
  `z.literal("user")`: the wide primitive is not assignable to it, so it
  cannot be confused with an arbitrary string;
- a **boolean** — two values carry no identity worth branding;
- another **entity class** — an entity is nominal by construction, and the
  class is itself a schema.

The check looks through two wrappers — `.optional()` is stripped and one array
level is unwrapped — so `z.array(Customer)`, `Slug.optional()` and
`z.array(Slug).optional()` all pass; the rule applies to the element, not the
container. What it rejects is exactly the interchangeable core: bare
`z.string()`, bare `z.number()`, and any array or optional of those.

## The error is a type name

The rejection type is named `DomainFieldMustBeBrandedOrAnEntity` — a
deliberately sentence-shaped name, because the _name_ is the only part of a
type error guaranteed to survive. A rejection encoded as a tuple of message
strings prints as `& [...]` once TypeScript truncates a long diagnostic,
hiding the advice exactly when the field map is big enough to need it; a name
survives truncation and _is_ the message. The construction seal plays the same
trick: `new SomeEntity(...)` fails on a missing property called
`__useMakeOrFactoryInstead`
([Sealed construction](/explanation/sealed-construction)).

## The cost, and where it falls

The cost is ceremony: a branded type has no literal syntax, so somewhere a
plain value has to become a branded one. The question is where — and the
answer is narrower than it first looks, because the two places you would most
expect to pay are the two that cost nothing.

### Producers pay nothing

A factory generator and a `computed` derivation both hand a value to a
schema, not to a caller. A generated field is spread into `make`, which
validates it like any other data; a computed field's output is checked against
its own schema on every construction path. The parse already happens, and it
happens after the callback returns.

So both positions are typed as the schema's **input**, not its branded output.
A plain expression is already the right type:

```ts
const createOrg = Organization.factory({
  id: () => crypto.randomUUID(),
});

computed: {
  shout: Entity.computed(Upper, (d) => d.name.toUpperCase()),
}
```

Both callbacks once ended in a cast — ~~`crypto.randomUUID() as z.infer<typeof
OrgId>`~~ — that the parse immediately re-proved. Demanding the branded form
there bought nothing: a cast cannot make a value valid, only make its author
assert that it is. Dropping it weakens no check, because the check was never
the cast. A wrong _type_ still fails to compile; a wrong _value_ still fails to
parse. (Code still carrying the old cast compiles unchanged — a branded value
assigns to its own unbranded input.)

### Everywhere else, parse through a mint helper

Outside those two positions the brand has to be minted, and the schema is its
only gatekeeper. Crossing from untrusted to trusted therefore goes through the
schema, and for entity fields that crossing already exists: `make` takes
`unknown` and validates every field, so a database row or a request body never
needs pre-branded values at all.

What is left is the code that writes values by hand — fixtures, seeds,
literals in a test — where a brand really does have to be minted one call at a
time. The spelling that keeps that readable is a helper declared beside the
vocabulary:

```ts
const slug = (value: string) => Slug.parse(value);
const name = (value: string) => DisplayName.parse(value);
const money = (amount: number, currency: "EUR" | "USD" | "GBP") =>
  Money.parse({ amount, currency });
```

`slug("acme")` then reads like the literal it replaces, and the schema stays
the only thing that decides whether the value is a `Slug`. A helper is a named
parse, not a cast: it can fail.

Failing is also the one thing to know before reaching for one, because a helper
**throws**. That makes it right where a violation would be a bug in the code
that wrote it — a fixture, a seed, a literal — and wrong on anything that came
from outside the program. Untrusted data has its own entry point, and that one
returns a `Result` rather than throwing: `make`'s job, not a helper's.

A cast reaches the same shape without any of that. On a literal you wrote two
lines up it is merely unchecked; on a value that came from outside — a field
plucked off a response body, a string threaded through three functions — it is
not minting a brand but forging one, silencing the exact check the rule exists
to run. The helper costs one line and never has to be re-audited for which of
those two it is.

## Related

- [Getting started, step 1](/tutorial/getting-started#_1-brand-your-fields) —
  branding in practice.
- [Declaring an entity](/reference/declaration#fields) — the field rules as
  reference, including the reserved names.
- [Why entity?](/explanation/why-entity) — the design this constraint belongs
  to.
