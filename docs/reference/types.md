---
title: Helper types
description: Entity.Input, Entity.Output, Entity.CreateInput, Entity.Patch — and the six declaration-emit names exported at the top level.
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

Also `Entity.ComputedField` and `Entity.Invariant`, the shapes `Entity.computed`
and `Entity.invariant` return; `Entity.Union`, what `Entity.union` returns; and
`Entity.Static`, the full static surface `Entity(tag)(fields, options)` returns
— the type of the anonymous class the declaration form extends. You rarely name
any of them: the declaration helpers infer their parameters from the
surrounding declaration.

## The declaration-emit names

Six types are exported at the top level: `BaseInstance`, `ConstructionKey`,
`EntityStatic`, `EntityUnion`, `Sealed`, `UnionMember`. They are the one
exception to the single-import rule, and none of them is part of the API you
write against. Five also have namespace aliases for anyone annotating by hand —
`Entity.BaseInstance`, `Entity.ConstructionKey`, `Entity.Sealed`,
`Entity.Static`, `Entity.Union` — but a consumer's _emitted declarations_ use
the top-level names.

```ts
import type {
  BaseInstance,
  ConstructionKey,
  EntityStatic,
  EntityUnion,
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
- **`EntityUnion`, `UnionMember`** — the same story for
  `Entity.union(...)` assigned to an exported `const`: without a top-level
  name the members expand structurally and reach `$brand`, failing with
  `TS4023: Exported variable … cannot be named`. `UnionMember` travels with
  `EntityUnion` because it is that type's own constraint.

A fixture in CI compiles a consumer with declaration emit against the built
types, so none of this can regress. See
[Sealed construction](/explanation/sealed-construction) for what the seal buys
and what the two rejected alternatives cost.
