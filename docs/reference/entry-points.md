---
title: Entry points
description: factory, factoryAsync, make, inspect, update, toJSON and sameIdentityAs — every way in and out of an entity.
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

## `SomeEntity.factory(generators)` → `(input) => Result<SomeEntity, InvalidEntity>` {#someentity-factory-generators-input-result-someentity-invalidentity}

Binds the sources of every field flagged `generated`. Generators are
**functions**, called once per create.

```ts
const createOrg = Organization.factory({
  id: () => ids.next(),
  createdAt: () => clock.now(),
});
createOrg({ slug, name }); // Result<Organization, InvalidEntity>
```

Pass an arrow, not a bare method reference — `{ id: ids.next }` loses `this`.

Each generator returns its field schema's **input**, not the branded output:
generated values go through `make`'s validation like any other data, so
`() => crypto.randomUUID()` needs no cast.

An entity that flags no field `generated` still has a factory: its
generators map has no keys, so `{}` is what you pass.

```ts
class Note extends Entity("Note")({ id: NoteId, label: Label }) {}

const createNote = Note.factory({});
createNote({ id, label }); // Result<Note, InvalidEntity>
```

That call is the fully-typed way in for such an entity — every caller field is
named and type-checked, where `Note.make(data)` takes `unknown`.

## `SomeEntity.factoryAsync(generators)` → `(input) => AsyncResult<SomeEntity, InvalidEntity>` {#someentity-factoryasync-generators-input-asyncresult-someentity-invalidentity}

The same for promise-returning generators — an id from a database sequence,
say. A generator that **rejects** surfaces as a `Defect`, not an
`InvalidEntity`: infrastructure failing is not the same as bad domain input.
A synchronous generator that **throws** under `factory` takes the same channel.

```ts
const createOrgAsync = Organization.factoryAsync({
  id: () => ids.nextFromSequence(),
  createdAt: () => clock.now(),
});
(await createOrgAsync({ slug, name })).getOrThrow();
```

## `SomeEntity.make(data)` → `Result<SomeEntity, InvalidEntity>` {#someentity-make-data-result-someentity-invalidentity}

The only way in. Validates against `input`, re-derives the computed fields,
checks the invariants, constructs. Extra keys are ignored, so a stored row
carrying computed columns round-trips.

`data` is `unknown`, which is what lets a driver's row in without a cast — and
it means the compiler checks nothing at the call site. `Entity.Input<typeof X>`
names the shape `make` accepts, so a hand-written literal can opt back into the
full check with `satisfies`:

```ts
const orgId = (value: string) => OrgId.parse(value);
const orgSlug = (value: string) => Slug.parse(value);
const orgName = (value: string) => DisplayName.parse(value);
const orgCreatedAt = (value: string) => Instant.parse(value);

const row = {
  id: orgId("0199b1f4-1b1e-7000-8000-000000000000"),
  slug: orgSlug("acme"),
  name: orgName("Acme SA"),
  createdAt: orgCreatedAt("2026-08-06T09:00:00.000Z"),
} satisfies Entity.Input<typeof Organization>;

Organization.make(row); // Result<Organization, InvalidEntity>
```

`satisfies` rather than a type annotation, so `row` keeps its literal type and
stays usable as itself.

`Entity.Input` is the **parsed, branded** shape, so the values must be branded
too — which is why the helpers above are part of the pattern rather than
decoration. Written with bare literals (`slug: "acme"`), the same object fails
on every branded field. That failure is the brand doing its job: an unbranded
string is not a `Slug`, and this is the one form that says so at the call site.

## `SomeEntity.inspect(data)` → `Result<Inspection<Output>, InvalidEntity>` {#someentity-inspect}

Reads a stored row **without** enforcing the invariants, and never yields an
entity. Use it for a row that may predate a rule:

```ts
const { data, violations } = Mission.inspect(row).getOrThrow();
violations.map(Entity.codeOf); // ["MISSING_FAILURE_REASON"]
```

It does what `make` does, up to the last step:

| Step                     | `make`              | `inspect`                      |
| ------------------------ | ------------------- | ------------------------------ |
| validate against `input` | `InvalidEntity`     | `InvalidEntity`, the same      |
| re-derive `computed`     | yes                 | yes                            |
| check the invariants     | `InvalidEntity`     | reported in `violations`       |
| a predicate that throws  | defect              | defect                         |
| result                   | the entity instance | plain frozen data, no instance |

