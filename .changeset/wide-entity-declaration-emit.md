---
"@btravstack/entity": minor
---

**Declaration emit no longer expands the whole static surface into every consumer's `.d.ts`.**

`EntityStatic` — what `Entity(tag)(fields, options)` returns — was not exported,
so TypeScript had no name to write for it and serialised the entire static
surface structurally into any downstream package compiling with
`declaration: true`: the construct signature, all four `ZodObject`s, both zod
slots, the four phantom carriers and `make`/`extend`/`factory`, with the field
map repeated a dozen times over. A **one-field** entity emitted a 274,048-byte
declaration; it is now 240.

That expansion was two build failures, not a verbosity problem:

- a realistically wide domain enum (30 members, ordinary DDD widths) pushed the
  repeated field map past the compiler's serialisation ceiling — `TS7056`,
  fixable only by abandoning `z.enum` for a branded string and losing both
  runtime membership validation and compile-time exhaustiveness ([#31]);
- a **branded object** field (`z.object({…}).brand("X")`) was expanded through
  `DeepReadonly` until zod's module-private `$brand` symbol reached
  computed-key position, where it cannot be named across a module boundary —
  `TS4020` ([#32]). Branded objects now work, and stay deep-readonly; the
  "model it as a nested entity instead" workaround is no longer needed.

Both surfaced only at the consuming package's build, long after `tsc --noEmit`,
the tests and everything else had gone green.

`EntityStatic` is now a top-level export, and `Entity.Static` for anyone
annotating by hand. Both regressions are pinned by the consumer fixture.

`EntityUnion` and `UnionMember` are exported for the same reason, one type
further along: an exported `const` holding an `Entity.union(...)` had no
top-level name either, so TypeScript expanded its members structurally and
reached `$brand` through any branded field — `TS4023: Exported variable 'X' has
or is using name '$brand' … but cannot be named`. Reported as the second error
in [#32], and reproduced by declaring a union over an entity with a branded
`Money` field.

**The zod peer range widens from `^4.4.0` to `^4.3.0`.** Nothing in the
implementation needed 4.4; the range was simply the version current at the
initial release. The floor is measured — the full surface typechecks, emits
declarations and passes its runtime assertions on 4.3.0. Monorepos that pin one
zod across every package no longer have to move the whole catalog, or relax the
peer locally, to adopt this ([#33]).

[#31]: https://github.com/btravstack/entity/issues/31
[#32]: https://github.com/btravstack/entity/issues/32
[#33]: https://github.com/btravstack/entity/issues/33
