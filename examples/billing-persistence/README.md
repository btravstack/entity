# billing-persistence

The storage half: an entity out to a row, and a row back to an entity.

```sh
pnpm --filter @btravstack/entity-example-billing-persistence test
```

## The round trip

```ts
repository.save(organization); // organization.toJSON() → the row
repository.byId(id); // Organization.make(row) → Result<Organization, …>
```

`toJSON()` is the only projection the package offers, and it **is** the stored
shape. There is no mapper to keep in sync, and `_tag` never appears in a row:
it is a non-enumerable instance property, so it survives neither
`JSON.stringify` nor a spread. The spec asserts that, because it is the sort of
thing that silently starts leaking.

`make()` is the way back in, and it validates. Rows outlive models — a column
you dropped two migrations ago is still sitting in production — so the boundary
where old data becomes a live object is exactly where you want a check.

## Two errors, not one

`byId` returns `Result<Organization, InvalidEntity | OrganizationNotFound>`.

A missing row and a _corrupt_ row are different facts: the first is a 404, the
second is data worth paging someone about. Collapsing them into one error
throws away the only information the caller needs to tell them apart.

The library deliberately defines no `NotFound` — whether an absent row is
exceptional is a repository's decision, not an entity's — so this package
models it with `unthrown`'s `TaggedError`. The specs discriminate the two with
an exhaustive matcher, which means the day this repository grows a third error,
those call sites stop compiling until someone decides what to do about it.

Nothing here throws. There is no `try`/`catch` in the file.

## Swapping the store

The store is a `Map`. Replace it with a driver and nothing else in this file
changes shape — which is the point of the entity knowing nothing about
persistence.

See also the how-to: [Persist and
rehydrate](https://btravstack.github.io/entity/how-to/persist-and-rehydrate).

## Gapless numbering

`numbering.ts` is the other half of writing an entity down: giving it a number
a regulator will count. A `DraftInvoice` has no `number` field at all, an
`IssuedInvoice` has one that is `generated` and `immutable`, and both are
variants of one root — so the numberless state is not a nullable column typed
into every read site forever.

```ts
issue(numbers, at)(draft); // DraftInvoice → Result<IssuedInvoice, InvalidEntity>
```

The counter here is a `Map`, standing in for `update invoice_counter set last =
last + 1 … returning last` inside the transaction that writes the row. That
transaction is where gaplessness actually comes from: a database _sequence_
hands out numbers outside it, so a rollback burns one permanently. The spec
pins the case that proves it — an invariant rejecting an issue **after** the
number was allocated, and the next invoice still taking that number.

See also the how-to: [Number without
gaps](https://btravstack.github.io/entity/how-to/number-without-gaps).
