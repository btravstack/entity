# Model an aggregate

**Problem:** one entity contains others — an order with a customer and line
items, a document with authors — and you want the whole thing to still be an
entity rather than a bare schema.

> Snippets below assume these imports:
>
> ```ts
> import { z } from "zod";
> import { match, P } from "unthrown";
> import { Entity, computed } from "@btravstack/entity";
> ```

## Use the class as a field

An entity class is itself a zod schema, so it is a field like any other:

```ts
class Customer extends Entity("Customer")(
  { id: CustomerId, name: Name },
  {
    computed: {
      shout: computed(
        Upper,
        (d) => d.name.toUpperCase() as z.infer<typeof Upper>,
      ),
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

`Order` is a real entity: invariants, deep immutability, `make`, `update`,
`toJSON`. The nested entities keep everything that makes _them_ entities:

```ts
const order = Order.make(row).getOrThrow();

order.customer instanceof Customer; // true
order.customer.shout; // its computed fields
order.customer._tag; // its tag, for P.tag(...) matching
order.watchers[0].equals(other); // its behaviour
```

## Invariants can span the boundary

```ts
class Order extends Entity("Order")(
  { id: OrderId, customer: Customer, note: Line },
  {
    invariants: (d) =>
      d.note.length >= d.customer.name.length
        ? []
        : ["note must be at least as long as the name"],
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

When a field can be one of several entities, declare the discriminant as an
ordinary domain field and use `Entity.union`:

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

Member.make(row).getOrThrow(); // User | ServiceAccount — the real class
```

The union dispatches on the discriminant rather than trying each branch, so a
member whose own validation fails reports _its_ issues rather than every
branch's.

The discriminant is a declared field, not `_tag`, because `_tag` is
non-enumerable and absent after serialisation — a union built on it could not
survive a JSON round trip. The two are not redundant: the field discriminates
data, the tag matches an instance.

A union is a schema too, so it nests:

```ts
class Audit extends Entity("Audit")({ id: AuditId, actor: Member }) {}
```

## Match exhaustively on what comes back

```ts
const describe = (m: User | ServiceAccount) =>
  match(m)
    .with(P.tag("User"), (u) => `user:${u.email}`)
    .with(P.tag("ServiceAccount"), (s) => `svc:${s.label}`)
    .exhaustive();
```

## When to reach for `extend` instead

If the relationship is "the same thing with more fields" rather than "contains
a thing", extend rather than nest:

```ts
class PersonWithAge extends Person.extend("PersonWithAge")({ age: Age }) {}
```

That produces a new entity with its own tag and identity — not a variant of
`Person`, and not a subclass, which is
[refused](../explanation.md#entities-are-not-subclassable).
