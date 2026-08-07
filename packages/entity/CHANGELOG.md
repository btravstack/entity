# @btravstack/entity

## 0.2.0

### Minor Changes

- b5758a5: **Declaration emit no longer expands the whole static surface into every consumer's `.d.ts`.**

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

### Patch Changes

- 9503929: Point the package README at the new documentation site,
  <https://btravstack.github.io/entity/>, instead of the Markdown files in the
  repository. No code change.

## 0.1.0

Initial release.

A domain-entity builder on zod v4. One declaration —
`class X extends Entity("X")(fields, options)` — yields a type, four plain
`ZodObject` validators, behaviour, and a class that is itself a zod schema.
Every fallible operation returns an `unthrown` `Result<T, InvalidEntity>`
instead of throwing.

### The surface

- **`Entity(tag)(fields, options?)`** derives `input`, `output`, `createInput`
  and `updateInput` from one field map plus `generated`, `immutable`,
  `computed` and `invariants`. Fields must be nominal — a branded schema, a
  narrow literal union, a boolean, or another entity — enforced at compile time.
- **`Entity.computed(schema, from)`** declares a derived field. It is re-derived
  on every construction path, so it cannot drift from its sources, and a stored
  row carrying a stale value is corrected on read rather than trusted.
- **`Entity.invariant(ensure, message)`** declares a rule spanning the whole
  entity. Every failing rule reports, and its issue carries no `path` — that
  absence is what distinguishes a whole-entity rule from a field complaint.
- **`Entity.union(discriminant, members)`** dispatches on a declared field
  rather than trying each branch, so a failing member reports its own issues.
- **`SomeEntity.make`, `.factory`, `.factoryAsync`, `.extend`**, and instance
  `update`, `toJSON`, `equals`. `make` is the only way in: a database row, a
  folded event stream and an untrusted payload all take the same path.

Everything you write against hangs off `Entity`. `BaseInstance`,
`ConstructionKey` and `Sealed` are also exported, but only so a downstream
library compiling with `declaration: true` can name them.

### What it guarantees

- **Sealed construction.** `new SomeEntity(...)` does not compile, so every
  instance has passed its invariants. The seal is a type, not a runtime check —
  a runtime guard would mean throwing.
- **Deep immutability.** Fields are installed non-writable _and_ their values
  deep-frozen, so `org.tags.push(…)` cannot push an entity into a state its own
  invariants rejected. A `z.custom`/`z.instanceof` value is left alone at any
  depth: it is the caller's own reference, and freezing it in place would break
  code that still owns it.
- **Errors are values.** Bad input is `InvalidEntity`, carrying structured
  Standard Schema issues. A bug in domain code — a `computed` function throwing,
  a rejecting async generator, subclassing an entity — is a separate defect
  channel.
- **No I/O.** The package reads no clock and generates no id. Generators are
  bound at your composition root, which is also what lets a test supply fixed
  ones without stubbing globals.

### Composition

An entity class is a zod schema, so entities nest inside each other and inside
ordinary `z.object`/`z.array` without losing their identity, behaviour or
issue paths. Contracts compose the four plain `ZodObject`s; domain code composes
the class. `z.toJSONSchema(SomeEntity, { io: "output" })` throws by design — the
class carries a transform, which is why the four plain objects exist separately.
