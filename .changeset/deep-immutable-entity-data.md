---
"@btravstack/entity": minor
---

Make entity data deeply immutable — field values are now deep-frozen at
construction and typed `DeepReadonly<...>`, so `entity.tags.push(...)` is a
compile error and a `TypeError` instead of a silent mutation that could defeat
an invariant; this tightens an existing type and may surface pre-existing
mutation bugs in consumer code.
