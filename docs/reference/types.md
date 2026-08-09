---
title: Helper types
description: Entity.Input, Entity.Output, Entity.CreateInput, Entity.Patch, Entity.Instance — and the ten declaration-emit names exported at the top level.
---

# Helper types

Every public type hangs off the merged `Entity` namespace, so one import covers
the whole surface.

```ts
import { Entity } from "@btravstack/entity";

type OrgWire = Entity.Input<typeof Organization>; // what make() accepts
type OrgState = Entity.Output<typeof Organization>; // what toJSON() returns
type OrgCreate = Entity.CreateInput<typeof Organization>; // what a factory accepts
type OrgPatch = Entity.Patch<typeof Organization>; // what update() accepts
```

## `Entity.Instance<E>`

The instance type of an entity **or a union** — for a union, the exact member
union, which the class name as a type is not
([why](/explanation/unions-and-roots#why-a-union-s-type-is-its-members-root-not-its-members)):

```ts
class Account extends Entity.union("kind", [Personal, Business]) {}

type AnyAccount = Entity.Instance<typeof Account>; // Personal | Business
type OnePersonal = Entity.Instance<typeof Personal>; // Personal
```

It is read off the declaration, so it cannot drift out of step with the members
the way a hand-written `InstanceType<typeof Personal> | InstanceType<typeof
Business>` silently can. The result narrows under `P.tag(...)` like any other
union of entities.

## The other namespace members

Also `Entity.ComputedField` and `Entity.Invariant`, the shapes `Entity.computed`
and `Entity.invariant` return; `Entity.FieldSpec`, what `Entity.field` returns;
`Entity.Union`, what `Entity.union` returns;
`Entity.Abstract`, what `Entity.abstract(name)(fields, options)` returns; and
`Entity.Static`, the full static surface `Entity(tag)(fields, options)` returns
— the type of the anonymous class the declaration form extends. You rarely name
any of them: the declaration helpers infer their parameters from the
surrounding declaration.

Three of them changed arity in the release that moved `generated`/`immutable`
onto the fields:

| Type                  | Arity             | Was                  |
| --------------------- | ----------------- | -------------------- |
| `Entity.Static`       | `<Tag, S, A, B?>` | `<Tag, S, A, G, I>`  |
| `Entity.Abstract`     | `<Name, S, A>`    | `<Name, S, A, G, I>` |
| `Entity.BaseInstance` | `<S, A>`          | `<S, A, I>`          |

Their top-level spellings moved with them: `EntityStatic<Tag, S, A, B?>` — the
one place `B` was already exposed, so it went from six parameters to four —
`AbstractEntity<Name, S, A>` and `BaseInstance<S, A>`.

The dropped parameters were the generated- and immutable-key unions. They are
computed inside each type's body from the flags `S` carries, and that is the
whole point: a key union standing in **argument position** cannot be de-aliased
by the emitter, so it re-serialises the entire field map at every appearance in
a consumer's `.d.ts`. Measured on the billing fixture, the naive spelling grew
the emitted declarations by 57.8%; computing the unions inside the bodies
instead leaves ~90 bytes per flagged-field appearance, +8.0% total, and no
`GeneratedKeys<` or `ImmutableKeys<` anywhere in the output.

## The declaration-emit names

Ten types are exported at the top level: `AbstractEntity`, `BaseInstance`,
`ConstructionKey`, `EntityStatic`, `EntityUnion`, `FieldSpec`,
`MergedComputed`, `MergedFields`, `Sealed`, `UnionMember`. They are the one
exception to the single-import rule, and none of them is part of the API you
write against. Nine
also have namespace aliases for anyone annotating by hand — `Entity.Abstract`,
`Entity.BaseInstance`, `Entity.ConstructionKey`, `Entity.FieldSpec`,
`Entity.MergedComputed`,
`Entity.MergedFields`, `Entity.Sealed`, `Entity.Static`, `Entity.Union` — but a
consumer's _emitted declarations_ use the top-level names.

```ts
import type {
  AbstractEntity,
  BaseInstance,
  ConstructionKey,
  EntityStatic,
  EntityUnion,
  FieldSpec,
  MergedComputed,
  MergedFields,
  Sealed,
  UnionMember,
} from "@btravstack/entity";
```

The exception exists for one reason: a downstream library compiling with
`declaration: true` emits the **underlying** type name, not the namespace path
that aliases it, so every type its declarations can reach must have a
top-level name. What each one buys was measured, not assumed:

- **`BaseInstance`, `ConstructionKey`, `Sealed`** — the construction seal.
  Kept module-private, a consumer's emitted `extends` clause fails with
  `TS4020: … has or is using private name`. Exported, the emitted `.d.ts`
  references `import("@btravstack/entity").Sealed<…>` and compiles.
- **`EntityStatic`** — what the whole builder returns. With no name to write,
  TypeScript serialises the entire static surface structurally into every
  consumer's `.d.ts`: a one-field entity emitted a 274,048-byte declaration
  (240 bytes with the name), a realistic enum crossed the serialisation
  ceiling (`TS7056`, issue #31), and a branded object field expanded until
  zod's module-private `$brand` symbol could not be named (`TS4020`, #32).
- **`FieldSpec`** — what `Entity.field(schema, flags)` returns, and therefore
  the declared type of every flagged field in a consumer's field map. Their
  `.d.ts` has to name it. `emit-guards.ts` names it too: a namespace member
  emitted as a circular self-alias still compiles, so only a fixture that walks
  it catches the degradation.
- **`AbstractEntity`** — the same story one declaration form over: a consumer
  writing `abstract class X extends Entity.abstract("X")(…) {}` emits the
  underlying name into its declarations, not the `Entity.Abstract` path that
  aliases it.
- **`MergedComputed`** — a root's computed map merged with a variant's, which
  `extend` hands `EntityStatic` as its `A`. Written inline as
  `Omit<A, keyof A2> & A2`, TypeScript 5.9.3 copied the type parameter `A2`
  through unsubstituted whenever the root declared no `computed` — the default
  — so consumers' declarations carried a name that resolved to nothing and
  failed with `TS2304: Cannot find name 'A2'`. 7.0.2 substitutes the same
  position correctly, so only downstream builds saw it. Naming it is half the
  fix and exporting it is the other half: unexported, the emitter expands the
  alias structurally again and the identical dangling `A2` comes back.
- **`MergedFields`** — the same merge for the _field_ map, which `extend` hands
  `EntityStatic` as its `S`. The runtime spreads parent-then-child, so a variant
  redeclaring an inherited field wins; typed as `S & S2` that key read as both
  brands at once. Named and exported from the start rather than measured into
  existence a second time — inline, it carries `MergedComputed`'s hazard with
  `S2` in place of `A2`.
- **`EntityUnion`, `UnionMember`** — the same story for
  `Entity.union(...)` assigned to an exported `const`: without a top-level
  name the members expand structurally and reach `$brand`, failing with
  `TS4023: Exported variable … cannot be named`. `UnionMember` travels with
  `EntityUnion` because it is that type's own constraint.

A fixture in CI compiles a consumer with declaration emit against the built
types, on two TypeScript versions, and then **type-checks what it emitted** —
which is not the same guarantee: `MergedComputed` above was found only because
that last step exists, since a dangling reference in the output is no emit-time
diagnostic. See
[Sealed construction](/explanation/sealed-construction) for what the seal buys
and what the two rejected alternatives cost.
