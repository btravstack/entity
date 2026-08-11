---
"@btravstack/entity": patch
---

Document the self-referencing deriver idiom (#60): a `computed` deriver or an
`Entity.invariant` predicate may call the entity's own statics, given an
explicit return annotation — `(d): boolean => Doc.isActive(d.tags)`. The
unannotated form is `TS2506`, which is TypeScript resolving the deriver's
inferred return type inside the class's own base expression, not a rule of
the library. The annotation is still checked against both the body and the
schema. `computed.test-d.ts` pins the idiom, the wrong-annotation errors, and
the `this`-parameter dead end (`TS2502`).

Documentation only; no runtime or API change.
