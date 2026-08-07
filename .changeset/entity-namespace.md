---
"@btravstack/entity": minor
---

**Breaking.** The package now exports one name to write against: `Entity`.

`computed`, `InvalidEntity` and every public type move onto it. A bare
`computed` was too generic to take from a consumer's import scope — it collides
outright with Vue, MobX, Angular signals and Solid — and the same reasoning
already put `union` under `Entity`. Applying it consistently collapses the
surface to a single import.

| before                                 | after                  |
| -------------------------------------- | ---------------------- |
| `computed`                             | `Entity.computed`      |
| `InvalidEntity`                        | `Entity.InvalidEntity` |
| `Input` `Output` `CreateInput` `Patch` | `Entity.Input` …       |
| `ComputedField`                        | `Entity.ComputedField` |
| `EntityUnion`                          | `Entity.Union`         |

```diff
-import { Entity, computed } from "@btravstack/entity";
-import type { Output } from "@btravstack/entity";
+import { Entity } from "@btravstack/entity";

 class Person extends Entity("Person")(
   { first: First, last: Last },
-  { computed: { fullName: computed(FullName, (d) => …) } },
+  { computed: { fullName: Entity.computed(FullName, (d) => …) } },
 ) {}

-type Row = Output<typeof Person>;
+type Row = Entity.Output<typeof Person>;
```

No deprecated top-level aliases are kept.

`BaseInstance`, `ConstructionKey` and `Sealed` stay top-level exports as well as
namespace members, and are the one exception. A downstream library compiling
with `declaration: true` emits the underlying type name rather than the
namespace path that aliases it, so hiding them behind `Entity` fails that build
with `TS4020`. They were never part of the API you write against.
