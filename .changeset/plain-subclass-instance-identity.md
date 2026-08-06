---
"@btravstack/entity": patch
---

`instance` and `~standard` now memoise per class, so a plain `class Y extends X {}` decodes to a `Y` regardless of read order.
