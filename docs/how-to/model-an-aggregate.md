---
title: Model an aggregate
description: Decide what an aggregate owns, references and snapshots; change owned data through the root; commit one boundary at a time; and model a union of entities that survives a JSON round trip.
---

# Model an aggregate

**Problem:** an order holds line items, belongs to a customer, and has to keep
saying who it was billed to after that customer moves. Nesting entities gives
you one tree of objects. It does not tell you which parts change together, which
parts have a life of their own, and which parts must never change again. Those
are the decisions that make a DDD aggregate, and this guide makes them first.

> Snippets below assume these imports:
>
> ```ts
> import { z } from "zod";
> import { Err, match, P, TaggedError, type Result } from "unthrown";
> import { Entity } from "@btravstack/entity";
> ```
>
> The order example is runnable and tested: it is
> [`examples/billing-domain/src/order.ts`](https://github.com/btravstack/entity/blob/main/examples/billing-domain/src/order.ts),
> with its spec beside it. The brands (`OrderId`, `Quantity`, `Money`, …) are
> declared there.

## Decide what each part is

Four different things can sit inside an order, and they have different
lifecycles, so they are stored and changed differently:

| Part                    | Kind                           | Has its own identity? | Changed through          | Stored                                   |
| ----------------------- | ------------------------------ | --------------------- | ------------------------ | ---------------------------------------- |
| `lines`                 | owned child entity             | yes, within the order | the order's methods only | with the order, in the same write        |
| `Money`, `BillingParty` | value object                   | no                    | replaced, never changed  | inside whatever holds it                 |
| `customerId`            | reference to another aggregate | yes, its own          | the `Customer`'s methods | separately; the order stores the ID only |
| `billTo`                | historical snapshot            | no                    | never, once taken        | with the order                           |

Being nested is not what puts something inside the boundary. The test is: **must
this change in the same transaction as the order for the order's rules to stay
true?** A line must: the order's total and ceiling are computed from its lines.
The customer need not: renaming a customer breaks no rule of any order, and
holding the `Customer` entity inside the order would make every order a second,
stale copy of it. So the order references the customer by ID, and copies only
what it must keep.

## Declare owned lines, a reference and a snapshot

An entity class is itself a zod schema, so an owned child entity is a field like
any other. A value object is a branded object. A reference is a branded ID:

```ts
const BillingParty = z
  .object({ name: DisplayName, address: z.string().min(1) })
  .brand("BillingParty");

// Its own aggregate: renamed and re-addressed on its own schedule.
class Customer extends Entity("Customer")({
  id: Entity.field(CustomerId, { generated: true, immutable: true }),
  billing: BillingParty,
}) {}

// An owned child: identity within its order, no life outside it.
class OrderLine extends Entity("OrderLine")(
  {
    id: Entity.field(OrderLineId, { generated: true, immutable: true }),
    label: LineLabel,
    unitPrice: Entity.field(Money, { immutable: true }),
    quantity: Quantity,
  },
  {
    computed: {
      subtotal: Entity.computed(Money, (d) => ({
        amount: d.unitPrice.amount * d.quantity,
        currency: d.unitPrice.currency,
      })),
    },
  },
) {}

const sum = (
  lines: readonly { readonly subtotal: { readonly amount: number } }[],
) => lines.reduce((total, line) => total + line.subtotal.amount, 0);

class Order extends Entity("Order")(
  {
    id: Entity.field(OrderId, { identity: true, generated: true }),
    customerId: Entity.field(CustomerId, { immutable: true }), // a reference
    currency: Entity.field(Currency, { immutable: true }),
    status: Entity.field(OrderStatus, { generated: true }), // "DRAFT" | "PLACED"
    lines: z.array(OrderLine), // owned
    billTo: BillingParty.optional(), // the snapshot, taken when placed
  },
  {
    computed: {
      total: Entity.computed(Money, (d) => ({
        amount: sum(d.lines),
        currency: d.currency,
      })),
    },
    invariants: [
      Entity.invariant({
        code: "DUPLICATE_LINE_ID",
        ensure: (d) =>
          new Set(d.lines.map((line) => line.id)).size === d.lines.length,
        message: "line ids must be unique within an order",
      }),
      Entity.invariant({
        code: "LINE_CURRENCY_MISMATCH",
        ensure: (d) =>
          d.lines.every((line) => line.unitPrice.currency === d.currency),
        message: "every line must be priced in the order's currency",
      }),
      Entity.invariant({
        code: "ORDER_OVER_CEILING",
        ensure: (d) => sum(d.lines) <= 10_000_00,
        message: "order total exceeds the ceiling",
      }),
      Entity.invariant({
        code: "BILLING_SNAPSHOT_MISMATCH",
        ensure: (d) => (d.status === "PLACED") === (d.billTo !== undefined),
        message:
          "a placed order, and only a placed order, carries a billing snapshot",
      }),
    ],
  },
) {}
```

Each invariant reads more than one line, or a line and the order together. That
is what an aggregate-wide rule is, and why the lines belong inside this
boundary. A nested entity keeps everything that makes it an entity:
`order.lines[0]` is an `OrderLine` instance, with its computed `subtotal`, its
`_tag` for `P.tag(...)` matching, and its own `update`.

## Change owned data through the root

Outside code holds the `Order`, never a loose `OrderLine` it intends to save. A
change to a line is a method on the order, and it ends in the order's own
`update`, which re-runs **every** invariant over the new set of lines:

```ts
class OrderNotEditable extends TaggedError("OrderNotEditable")<{
  orderId: string;
}> {}
class LineNotFound extends TaggedError("LineNotFound")<{ lineId: string }> {}

class Order extends Entity("Order")(/* … as above … */) {
  changeQuantity(
    lineId: z.output<typeof OrderLineId>,
    quantity: z.output<typeof Quantity>,
  ): Result<Order, Entity.InvalidEntity | OrderNotEditable | LineNotFound> {
    if (this.status !== "DRAFT")
      return Err(new OrderNotEditable({ orderId: this.id }));
    const line = this.lines.find((candidate) => candidate.id === lineId);
    if (line === undefined) return Err(new LineNotFound({ lineId }));
    return line
      .update({ quantity }) // the line's own rules
      .flatMap((changed) =>
        // the order's rules, over every line
        this.update({
          lines: this.lines.map((each) =>
            each.id === lineId ? changed : each,
          ),
        }),
      );
  }
}
```

Two checks run, and they are not the same check. `line.update` decides whether
the line is still a valid line; 1,001 widgets at €10.00 is. `this.update`
decides whether the order is still a valid order, and €10,010.00 is over its
ceiling:

```ts
order.changeQuantity(lineId, Quantity.parse(1_001));
// Err(InvalidEntity { issues: [{ message: "order total exceeds the ceiling" }] })
```

`total` is re-derived on the same path, so it cannot drift from the lines. A
state transition such as "a placed order's lines are frozen" is not an
invariant, since it depends on the previous state rather than on the data. It
is the guard at the top of the method, returned as its own modelled error.

## Snapshot what a placed order must keep

An issued document records a fact: on that day, this party was billed at this
address. If the order rendered the customer's **current** name and address, a
customer who moves next year would silently rewrite every invoice already sent
to them. Copy the values at the moment the order is placed, as a value object,
and store them with the order:

```ts
class NotTheOrdersCustomer extends TaggedError("NotTheOrdersCustomer")<{
  customerId: string;
}> {}

class Order extends Entity("Order")(/* … as above … */) {
  place(
    customer: Customer,
  ): Result<
    Order,
    Entity.InvalidEntity | OrderNotEditable | NotTheOrdersCustomer
  > {
    if (this.status !== "DRAFT")
      return Err(new OrderNotEditable({ orderId: this.id }));
    if (customer.id !== this.customerId) {
      return Err(new NotTheOrdersCustomer({ customerId: customer.id }));
    }
    return this.update({ status: "PLACED", billTo: customer.billing });
  }
}
```

The order keeps both, for different questions. `customerId` answers "whose order
is this?" and follows the customer for as long as the customer exists. `billTo`
answers "who was billed?" and never changes again. The caller loads the
`Customer` to place the order, but placing it writes nothing to the customer.

The snapshot is a value object, not a nested `Customer`. An embedded entity
reads as something the order owns and may refresh; a value copied at a moment
in time does not. Where you do embed another entity for the same reason, flag
it `immutable`, as the billing example's `BillingDocumentBase` does with its
`issuedTo`, so `update` cannot refresh it after the fact.

## Commit one aggregate per transaction

Commit the order row, all of its lines and its `billTo` snapshot **together**,
in one transaction. The invariants were checked over that whole set; writing the
lines in a separate statement could persist a combination that never passed
them. The `Customer` is a separate aggregate and commits on its own; placing an
order does not touch it.

Immutable instances do not make this safe under concurrency. Immutability means
the `Order` you hold cannot change under you; it says nothing about the stored
row. Two requests can each load the same draft, each add a €6,000.00 line, and
each produce an order that passes every invariant. If both saves land, either
the second overwrites the first and a line is lost, or, if lines are written as
separate rows, the stored order now totals €12,000.00 and breaks a rule no
instance ever broke. Detecting that takes a concurrency check at the storage
layer, typically a version column that the save compares and increments, and a
conflict returned as a value rather than a silent overwrite.

The relational mapping and concurrency recipe is tracked in
[#37](https://github.com/btravstack/entity/issues/37), and is not written yet.
Until then, [Persist and rehydrate](/how-to/persist-and-rehydrate) covers the
single-row read and write.

## Compare versions by identity

`Order.id` is flagged `identity`, so two versions of the same order with
different lines are still the same order:

```ts
changed.sameIdentityAs(order); // true: same id, whatever the lines say
```

An order and a customer that happen to share an id string never compare as
the same: identity is scoped to the entity that declares it.
[Tags and identity](/explanation/tags-and-identity#four-kinds-of-sameness)
separates this from comparing states.

## Failures name the whole path

A nested field's failure reports where it actually happened, not just which
member failed:

```ts
Order.make({ ...row, lines: [{ ...line, quantity: 0 }] });
// issues: [{ path: ["lines", 0, "quantity"], message: "Too small: expected number to be >0" }]
```

## Serialisation walks the tree

`JSON.stringify` reaches plain data all the way down, computed fields included,
and the result feeds back through `make`:

```ts
const json = JSON.parse(JSON.stringify(order));
// { id, customerId, currency, status, lines: [{ id, label, unitPrice, quantity, subtotal }], total }

Order.make(json).getOrThrow().lines[0] instanceof OrderLine; // true
```

## An abstract root is not an aggregate root

"Root" means two unrelated things here, and the package only declares one of
them.

- **`Entity.abstract(name)`** declares an **inheritance root**: fields and
  behaviour shared by several entity variants. It is tagless, has no `make`, is
  never instantiated, and says nothing about consistency or storage.
- A **DDD aggregate root** is the entity that guards a consistency boundary:
  the one outside code holds, whose methods are the only way to change what is
  inside, and which is committed as a unit. `Order` above is one, and it
  extends no abstract root.

The two are independent. The billing example's `BillingDocumentBase` is an
abstract root whose variants, `Invoice` and `CreditNote`, are each an aggregate
root of their own. Nothing marks an aggregate root in code, and there is no
`AggregateRoot` base class to extend: the boundary is the set of methods you
expose and the set of data you commit together.

## Model a union of entities

When a field can be one of several entities, put what they share on an abstract
root, give each variant its own discriminant field, and gather them with
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

export const Member = Entity.union("kind", [User, ServiceAccount]);
export type Member = Entity.Instance<typeof Member>;

Member.make(row).getOrThrow(); // User | ServiceAccount — the real class
```

The discriminant is an ordinary declared field. The root is what lets the two
variants share `id` and the `label()` contract — declaring `abstract label()`
there makes a variant that forgets it a compile error, not a runtime surprise.

## Put entry points beside the union, not on it

Nothing is ever an instance of a union: `make` dispatches to a member and
constructs **that** class. `Entity.union` returns a value, so there is no class
body to put an unreachable instance method in — and no class body to hang a
static off either. An entry point is a plain function next to the const:

```ts
export const Member = Entity.union("kind", [User, ServiceAccount]);
export type Member = Entity.Instance<typeof Member>;

export const memberFromRow = (row: unknown) => Member.make(row);
```

If you are migrating from the class form, this is the one change that is not
mechanical: `static fromRow` in the old body becomes `memberFromRow` here, and
the call sites lose the `Member.` prefix. Everything else — `make`, `input`,
`output`, `members`, `discriminant` — is reached off the const exactly as it was
reached off the class.

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

`Member` as a **type** is `User | ServiceAccount` — the `export type` line
beside the const, which is why both halves of the pair are written. `MemberBase`
is the other annotation worth naming:

```ts
declare function render(member: Member): string; // needs a variant's own fields
declare function idOf(member: MemberBase): MemberId; // needs only the shared half
```

Both are usable and they are not interchangeable: the root gives you `label()`
and `id` for any variant present or future, the member union gives you each
variant's own fields and narrows under `P.tag(...)`.
([Why the two differ](/explanation/unions-and-roots).)

## Match exhaustively on what comes back

```ts
const describe = (m: Member) =>
  match(m)
    .with(P.tag("User"), (u) => `user:${u.email}`)
    .with(P.tag("ServiceAccount"), (s) => `svc:${s.name}`)
    .exhaustive();
```

## When to reach for an abstract root instead of nesting

If the relationship is "the same thing with more fields" rather than "contains
a thing", share an abstract root rather than nest:

```ts
abstract class PersonBase extends Entity.abstract("Person")({
  id: PersonId,
  name: Name,
}) {}

class Person extends PersonBase.extend("Person")({}) {}
class PersonWithAge extends PersonBase.extend("PersonWithAge")({ age: Age }) {}
```

Each variant is a genuine entity with its own tag and schemas. `PersonWithAge` is not a subclass of `Person` — an entity is
[final](/explanation/sealed-construction#an-entity-is-final) — but both are
instances of `PersonBase`, so code holding the root works on either. That is an
inheritance choice; which of them is an aggregate root is still decided by the
boundary, as above.
