---
"@btravstack/entity": minor
---

**Breaking:** an aggregate's decision now carries everything a repository
needs to save it.

- `Entity.Decision` gains `expectedVersion`, the version the store must still
  be at, and its `events` now hold **every** event decided since the aggregate
  was loaded. A chain of commands saves as one decision without losing the
  earlier events; reusing an already-saved state yields a conflict, never an
  overwrite.
- An aggregate's `make` requires the version: `make(row, { version })`.
  `replay` takes the stream's length, and `start` is version `0`.
- The version is kept beside the instance, not on it: no reserved field name,
  nothing in `toJSON()`, and the package never interprets the number.

To migrate, pass `{ version }` to an aggregate's `make`, and drop the separate
version argument from a repository's `save`: read `decision.expectedVersion`
instead. `Entity`'s `make` is unchanged.
