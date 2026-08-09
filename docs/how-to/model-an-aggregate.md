---
title: Model an aggregate
description: Nest entities inside entities, span invariants across the boundary, and model a union of entities that survives a JSON round trip.
---

# Model an aggregate

**Problem:** one entity contains others — an order with a customer and line
items, a document with authors — and you want the whole thing to still be an
entity rather than a bare schema.

> Snippets below assume these imports:
>
> ```ts
> import { z } from "zod";
> import { match, P } from "unthrown";
> import { Entity } from "@btravstack/entity";
> ```
>
> Domain vocabulary — entities, brands, factories — is whatever your own
> domain declares.

## Use the class as a field

An entity class is itself a zod schema, so it is a field like any other:

```ts
class Customer extends Entity("Customer")(
  { id: CustomerId, name: Name },
  {
    computed: {
      shout: Entity.computed(Upper, (d) => d.name.toUpperCase()),
    },
  },
) {}

class Order extends Entity("Order")({
  id: OrderId,
  customer: Customer,
  watchers: z.array(Customer),
  note: Line,
}) {}
```

A nested entity is a field like any other in the second sense too: it can carry
flags. `customer: Entity.field(Customer, { immutable: true })` makes the whole
nested entity unpatchable, and the billing example's root does exactly that with
its `issuedTo`.

`Order` is a real entity: invariants, deep immutability, `make`, `update`,
`toJSON`. The nested entities keep everything that makes _them_ entities:

```ts
const order = Order.make(row).getOrThrow();

order.customer instanceof Customer; // true
order.customer.shout; // its computed fields
order.customer._tag; // its tag, for P.tag(...) matching
order.watchers.at(0)?.equals(other); // its behaviour
```

## Invariants can span the boundary

```ts
class Order extends Entity("Order")(
  { id: OrderId, customer: Customer, note: Line },
  {
    invariants: [
      Entity.invariant(
        (d) => d.note.length >= d.customer.name.length,
        "note must be at least as long as the name",
      ),
    ],
  },
) {}
```

## Failures name the whole path

A nested field's failure reports where it actually happened, not just which
member failed:

```ts
Order.make({ ...raw, customer: { id, name: "" } });
// issues: [{ path: ["customer", "name"], message: "Too small: …" }]
```

## Serialisation walks the tree

`JSON.stringify` reaches plain data all the way down, and the result feeds back
through `make`:

```ts
const json = JSON.parse(JSON.stringify(order));
// { id, customer: { id, name, shout }, watchers: [...], note }

Order.make(json).getOrThrow().customer instanceof Customer; // true
```

## Model a union of entities

When a field can be one of several entities, put what they share on a root,
give each variant its own discriminant field, and gather them with
`Entity.union`:

```ts
abstract class MemberBase extends Entity.abstract("Member")({ id: MemberId }) {
  /** every variant owes the caller a display label */
  abstract label(): string;
}

class User extends MemberBase.extend("User")({
  kind: z.literal("user"),
  email: Email,
}) {
  override label(): string {
    return this.email;
  }
}

class ServiceAccount extends MemberBase.extend("ServiceAccount")({
  kind: z.literal("service_account"),
  name: Name,
}) {
  override label(): string {
    return this.name;
  }
}

class Member extends Entity.union("kind", [User, ServiceAccount]) {}

Member.make(row).getOrThrow(); // User | ServiceAccount — the real class
```

The discriminant is an ordinary declared field. The root is what lets the two
variants share `id` and the `label()` contract — declaring `abstract label()`
there makes a variant that forgets it a compile error, not a runtime surprise.

## Put statics, not methods, in the union's body

Nothing is ever an instance of a union: `make` dispatches to a member and
constructs **that** class. An instance method written in the union's body could
never reach a member, and `new Member(...)` is a defect. Statics are what the
body is for — the same declaration, with an entry point on it:

```ts
class Member extends Entity.union("kind", [User, ServiceAccount]) {
  static fromRow(row: unknown) {
    return Member.make(row);
  }
}
```

The union dispatches on the discriminant rather than trying each branch, so a
member whose own validation fails reports _its_ issues rather than every
branch's. A payload whose discriminant matches no member fails as an
`InvalidEntity` whose one issue sits at `path: ["kind"]` and lists the values
the union knows.

Two members claiming the same discriminant value is a bug in the declaration,
not bad input, so `Entity.union` throws at declaration time, naming both
members — left silent, the last member would win and `make` would misroute.

The discriminant is a declared field, not `_tag`, because `_tag` is
non-enumerable and absent after serialisation — a union built on it could not
survive a JSON round trip. The two are not redundant: the field discriminates
data, the tag matches an instance.

A union is a schema too, so it nests:

```ts
class Audit extends Entity("Audit")({ id: AuditId, actor: Member }) {}
```

## Name what comes back

`Member` as a **type** is `MemberBase`, the root its members share — a base
class cannot be a union type, so that is what the class can claim. Ask for the
exact union by name instead:

```ts
type AnyMember = Entity.Instance<typeof Member>; // User | ServiceAccount
```

Either annotation is usable: the root gives you `label()` and `id`, the member
union gives you each variant's own fields.
([Why the two differ](/explanation/unions-and-roots).)

## Match exhaustively on what comes back

```ts
const describe = (m: AnyMember) =>
  match(m)
    .with(P.tag("User"), (u) => `user:${u.email}`)
    .with(P.tag("ServiceAccount"), (s) => `svc:${s.name}`)
    .exhaustive();
```

## When to reach for a root instead

If the relationship is "the same thing with more fields" rather than "contains
a thing", share a root rather than nest:

```ts
abstract class PersonBase extends Entity.abstract("Person")({
  id: PersonId,
  name: Name,
}) {}

class Person extends PersonBase.extend("Person")({}) {}
class PersonWithAge extends PersonBase.extend("PersonWithAge")({ age: Age }) {}
```

Each variant is a genuine entity with its own tag, schemas and `equals`
identity. `PersonWithAge` is not a subclass of `Person` — an entity is
[final](/explanation/sealed-construction#an-entity-is-final) — but both are
instances of `PersonBase`, so code holding the root works on either.
