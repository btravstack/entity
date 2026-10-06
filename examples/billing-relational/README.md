# billing-relational

The `Order` aggregate in Postgres, through Kysely: owned lines in a child
table, the customer as a foreign key, the billing snapshot as copied columns.

```sh
pnpm --filter @btravstack/entity-example-billing-relational test
```

The specs run against PGlite, real Postgres compiled to WASM and run
in-process. Nothing needs installing and nothing needs to be listening.

## The round trip

```ts
repository.save(order, expectedVersion, events); // order.toJSON() → rows, in one transaction
repository.load(id); // rows → migrate → Order.make → Result<{ order, version }, …>
```

Kysely's table types are plain strings and numbers, because that is what the
driver returns. Writes need no cast: `toJSON()`'s branded values fit those
columns. Reads need none either: `Order.make` takes `unknown` and brands what it
validates.

## A version column, not immutability

Two loads of the same order can each produce a valid replacement. The save's
first statement is `update … where id = ? and version = ?`, and zero affected
rows is a `ConcurrentModification` value, never a silent overwrite.

## The outbox

`placeOrder` saves the placed order and an `OrderPlaced` event in one
transaction. A failure anywhere in it commits neither. `relayOutbox` publishes
only committed rows, after the fact.

## Legacy rows

`orders.schema_version` records the row shape. Version 1 stored prices in
major units with no line currency; a pure `migrate` rewrites it before `make`,
and the next save writes the current shape.

See also the how-to: [Persist an aggregate
relationally](https://btravstack.github.io/entity/how-to/persist-relationally).
