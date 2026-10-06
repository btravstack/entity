---
"@btravstack/entity": minor
---

**Breaking:** structural `equals` is removed, and entities compare by declared
identity instead.

- `Entity.field(schema, { identity: true })` marks a field as part of the
  entity's business identity. Several flagged fields form a composite
  identity. It implies `immutable`, and the value must be a required primitive.
- `entity.sameIdentityAs(other)` is true when `other` is in the same identity
  scope and every identity field is equal by `Object.is`. The scope is the
  class that declares the identity, or the abstract root when it is declared
  there, so a root's variants (a draft and the document it became) share it.
  On an entity with no identity field, calling it is a compile error.
- `equals` is gone, and with it the package's only Node import
  (`node:util`'s `isDeepStrictEqual`), so the package now bundles for the
  browser. To compare two whole states, compare their `toJSON()` with your own
  deep-equality function.
- `sameIdentityAs` replaces `equals` as a reserved field name.

To migrate, flag your id fields `identity: true` and replace `a.equals(b)` with
`a.sameIdentityAs(b)` where you meant "the same entity", or with a deep
comparison of `toJSON()` where you meant "the same state".
