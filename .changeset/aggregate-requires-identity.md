---
"@btravstack/entity": minor
---

**Breaking:** `Entity.aggregate` now requires at least one field flagged
`identity: true`. An aggregate root is what other aggregates reference and what
a repository loads, so a field map without one is a compile error, and a
declaration that gets past the types throws while it runs. `sameIdentityAs` is
therefore always available on an aggregate.

To migrate, flag the aggregate's id: `id: Entity.field(SomeId, { identity: true })`.
`Entity` is unchanged: identity stays optional there.
