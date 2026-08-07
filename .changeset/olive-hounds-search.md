---
"@btravstack/entity": minor
---

`update()` rejects a patch key it cannot apply, instead of dropping it silently.

A patch may now carry only keys `updateInput` accepts. A key that is
`immutable`, `computed`, or not a field of the entity at all comes back as an
`InvalidEntity` with that key in `path` — every offending key reports, not
just the first.

All three were silently discarded before while `update` returned `Ok`: the
caller asked for a change, got a success, and the change never happened. The
patch type already excluded them, but TypeScript's excess-property check only
fires on object literals, so the common adapter shape — building a patch as a
`Record<string, unknown>` from a request body — evaded it entirely and the key
vanished into a passing `Result`.

`make` is deliberately unchanged: it still ignores extra keys, so a stored row
carrying computed columns round-trips. Rehydrating data and patching it are
different acts — one heals what is already written, the other states an intent.

**Breaking** for code that relied on the drop, most likely
`update(someWholeOutputObject)`. Patch only the fields you mean to change, or
narrow the object first — `updateInput.parse(body)` strips unknown keys and
gives you a patch that is accepted by construction.
