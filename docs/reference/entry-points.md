---
title: Entry points
description: factory, factoryAsync, make, update, toJSON and equals — every way in and out of an entity.
---

# Entry points

Every way an entity comes into existence, and the two projections out of one.
There is no other: `new SomeEntity(…)`
[does not compile](/explanation/sealed-construction).

> Snippets on this page assume these imports:
>
> ```ts
> import { z } from "zod";
> import { Entity } from "@btravstack/entity";
> ```

## `SomeEntity.factory(generators)` → `(input) => Result<SomeEntity, InvalidEntity>`

Binds the `generated` fields' sources. Generators are **functions**, called
once per create.

```ts
const createOrg = Organization.factory({
  id: () => ids.next(),
  createdAt: () => clock.now(),
});
createOrg({ slug, name }); // Result<Organization, InvalidEntity>
```

Pass an arrow, not a bare method reference — `{ id: ids.next }` loses `this`.

## `SomeEntity.factoryAsync(generators)` → `(input) => AsyncResult<SomeEntity, InvalidEntity>`

The same for promise-returning generators — an id from a database sequence,
say. A generator that **rejects** surfaces as a `Defect`, not an
`InvalidEntity`: infrastructure failing is not the same as bad domain input.

```ts
const createOrgAsync = Organization.factoryAsync({
  id: () => ids.nextFromSequence(),
  createdAt: () => clock.now(),
});
(await createOrgAsync({ slug, name })).getOrThrow();
```

## `SomeEntity.make(data)` → `Result<SomeEntity, InvalidEntity>`

The only way in. Validates against `input`, re-derives the computed fields,
checks the invariants, constructs. Extra keys are ignored, so a stored row
carrying computed columns round-trips.

## `entity.update(patch)` → `Result<SomeEntity, InvalidEntity>`

Returns a **new** entity. Re-runs the invariants and re-derives the computed
fields.

The patch must contain only keys `updateInput` accepts. A key that is
`immutable`, `computed`, or not a field of the entity at all is **rejected**
with an `InvalidEntity` carrying that key in `path` — every offending key
reports, not just the first. They are absent from the patch type too, but the
compile-time guard only fires on object literals: an adapter that builds its
patch as a `Record<string, unknown>` gets no excess-property check, which is
why the runtime check exists.

This is the opposite of `make`, deliberately. `make` ignores extra keys so a
stored row carrying computed columns round-trips; `update` refuses them so a
change the caller asked for cannot silently not happen. Rehydrating data and
patching it are different acts: one heals what is already written, the other
states an intent.

## `entity.toJSON()` → `DeepReadonly<Output>`

Projects exactly `output`'s keys. Excludes `_tag` and any class-body fields.
Called implicitly by `JSON.stringify`.

The return type is `DeepReadonly` because the projection is shallow: the
top-level object is fresh, but every nested container is the instance's own
frozen reference. Typed as the plain mutable shape,
`org.toJSON().tags.push(…)` compiled and threw `object is not extensible` at
runtime — the readonly type makes the freeze visible at compile time. Need a
mutable copy? Clone: `structuredClone(org.toJSON())`.

## `entity.equals(other)` → `boolean`

True when both are the same entity and their stored data is deep-equal.
Compares the stored data **structurally**, so entities holding equal arrays
compare equal. `Set`, `Map` and typed-array fields compare by contents, `Date`
by timestamp, `bigint` like any other primitive, and a nested object or record
is compared key-by-key rather than by key order. Arrays stay order-sensitive.
Two separate `Entity(...)` calls never compare equal, even with identical
fields.
