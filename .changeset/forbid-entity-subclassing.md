---
"@btravstack/entity": minor
---

**BREAKING**: subclassing an entity class is no longer supported.

`class Sub extends SomeEntity {}` now fails at construction with a `Defect` —
a bug in domain code, not bad caller input, so it is not an `InvalidEntity`.
One `extends` is the declaration form and is unaffected; so is using the
builder's return directly without `extends`.

Behaviour belongs in the entity's own class body, which is unchanged: extra
fields stay writable and are still absent from `toJSON()`.

The prohibition is runtime-only. TypeScript has no `final`, so
`class Sub extends SomeEntity {}` still compiles and reports on first
construction.