`Inspection<D>` is `{ readonly data: DeepReadonly<D>; readonly violations: SchemaIssues }`,
named `Entity.Inspection` for annotations. `violations` holds every broken
rule, each as the issue `make` would have failed with,
`{ message, params: { code } }`, so
[`Entity.codeOf`](/reference/errors#entity-codeof-issue) reads it. It is empty
for a row that satisfies every rule, and then `data` equals
`make(row).toJSON()`.

`data` is not an entity. It has no `_tag`, no `update`, no `sameIdentityAs`
and no class-body members, and its type is not assignable to the entity type.
It cannot reach a command by accident. The way back into the command model is
a migration, then `make`.

A nested entity field is inspected **strictly**: it is parsed as `make` parses
it, so a nested row that breaks its own invariant fails the parent's `inspect`
with an `InvalidEntity`, the nested issue's code and path intact.

An `Entity.union` has `inspect` too. It dispatches on the discriminant like
its `make`, and an unknown discriminant is the same `InvalidEntity`. An
abstract root has no `make`, so it has no `inspect` either.

[Add a stricter rule without an outage](/how-to/add-a-stricter-rule) puts it to
work: a data-quality job, a read model, and the rollout order.

## `SomeAggregate.start(event)` → `Result<Decision<SomeAggregate, Event>, never>` {#someaggregate-start}

Creates an aggregate from one of its **creation** events, the keys of `opens`.
Another event type does not compile. The event is parsed against the declared
union, handed to its `opens` handler, and the record it returns goes through
`make`. A failure at any step is a defect: creation is a command, so an event
that breaks the aggregate is a bug in it.

## `aggregate.emit(...events)` → `Result<Decision<this, Event>, never>` {#aggregate-emit}

What an aggregate's command returns after its business checks. Parses each
event against the declared union, folds the events onto the current state with
the `evolve` handlers, and verifies the result with `make`. The `Decision`
holds the parsed events and the verified state; the source aggregate is
unchanged.

An event that breaks an invariant, fails its schema, or reaches a handler that
throws is a **defect**, never an `Err`: a decision that cannot hold is a bug in
the command, and nothing about it should be persisted. Only `emit` and `start`
build a `Decision`; a hand-written `{ state, events }` does not compile.

## `SomeAggregate.replay(events)` → `Result<SomeAggregate, InvalidEntity>` {#someaggregate-replay}

A stored stream → the aggregate, emitting nothing. The stream is untrusted, so
every event is parsed; a bad one is an `InvalidEntity` whose issue path starts
with its index (`[3, "seats"]`). The first event must be a creation event, and a
creation event later in the stream is refused at its index. The fold ends in
`make`, which is strict: a stream breaking a rule added since is an
`InvalidEntity`, as a row would be. Upcast old event versions before calling
it.

## `entity.update(patch)` → `Result<SomeEntity, InvalidEntity>` {#entity-update-patch-result-someentity-invalidentity}

Returns a **new** entity. Re-runs the invariants and re-derives the computed
fields.

The patch must contain only keys `updateInput` accepts. A key that is flagged
`immutable`, or is `computed`, or is not a field of the entity at all, is
**rejected**
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

## `entity.toJSON()` → `DeepReadonly<Output>` {#entity-tojson-deepreadonly-output}

Projects exactly `output`'s keys. Excludes `_tag` and any class-body fields.
Called implicitly by `JSON.stringify`.

The return type is `DeepReadonly` because the projection is shallow: the
top-level object is fresh, but every nested container is the instance's own
frozen reference. Typed as the plain mutable shape,
`org.toJSON().tags.push(…)` compiled and threw `object is not extensible` at
runtime — the readonly type makes the freeze visible at compile time. Need a
mutable copy? Clone: `structuredClone(org.toJSON())`.

## `entity.sameIdentityAs(other)` → `boolean` {#entity-sameidentityas-other-boolean}

True when `other` is the **same business entity**: it belongs to the same
identity scope, and every field flagged `identity` is equal by `Object.is`.
Attributes are not compared, so a renamed organization is still the same
organization:

```ts
const renamed = org.update({ name: name("Acme Corp") }).getOrThrow();
renamed.sameIdentityAs(org); // true
```

The scope is the class that declares the identity. On a plain entity that is
the entity itself, so an unrelated entity with an equal id is never the same.
On an abstract root it is the root, so every variant shares it: a draft and the
issued document it became compare as one entity. A non-entity, `null` or
`undefined` gives `false`, never a throw.

Only an entity that flags at least one field `identity` has the method; on any
other it is a compile error whose message names `__declareAnIdentityFieldToCompareIdentity`.

There is no structural `equals`. To compare two whole stored states, compare
their `toJSON()` with the deep-equality function of your choice, such as
`node:util`'s `isDeepStrictEqual`. [Tags and identity](/explanation/tags-and-identity#four-kinds-of-sameness)
explains why the package keeps only identity.
