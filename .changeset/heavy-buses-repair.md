---
"@btravstack/entity": minor
---

Two correctness fixes, honest `toJSON` typing, and readable errors.

- **Fix: `deepEqual` no longer remembers failed comparisons as equal.** The
  cycle guard recorded every pair it entered and never forgot one that
  finished `false`, so two `Set`/`Map` fields with plainly different contents
  could compare equal once their elements shared a subtree. The guard is now a
  stack of in-progress pairs, not a memo.
- **Fix: `deepFreeze` no longer freezes caller-owned values under a union
  branch.** The schema walk lost context at `union`, `pipe` and
  `intersection` boundaries, so a `z.custom(...)` value nested inside one was
  frozen in place — mutating an object the caller still owns. The walk now
  carries context through all three.
- **`toJSON()` returns `DeepReadonly<Output>`.** The projection is shallow:
  the top-level object is fresh, but nested containers are the instance's own
  frozen references, so the previous mutable type let
  `toJSON().tags.push(…)` compile and throw at runtime.
- **`InvalidEntity.message` is populated** — `"<entity>: <path>: <message>; …"` —
  so a log line or a failed assertion names the entity and the failing fields
  instead of printing a blank `Error`. The structured `issues` are unchanged.
- **New `Entity.renderIssue` and `Entity.keysOf`** — the issue helpers an
  adapter needs to turn an `InvalidEntity` into a response body, the same ones
  the message is built from.
- **A duplicate union discriminant value is a declaration-time defect.**
  `Entity.union` previously let the last member win while zod threw lazily at
  the first parse; it now fails at the declaration, naming both members.
- **The construction seal's property is named `__useMakeOrFactoryInstead`**, so
  the compile error on `new SomeEntity(…)` tells the reader what to do.
