---
"@btravstack/entity": minor
---

Treat `decoded.add` fields as implicitly immutable: they are excluded from `updateInput` and `Patch`, and `update()` drops them at runtime.
