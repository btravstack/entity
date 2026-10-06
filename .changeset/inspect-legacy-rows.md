---
"@btravstack/entity": minor
---

Add `SomeEntity.inspect(state)`, a read-side door for stored rows written before a rule existed. It validates the field schemas strictly and re-derives `computed` like `make`, then reports every broken invariant instead of refusing the row: `Result<Inspection<Output>, InvalidEntity>`, where `Inspection` is `{ data, violations }`.

`data` is plain frozen data, never an entity instance, so a row that breaks today's rules cannot reach a command by accident. The way back is a migration, then `make`, which stays strict. `violations` are the issues `make` would have failed with, so `Entity.codeOf` reads them. A field failure is still `InvalidEntity`, a throwing predicate is still a defect, and a nested entity field is inspected strictly.

`Entity.union` gains `inspect` too, dispatching on the discriminant. `Inspection` joins the top-level declaration-emit names, with `Entity.Inspection` for annotations. The new how-to, "Add a stricter rule without an outage", covers the rollout.
