---
title: Branded fields
description: Why every field must be nominal, what counts as nominal, why the compile error is a type name, and the two blessed ways to mint a branded value.
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

## The cost, and the two blessed patterns

The cost is ceremony: a branded type has no literal syntax, so somewhere a
plain value has to become a branded one. There are exactly two honest ways.

**At a boundary, parse.** The schema is the brand's gatekeeper, so crossing
from untrusted to trusted goes through it — and for entity fields that
boundary already exists: `make` takes `unknown` and validates every field, so
a database row or request body never needs pre-branded values.

```ts
const slug = Slug.parse(raw); // z.infer<typeof Slug> — or safeParse, handled
```

**Where the value is locally proven, cast.** Inside a generator or a
`computed` derivation the value is constructed in place and its validity is
visible in the same expression — and the package keeps the cast honest:
a factory's output goes through `make`'s validation, and a computed field's
output is checked against its own schema on every construction.

```ts
const createOrg = Organization.factory({
  id: () => crypto.randomUUID() as z.infer<typeof OrgId>,
});

computed: {
  shout: Entity.computed(Upper, (d) => d.name.toUpperCase() as z.infer<typeof Upper>),
}
```

An `as` anywhere else — deep in application code, on a value that came from
outside — is not minting a brand, it is forging one: it silences the exact
check the rule exists to run.

## Related

- [Getting started, step 1](/tutorial/getting-started#_1-brand-your-fields) —
  branding in practice.
- [Declaring an entity](/reference/declaration#fields) — the field rules as
  reference, including the reserved names.
- [Why entity?](/explanation/why-entity) — the design this constraint belongs
  to.
