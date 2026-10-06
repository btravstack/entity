---
title: Persist an aggregate relationally
description: Map an aggregate to tables with a query builder, reject lost updates with a version column, commit events through an outbox, and migrate legacy rows before make().
---

# Persist an aggregate relationally

**Problem:** your aggregate nests other things (owned child entities, a
reference to another aggregate, a value copied at a moment in time), and your
database is relational. `toJSON()` gives you one tree. You need rows in several
tables, a save that cannot silently overwrite a concurrent one, events that
commit with the state that produced them, and rows written by older releases
that still load.

> The code below is runnable and tested: it is
> [`examples/billing-relational`](https://github.com/btravstack/entity/tree/main/examples/billing-relational),
> which persists the `Order` aggregate from [Model an aggregate](/how-to/model-an-aggregate)
> with [Kysely](https://kysely.dev/) over [PGlite](https://pglite.dev/), an
> in-process Postgres. Snippets assume these imports:
>
> ```ts
> import { Kysely } from "kysely";
> import {
>   fromNullable,
>   fromPromise,
>   fromSafePromise,
>   TaggedError,
>   type AsyncResult,
> } from "unthrown";
> import { z } from "zod";
> import type { Entity } from "@btravstack/entity";
> ```

The single-table read and write are covered in
[Persist and rehydrate](/how-to/persist-and-rehydrate). This guide is what
changes when one aggregate spans several tables.

## Decide reference, embed or snapshot per field

A mapper cannot infer this from nesting. Three fields of `Order` are nested,
and each one is a different domain decision with a different storage shape:

| Field        | Domain decision                | Storage                                            | On read                     |
| ------------ | ------------------------------ | -------------------------------------------------- | --------------------------- |
| `lines`      | owned child entities           | a child table, written in the order's transaction  | selected with the order     |
| `customerId` | reference to another aggregate | a foreign key column                               | never joined into the order |
| `billTo`     | historical snapshot            | columns on the order's own row, copied when placed | read from those columns     |

The snapshot is the one people get wrong. `billTo` holds the same name and
address as the customer, so a join to `customers` looks like normalisation. It
is not: the snapshot records who was billed **then**, and a join would rewrite
every placed order the day the customer moves. Copy it.

A reference is the opposite case. Loading an order never loads its customer;
the use case that needs both loads both, through two repositories.

## Declare the tables

```sql
create table customers (
  id              uuid primary key,
  billing_name    text not null,
  billing_address text not null
);

create table orders (
  id              uuid primary key,
  customer_id     uuid not null constraint orders_customer_id_fkey references customers (id),
  currency        text not null,
  status          text not null,
  bill_to_name    text,          -- the snapshot, null on a draft
  bill_to_address text,
  version         integer not null,
  schema_version  integer not null check (schema_version in (1, 2))
);

create table order_lines (
  order_id            uuid not null references orders (id) on delete cascade,
  id                  uuid not null,
  position            integer not null,
  label               text not null,
  quantity            integer not null,
  unit_price          numeric(12, 2),  -- schema version 1 only
  unit_price_amount   integer,
  unit_price_currency text,
  primary key (order_id, id)
);

create table outbox (
  id           uuid primary key,
  aggregate_id uuid not null,
  type         text not null,
  payload      jsonb not null,
  delivered_at timestamptz,
  position     integer generated always as identity
);
```

Describe them to Kysely with plain `string` and `number` columns. The driver
has never heard of a brand, and the table types should say what the driver
actually returns. The brands come back at the boundary, through `make`.

## Write from `toJSON()`

Map the projection to columns. `toJSON()`'s branded values are assignable to
the plain column types, so the write needs no cast:

```ts
const json = order.toJSON();
const row = {
  id: json.id,
  customer_id: json.customerId,
  currency: json.currency,
  status: json.status,
  bill_to_name: json.billTo?.name ?? null,
  bill_to_address: json.billTo?.address ?? null,
  version: expectedVersion + 1,
  schema_version: CURRENT_SCHEMA_VERSION,
};
```

Replace the owned lines wholesale inside the same transaction: delete the
order's lines, insert the current ones with their position. The invariants were
checked over the whole set of lines, so the whole set is what you write.

## Read through `make()`, never a cast

Assemble the rows into the shape `make` reads and hand it over. `make` takes
`unknown`, brands every value and checks every invariant, so there is nothing
to cast:

```ts
const toInput = ({ order, lines }: Stored) => ({
  id: order.id,
  customerId: order.customer_id,
  currency: order.currency,
  status: order.status,
  billTo:
    order.bill_to_name === null && order.bill_to_address === null
      ? undefined
      : { name: order.bill_to_name, address: order.bill_to_address },
  lines: lines.map((line) => ({
    id: line.id,
    label: line.label,
    quantity: line.quantity,
    unitPrice: {
      amount: line.unit_price_amount,
      currency: line.unit_price_currency,
    },
  })),
});

Order.make(toInput(stored)); // Result<Order, InvalidEntity>
```

If Kysely's row types and the entity's branded types disagree, the fix is this
parse, not an `as Order`. A cast would turn a row the domain considers
impossible (half a snapshot, a null price) into a typed lie; `make` turns it
into an `InvalidEntity` you can log.

Read the order row and its lines in one `repeatable read` transaction, so both
come from the same snapshot while another request is replacing the lines.

## Reject lost updates with a version column

Immutability does not protect the stored row. Two requests can load the same
draft, each add a line, and each hold a perfectly valid `Order`. If both saves
land, the second overwrites the first and a line is lost, or, if lines are
saved separately, the stored order breaks a rule no instance ever broke.

Carry the version you loaded beside the entity, and make it the first
statement of the save:

```ts
type Loaded = { readonly order: Order; readonly version: number };

const written = (
  await trx
    .updateTable("orders")
    .set(row)
    .where("id", "=", json.id)
    .where("version", "=", expectedVersion)
    .executeTakeFirst()
).numUpdatedRows;
if (written === 0n) return false; // nothing written yet: committing is harmless
```

Zero affected rows means someone else saved first. Turn it into a typed error
outside the transaction, rather than a silent success:

```ts
class ConcurrentModification extends TaggedError("ConcurrentModification")<{
  orderId: string;
  expectedVersion: number;
}> {}

fromPromise(() => db.transaction().execute(/* … */), triage).ensure(
  (saved) => saved,
  () => new ConcurrentModification({ orderId: json.id, expectedVersion }),
);
```

Because the check runs first, a conflict has written nothing, and the
transaction can return normally. No `throw` is needed to roll back. Creating a
new aggregate is the same check with `expectedVersion` of `0`: an
`insert … on conflict (id) do nothing` that affects no row is a conflict too.

The version stays in the adapter. The entity has no `version` field, because
the version is a fact about the stored row, not about the order.

## Commit events in the same transaction

When a save announces something, write the event in the save's own
transaction, into an outbox table:

```ts
await trx
  .insertInto("outbox")
  .values(
    events.map((event) => ({
      id: event.eventId,
      aggregate_id: json.id,
      type: event.type,
      payload: JSON.stringify(event),
    })),
  )
  .execute();
```

If any statement fails, the transaction rolls back the order, its lines and its
outbox rows together. Nothing can be published for a state that was never
committed, and no committed state can lose its event.

Publish from the outbox afterwards, in a separate step that only ever sees
committed rows: select what is undelivered, publish it, mark it delivered.
Publishing then marking is at-least-once delivery, so consumers deduplicate on
the event id.

The events themselves come from the use case, because the command ran:

```ts
const placeOrder = (db: Kysely<Database>) => (id: OrderId) =>
  orderRepository(db)
    .load(id)
    .flatMap(({ order, version }) =>
      customerRepository(db)
        .load(order.customerId)
        .flatMap((customer) => order.place(customer))
        .flatMap((placed) =>
          orderRepository(db)
            .save(placed, version, [
              {
                eventId: crypto.randomUUID(),
                type: "OrderPlaced",
                orderId: placed.id,
                customerId: placed.customerId,
                total: placed.total,
              },
            ])
            .map(() => placed),
        ),
    );
```

Do not derive events by diffing the stored row against the new one. A `status`
that went from `DRAFT` to `PLACED` is not the same fact as an order being
placed: an import or a correction can produce the same diff.
[Write commands and events](/how-to/write-commands) covers returning events
from commands.

## Migrate legacy rows before `make()`

Stamp every aggregate row with the shape it was written in, and keep a pure
function that brings any supported shape up to the current one. Run it between
the select and `make`, so the entity only ever validates one shape:

```ts
const migrate = (stored: Stored): Stored =>
  stored.order.schema_version === 1
    ? {
        order: { ...stored.order, schema_version: 2 },
        lines: stored.lines.map((line) => ({
          ...line,
          unit_price: null,
          unit_price_amount:
            line.unit_price === null
              ? null
              : Math.round(Number(line.unit_price) * 100),
          unit_price_currency: stored.order.currency,
        })),
      }
    : stored;

Order.make(toInput(migrate(stored)));
```

Version 1 stored prices in major units with no currency of their own. That is
a change the row's shape alone cannot always reveal, which is why the version
is a column rather than a guess. The `check` constraint keeps the column inside
the versions the function handles.

Every save writes the current version, so a migrated row heals the next time it
is written. When no version-1 rows remain, delete the branch and the legacy
column.

The simpler changes (an optional field, a default, a renamed column) do not
need a version stamp. [Evolve an entity](/how-to/evolve-an-entity) covers
those. Whether the package should offer a migration hook on `make` itself is
an open question, tracked in
[#71](https://github.com/btravstack/entity/issues/71); until it is settled, the
migration lives in the adapter.

## Triage driver errors

A driver rejects with an exception. Bring it in through `fromPromise`, and
decide per cause whether it is a typed error or a Defect. Parse the error's
shape with zod rather than casting it:

```ts
const PostgresError = z.object({
  code: z.string(),
  constraint: z.string().optional(),
});

(cause, defect) => {
  const error = PostgresError.safeParse(cause);
  return error.success &&
    error.data.code === "23503" &&
    error.data.constraint === "orders_customer_id_fkey"
    ? new CustomerNotFound({ customerId: json.customerId })
    : defect(cause);
};
```

Name the constraint, not only the SQLSTATE: a foreign key violation on some
other table is not a missing customer. Everything you did not name is a Defect,
so an outage (503) never looks like a conflict (409). Reads have no failure
worth modelling, so they use `fromSafePromise`, which makes every rejection a
Defect. The whole repository returns `AsyncResult`, and there is no
`try`/`catch` in it.

## With a managed-object ORM

Prisma, TypeORM and MikroORM can sit behind the same repository, but not in the
same way they usually sit behind mutable classes. A managed-object ORM tracks
an object it loaded, notices which fields you assign, and writes those fields
back when you flush. An entity from this package is never assigned to:
`update` returns a **new** instance and leaves the loaded one as it was.
Replacing an immutable instance is not the same operation as mutating a tracked
one, and handing the ORM an entity as if it were its own will either write
nothing or write a stale copy.

So treat the ORM as a row mapper at the adapter:

- read the ORM's plain record and pass it through `make`, as above;
- write from `toJSON()` into an explicit update, with the version in its
  `where` clause and the affected-row count checked, rather than through the
  ORM's change tracking;
- use the ORM's transaction API for the order, its children and the outbox,
  and keep the ORM's entity classes inside the adapter, never in the domain.

Some ORMs provide optimistic locking through a version decorator on a tracked
entity. That works only on the tracked path; once writes come from `toJSON()`,
put the version check in the `where` clause yourself.
