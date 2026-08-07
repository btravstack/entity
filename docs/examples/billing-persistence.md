---
title: Persistence example
description: Storing and rehydrating entities — toJSON() out, make() back, with a corrupt row arriving as a Result rather than a throw.
---

# Persistence

[`examples/billing-persistence`](https://github.com/btravstack/entity/tree/main/examples/billing-persistence)
— an entity out to a row, and a row back to an entity.

```sh
pnpm --filter @btravstack/entity-example-billing-persistence test
```

## The round trip

```ts
save(organization: Organization): void {
  this.#rows.set(organization.id, organization.toJSON());
}
```

`toJSON()` is the only projection the package offers, and it **is** the stored
shape. No mapper to keep in sync, and `_tag` never reaches a row — it is a
non-enumerable instance property, so it survives neither `JSON.stringify` nor a
spread. The spec asserts that explicitly, because it is the sort of thing that
starts leaking quietly.

```ts
byId(id): Result<Organization, InvalidEntity | OrganizationNotFound> {
  const row = this.#rows.get(id);
  if (row === undefined) return Err(new OrganizationNotFound());
  return Organization.make(row);
}
```

`make()` validates on the way in. Rows outlive models — a column dropped two
migrations ago is still sitting in production — so the boundary where old data
becomes a live object is exactly where a check belongs.

What comes back is a real instance, behaviour included, not a bag of data. The
spec checks that by calling a getter on a rehydrated entity.

## Two errors, not one

A missing row and a **corrupt** row are different facts: the first is a 404, the
second is data worth paging someone about. Folding them into one error discards
the only thing that separates them.

The library defines no `NotFound` on purpose — whether an absent row is
exceptional is a repository's decision, not an entity's — so the example models
it with `unthrown`'s `TaggedError` and discriminates the two with an exhaustive
matcher:

```ts
loaded.match({
  ok: (organization) => organization,
  errCases: (m) =>
    m
      .with(P.tag("InvalidEntity"), () => 422)
      .with(P.tag("OrganizationNotFound"), () => 404),
  defect: () => 500,
});
```

Because the matcher is exhaustive, the day this repository grows a third error
those call sites stop compiling until someone decides what to do about it.

There is no `try`/`catch` anywhere in the file.

## Swapping the store

The store is a `Map`. Replace it with a driver and nothing else in the file
changes shape — which is the point of the entity knowing nothing about
persistence in the first place.

Related how-to: [Persist and rehydrate](/how-to/persist-and-rehydrate).
