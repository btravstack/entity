---
"@btravstack/entity": patch
---

A downstream library compiling with `declaration: true` can now export a value
whose inferred type runs a branded object through the package's deep-readonly
data type. That includes `SomeEntity.factory(...)` for an entity with a
nested-entity field. Declaration emit used to fail with `TS4023` (`$brand`
cannot be named); the brand now prints as `z.$brand<…>`.
