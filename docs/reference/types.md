---
title: Helper types
description: Entity.Input, Entity.Output, Entity.CreateInput, Entity.Patch — and the three seal names exported at the top level.
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

Also `Entity.ComputedField` and `Entity.Union`, the shapes `Entity.computed` and
`Entity.union` return.

## The seal names

`BaseInstance`, `ConstructionKey` and `Sealed` are the one exception to the
single-import rule: they are exported at the top level **as well as** under
`Entity`, because a downstream library compiling with `declaration: true` emits
the underlying name rather than the namespace path that aliases it, and would
otherwise fail with `TS4020`. They are not part of the API you write against.

```ts
import type { BaseInstance, ConstructionKey, Sealed } from "@btravstack/entity";
```

That is measured, not assumed: a fixture in CI compiles a consumer with
declaration emit against the built types, so it cannot regress. See
[Sealed construction](/explanation/sealed-construction) for what the seal buys
and what the two rejected alternatives cost.
