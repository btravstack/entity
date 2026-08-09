# @btravstack/entity

## 0.5.0

### Minor Changes

- cea1120: Producer callbacks are now typed as their schema's **input**, so the cast they
  all carried is gone:

  ```ts
  // before
  shout: Entity.computed(Upper, (d) => d.name.toUpperCase() as z.infer<typeof Upper>),
  id: () => crypto.randomUUID() as z.infer<typeof OrgId>,

  // after
  shout: Entity.computed(Upper, (d) => d.name.toUpperCase()),
  id: () => crypto.randomUUID(),
  ```

  Nothing changes at runtime: a computed value was always parsed by its own schema
  on every construction path, and generated values always went through `make`'s
  validation. The types now say so. Existing code compiles unchanged — a branded
  return still assigns to its schema's input.

  One narrowing: a generator for a field that is both `.optional()` and
  `generated` was an optional key and is now required (it may return `undefined`).
  Declaring that combination is not known to occur anywhere.

- a280317: Type a root's merged field map as child-wins, matching the runtime.

  `Root.extend(tag)(fields)` merges fields with `{ ...parent.fields, ...nextFields }`, so
  a variant redeclaring an inherited field wins. The types said `S & S2`, which typed
  that key as both brands at once while the schema held was the child's alone —
  the same lie already fixed for the `computed` map. The merge is now
  `MergedFields<S, S2>` — `Omit<S, keyof S2> & S2` — at `extend`'s return type and at
  its `computed` and `invariants` input positions, so a rule's `d` reads a redeclared
  field honestly too.

  Nothing changes at runtime, and no entity _declaration_ that compiled stops
  compiling — the change is confined to what `extend` reports for a redeclared key.
  Code **consuming** such a key is what may break: an assignment relying on the
  _root's_ brand there was always unsound, since the value never carried that brand,
  and it now fails to compile instead of passing silently. As with `computed`, the honest
  surfaces are `Entity.Output`, `toJSON()` and `output.shape` — an _instance_ still
  reads as the intersection, because a root's instance type reaches a variant
  unmapped (`TS2425`).

  `MergedFields` is exported at the top level, and as `Entity.MergedFields`, for the
  reason `MergedComputed` is: written inline, the 5.9.3 emitter copies the type
  parameter through unsubstituted and a consumer's declarations fail with `TS2304`.

## 0.4.0

### Minor Changes

- 3ba6b63: Add `Entity.abstract(name)(fields, options?)`, a tagless root that carries shared
  fields **and shared behaviour** into every entity extended from it, and make
  `Entity.union(...)` return a class so a union can be declared with
  `class X extends Entity.union(...) {}` and used as a type. `Entity.Instance<T>`
  recovers an entity's or a union's instance type.

  A root is a real supertype: `variant instanceof Root` is true, an `abstract`
  member on the root is enforced on every variant (`TS2515`), and a
  behaviour-only intermediate `abstract class` between the two is picked up. A
  union's class body is for **statics** — it has no instances, and as a type it is
  the root its members share; `Entity.Instance<typeof X>` is the exact member
  union.

  **Breaking:** `extend` is no longer on an entity — an entity is final. Wrap the
  shared fields in an abstract root and declare both entities as variants of it:

  ```ts
  // before
  class Person extends Entity("Person")({ id: Id, name: Name }) {}
  class PersonWithAge extends Person.extend("PersonWithAge")({ age: Age }) {}

  // after
  abstract class PersonBase extends Entity.abstract("Person")({
    id: Id,
    name: Name,
  }) {}
  class Person extends PersonBase.extend("Person")({}) {}
  class PersonWithAge extends PersonBase.extend("PersonWithAge")({
    age: Age,
  }) {}
  ```

  A root is where behaviour shared by every variant lives, which is what the old
  `extend` could not carry: it rebuilt from the declaration alone, so class-body
  members had to be written again per extension.

- c554864: `extend` options now accumulate instead of replacing. `generated` and
  `immutable` concatenate root-then-variant, and `computed` merges per key — the
  rule `invariants` already followed. A variant adds to what its root declared and
  can no longer shed it.

  Before, a variant that declared `immutable` replaced the root's list wholesale,
  so this silently made `issuedAt` and `issuedTo` patchable:

  ```ts
  // root
  abstract class BillingDocumentBase extends Entity.abstract("BillingDocument")(
    fields,
    { immutable: ["issuedAt", "issuedTo"] },
  ) {}
  // variant — before this change, the root's two were gone, with no diagnostic
  class Invoice extends BillingDocumentBase.extend("Invoice")(fields, {
    immutable: ["id", "kind"],
  }) {}
  ```

  Now the variant's effective list is all four, and re-stating inherited keys is
  unnecessary — delete them.

  `computed` merges per key rather than concatenating, because it is a map: a
  variant may add a derived field beside the root's, and may redefine one, but
  cannot drop it. A redefined key gives the variant's schema and derivation on
  `output.shape`, `toJSON()` and `Entity.Output`. One measured caveat: the
  **instance** property keeps the root's type intersected in, because a root's
  instance type is carried into every variant unmapped and subtracting from it is
  what `TS2425` forbids. Read a redefined key off `Entity.Output` where its exact
  type matters.

  **Breaking, in two ways.**

  Relaxing is no longer expressible: `immutable: []` in a variant does not widen
  `updateInput`. Code relying on it breaks loudly — `updateInput` shrinks, so the
  patch call stops typechecking rather than changing behaviour silently. To fix
  it, move the key the other way: a field only some variants need locked comes off
  the root's `immutable` and goes on each variant that wants it locked. The end
  state is the same, and it is the only direction still expressible — a variant
  can add to what the root declared, never subtract from it.

  `Entity.Static<…>`'s fourth and fifth arguments are now unions of keys rather
  than tuples, so the empty case is `never`:

  ```ts
  // before
  type Before = Entity.Static<
    "Organization",
    { slug: typeof Slug },
    Record<never, never>,
    [],
    []
  >;
  // after
  type After = Entity.Static<
    "Organization",
    { slug: typeof Slug },
    Record<never, never>,
    never,
    never
  >;
  ```

  The tuple form could not express the merge — `readonly [...I, ...I2]` is
  rejected with `TS2344`, because TypeScript will not prove the parent's key set is
  a subset of the child's through zod's inference chain.

  The same `TS2344` loosens the constraint on both. `Entity.Static` and
  `Entity.BaseInstance` now take any `PropertyKey` where they previously required a
  tuple constrained to `keyof`; tightening one back on its own reintroduces the
  error, so it is not fixable asymmetrically. Hand-written entity declarations are
  unaffected — the builders still constrain the real call sites — but both are
  named in consumers' emitted declarations, which is why it is listed here.

  For the same reason there is one new exported name, `MergedComputed` (and
  `Entity.MergedComputed`): it is what `extend` hands `Entity.Static` as its
  computed map, so it lands in the `.d.ts` of any library that declares a variant.
  Not something to write against — written inline, the merge emitted an
  unsubstituted type parameter and failed consumers on TypeScript 5.9.3 with
  `TS2304: Cannot find name 'A2'`.

## 0.3.0

### Minor Changes

- 5f1a395: Two correctness fixes, honest `toJSON` typing, and readable errors.

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

- ce69f0a: `update()` rejects a patch key it cannot apply, instead of dropping it silently.

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
