---
title: Relational persistence example
description: The Order aggregate in Postgres through Kysely, with a version column against lost updates, a transactional outbox, and legacy rows migrated before make().
---

# Relational persistence

[`examples/billing-relational`](https://github.com/btravstack/entity/tree/main/examples/billing-relational)
stores the `Order` aggregate from the billing domain in four tables, through
[Kysely](https://kysely.dev/). The specs run against
[PGlite](https://pglite.dev/), real Postgres compiled to WASM, so they exercise
genuine transactions and constraints inside the ordinary `pnpm test`, with no
server and no Docker.

```sh
pnpm --filter @btravstack/entity-example-billing-relational test
```

## Three tables for one aggregate, one for another

`orders` and `order_lines` are one aggregate, always written in one
transaction. `customers` is the other aggregate, referenced by a foreign key
and never joined into an order. The `billTo` snapshot lives in columns on
`orders`, copied when the order is placed, and a spec proves it does not follow
the customer when the customer's row changes.

`outbox` holds the events a save announces.

## No casts

Kysely's table types are plain strings and numbers, which is what the driver
returns. Writes come from `toJSON()`, whose branded values fit those columns as
they are. Reads assemble the rows into a plain object and pass it to
`Order.make`, which brands and validates it. A row the domain considers
impossible, such as half a billing snapshot, comes back as an `InvalidEntity`,
and a spec pins that.

## What the specs pin

| Spec                                                                   | What it proves                                                              |
| ---------------------------------------------------------------------- | --------------------------------------------------------------------------- |
| an aggregate round-trips through three tables                          | branded values, owned lines and the snapshot survive storage, no cast       |
| the snapshot is copied, not joined                                     | updating the customer row leaves a placed order's `billTo` unchanged        |
| two saves from the same version                                        | one succeeds, the other is `ConcurrentModification`, no silent overwrite    |
| creating an order whose id is already stored                           | an insert that affects no row is a conflict too                             |
| a reference to a missing customer                                      | a foreign key violation is triaged into `CustomerNotFound`                  |
| a failed transaction commits neither the new state nor its outbox rows | an outbox insert failing last rolls back the order update before it         |
| events are delivered after commit                                      | the relay publishes only committed rows, once                               |
| a version-1 row is migrated at the repository boundary                 | a raw legacy row loads through a pure `migrate`, and heals on the next save |
| a row no migration can save                                            | corrupt data is an `InvalidEntity`, not an exception                        |

## Errors are values

Every repository method returns an `AsyncResult`. Driver rejections enter
through `fromPromise`: the one constraint with a domain meaning becomes a typed
error, and everything else is a Defect. There is no `try`/`catch` in the
adapter.

Related how-to: [Persist an aggregate relationally](/how-to/persist-relationally).
