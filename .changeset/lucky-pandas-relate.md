---
"@btravstack/entity": minor
---

**BREAKING**: remove `encode()`; `toJSON()` is now the only public projection.

The two returned identical data under two names, which is the alias this
package's "one concept = one name" rule exists to prevent. `toJSON()` is not a
name this package chose — it is the hook `JSON.stringify` looks for, and it has
to exist regardless, or serializing an entity leaks a subclass's own instance
fields. That made `encode()` the removable one.

`encode()` was also misnamed: it returned the _stored_ (`decoded`) shape while
the exported `Encoded<T>` helper names the _wire_ shape. For an entity using
`decoded: { omit, add }` those genuinely differ, which is why
`decode(x.encode())` never round-tripped.

Migration: replace `x.encode()` with `x.toJSON()`. `toJSON()` pairs with
`make`, not `decode` — `Entity.make(x.toJSON())`.
