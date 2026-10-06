# @btravstack/entity

## 0.9.0

### Minor Changes

- 1af25ee: **Breaking:** an aggregate's decision now carries everything a repository
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

- 2370c4d: **Breaking:** `Entity.aggregate` now requires at least one field flagged
  `identity: true`. An aggregate root is what other aggregates reference and what
  a repository loads, so a field map without one is a compile error, and a
  declaration that gets past the types throws while it runs. `sameIdentityAs` is
  therefore always available on an aggregate.

  To migrate, flag the aggregate's id: `id: Entity.field(SomeId, { identity: true })`.
  `Entity` is unchanged: identity stays optional there.

## 0.8.0

### Minor Changes

- 83af66b: `Entity.aggregate(tag)(fields)(options)` declares an aggregate root whose state
  changes only through events. The options declare the `events` (a zod
  discriminated union on `type`), an `opens` handler per creation event and an
  `evolve` handler per other event; omitting one is a compile error.

  - An aggregate has no `update()` and no factories. A command checks its
    business rules and calls `this.emit(...events)`, which parses the events,
    folds them, verifies the result with one `make`, and returns a sealed
    `Entity.Decision`: the events and the verified state. Only `emit` and
    `start` can build one, and events that break an invariant are a defect.
  - `SomeAggregate.start(event)` creates from a creation event.
    `SomeAggregate.replay(events)` parses and folds a stored stream; `make`
    still rehydrates a snapshot or a state row. Neither emits events.
  - The same aggregate persists as state plus an outbox or as an event stream
    without changing its declaration.

  `Entity` keeps its API. Four new top-level declaration-emit names:
  `AggregateStatic`, `AggregateInstance`, `Decision`, `DecisionKey`, plus
  `Entity.Decision`, `Entity.Event` and `Entity.Aggregate` in the namespace.

- 1729958: **Breaking:** structural `equals` is removed, and entities compare by declared
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

- aab342b: Add `SomeEntity.inspect(state)`, a read-side door for stored rows written before a rule existed. It validates the field schemas strictly and re-derives `computed` like `make`, then reports every broken invariant instead of refusing the row: `Result<Inspection<Output>, InvalidEntity>`, where `Inspection` is `{ data, violations }`.

  `data` is plain frozen data, never an entity instance, so a row that breaks today's rules cannot reach a command by accident. The way back is a migration, then `make`, which stays strict. `violations` are the issues `make` would have failed with, so `Entity.codeOf` reads them. A field failure is still `InvalidEntity`, a throwing predicate is still a defect, and a nested entity field is inspected strictly.

  `Entity.union` gains `inspect` too, dispatching on the discriminant. `Inspection` joins the top-level declaration-emit names, with `Entity.Inspection` for annotations. The new how-to, "Add a stricter rule without an outage", covers the rollout.

- 20dcfc2: **Breaking:** `Entity.invariant` now takes one object with a required stable
  `code`:

  ```ts
  Entity.invariant({
    code: "NAME_TOO_LONG",
    ensure: (d) => d.name.length <= 80,
    message: "name must be at most 80 characters",
  });
  ```

  The code is the rule's identity, which a caller keys behaviour off (an error
  code in a response, a field to highlight, a localised string), while the
  message may vary with the data. A failing rule's issue is now
  `{ message, params: { code } }`; the code survives nested entities, arrays and
  unions with the path prefixed, and the new `Entity.codeOf(issue)` reads it back.

  To migrate, wrap each `Entity.invariant(ensure, message)` as
  `Entity.invariant({ code, ensure, message })`. A missing code is a compile
  error.

- 4d79b0e: **Breaking:** `input`, `output`, `createInput` and `updateInput` are plain all
  the way down, so an entity with a nested-entity field converts to JSON Schema
  (#72).

  - A field holding another entity, an array of entities, an optional or
    nullable one, or an `Entity.union(...)` now embeds the nested entity's own
    plain schema in each member: its `input` in `input`, `createInput` and
    `updateInput`, its `output` (computed fields included) in `output`. A union
    becomes a discriminated union of its members' plain schemas. Every member
    converts with `z.toJSONSchema` in both directions, at any depth; before, all
    of them threw.
  - `make`, `update` and the factories are unchanged: they parse through an
    internal schema that keeps the classes, so a nested field still holds a real
    instance.
  - `updateInput` is now derived from `input` rather than `output`. Its keys are
    the same; only a nested entity's schema differs.
  - An `Entity.union(...)` value's `input` and `output` are typed from its
    members' schemas instead of `z.ZodType<unknown>`.

  To migrate: parsing with a member now yields plain data at every depth, so
  `Order.output.parse(x).lines[0]` is an object, not an `OrderLine`. Code that
  relied on a member to construct nested instances should call `make` instead,
  which is the entry point for building entities. Types follow suit:
  `z.output<typeof Order.output>` describes plain nested data, while
  `Entity.Output<typeof Order>` and the instance types still carry the nested
  entities.

- f3b42e3: `Entity.field(schema, { unbranded: true })` exempts one field from the rule
  that every field be branded, an entity or a narrow literal. It is meant for a
  descriptive leaf (a label, a display name) with no second value it could be
  confused with, whose brand would otherwise leak into every consumer of the
  derived schemas. The field is still validated and still honours `immutable`;
  only the branding rule is relaxed, and only for that field. Existing
  declarations are unchanged, and their emitted declarations do not grow.

### Patch Changes

- 8d928cd: A downstream library compiling with `declaration: true` can now export a value
  whose inferred type runs a branded object through the package's deep-readonly
  data type. That includes `SomeEntity.factory(...)` for an entity with a
  nested-entity field. Declaration emit used to fail with `TS4023` (`$brand`
  cannot be named); the brand now prints as `z.$brand<…>`.
- 02c29e3: Document the self-referencing deriver idiom (#60): a `computed` deriver or an
  `Entity.invariant` predicate may call the entity's own statics, given an
  explicit return annotation — `(d): boolean => Doc.isActive(d.tags)`. The
  unannotated form is `TS2506`, which is TypeScript resolving the deriver's
  inferred return type inside the class's own base expression, not a rule of
  the library. The annotation is still checked against both the body and the
  schema. `computed.test-d.ts` pins the idiom, the wrong-annotation errors, and
  the `this`-parameter dead end (`TS2502`).

  Documentation only; no runtime or API change.

- 08aca24: A synchronous generator that throws no longer escapes `factory(...)`'s returned
  function: the factory now returns a `Defect` carrying the original cause, the
  same channel a rejecting generator already takes under `factoryAsync`.

## 0.7.0

### Minor Changes

- 5844dd4: `Entity.union(...)` returns a value, not a class.

  ## Breaking: the class form is gone

  ```ts
  // before
  class Payment extends Entity.union("method", [Card, BankTransfer]) {}

  // after
  export const Payment = Entity.union("method", [Card, BankTransfer]);
  export type Payment = Entity.Instance<typeof Payment>;
  ```

  The class form typed as the members' shared _root_, not as the member union, so
  it could not narrow — and it failed late, at the first call site that touched a
  member-only field. A class's instance type cannot be a union (`TS2509`), so no
  version of it could have narrowed; and its type was always redundant with the
  root the author had already named. `class X extends Entity.union(...) {}` is now
  `TS2507` at the declaration.

  Statics that lived in the class body become plain functions:

  ```ts
  export const parsePayment = (row: unknown) => Payment.make(row);
  ```

  ## Breaking: `__base` is removed

  The phantom `__base` carrier is gone from `EntityStatic` and `UnionMember`. It
  existed only to compute the class form's root type. Nothing writes it by hand;
  it is listed because it is part of the emitted public surface.

## 0.6.0

### Minor Changes

- 88c127d: Add `Entity.field(schema, flags)` and move `generated` / `immutable` off the
  options object onto the fields themselves.

  ```ts
  // before
  class Organization extends Entity("Organization")(
    { id: OrgId, slug: Slug, name: DisplayName, createdAt: Instant },
    {
      generated: ["id", "createdAt"],
      immutable: ["id", "createdAt", "slug"],
    },
  ) {}

  // after
  class Organization extends Entity("Organization")({
    id: Entity.field(OrgId, { generated: true, immutable: true }),
    slug: Entity.field(Slug, { immutable: true }),
    name: DisplayName,
    createdAt: Entity.field(Instant, { generated: true, immutable: true }),
  }) {}
  ```

  A field that carries no flag stays a bare schema. The flags argument is
  required — the function exists to flag — and a misspelled flag name is now a
  compile error: a constraint is not an excess-property check, so
  `{ generated: true, imutable: true }` used to compile clean and leave the field
  silently mutable.

  Nothing changes at runtime for a declaration that migrates one-for-one:
  `createInput`, `updateInput`, the factory's generator map and `update`'s
  rejection all derive from the same key sets, now read off the field map instead
  of two lists beside it.

  **Cost, measured.** A consumer's emitted declarations grow ~90 bytes per
  _appearance_ of a flagged field — the billing-domain fixture's 10 flagged
  fields appear 21 times across its `.d.ts` set, for +1,894 B / +8.0% in total.
  The appearance count is a property of a domain's shape (a root shared by two
  variants, an entity held as another entity's field), not a constant. The naive
  design measured +57.8%; see the third item below for why this one does not.

  ## Breaking: the `generated` and `immutable` options are gone

  Both keys are rejected on the options object of `Entity(tag)(…)`,
  `Entity.abstract(name)(…)` and `Root.extend(tag)(…)`. `computed` and
  `invariants` are what remains, and an entity declaring neither passes no options
  object at all. The migration is mechanical:

  | Before                                     | After                                                        |
  | ------------------------------------------ | ------------------------------------------------------------ |
  | `{ generated: ["id"] }`                    | `id: Entity.field(Id, { generated: true })`                  |
  | `{ immutable: ["id"] }`                    | `id: Entity.field(Id, { immutable: true })`                  |
  | `{ generated: ["id"], immutable: ["id"] }` | `id: Entity.field(Id, { generated: true, immutable: true })` |
  | a key in neither list                      | the bare schema, unchanged                                   |

  A key that appeared in a list but not in the field map was already a compile
  error and has no migration.

  ## Breaking: `Entity.Static`, `Entity.Abstract` and `Entity.BaseInstance` lost type parameters

  | Type                  | Now               | Was                  |
  | --------------------- | ----------------- | -------------------- |
  | `Entity.Static`       | `<Tag, S, A, B?>` | `<Tag, S, A, G, I>`  |
  | `Entity.Abstract`     | `<Name, S, A>`    | `<Name, S, A, G, I>` |
  | `Entity.BaseInstance` | `<S, A>`          | `<S, A, I>`          |

  Their top-level spellings moved with them: `EntityStatic<Tag, S, A, B?>` (six
  parameters to four — it was the one place `B` was already exposed),
  `AbstractEntity<Name, S, A>` and `BaseInstance<S, A>`. The dropped parameters were the generated-
  and immutable-key unions; they are computed inside each body from the flags `S`
  carries. Hand-written annotations drop the extra arguments —
  `Entity.Static<"Org", S, A, never, never>` becomes
  `Entity.Static<"Org", S, A>`. Declarations infer them and need no change.

  This is the reason the size cost above is +8.0% rather than +57.8%. A key union
  in **type-argument** position cannot be de-aliased: the printer re-carries the
  whole field map at every appearance, and an alias annotation, a defaulted
  parameter plus `infer`, and a mapped-object indirection were each measured to
  reconstitute the alias on both TypeScript 7.0.2 and 5.9.3. Computed inside a
  body, `S` prints by name and the map appears once — with zero `GeneratedKeys<`
  or `ImmutableKeys<` anywhere in the emitted output.

  ## Breaking: a variant may not redeclare a field its root declares

  ```ts
  abstract class AccountBase extends Entity.abstract("Account")({
    id: AccountId,
    label: Label,
  }) {}

  AccountBase.extend("Clash")({ label: Label }); // ✗ FieldAlreadyDeclaredByTheRoot
  ```

  This breaks a variant that restates an inherited field **even with no flags on
  either side**, which previously compiled and simply re-declared the same schema.
  The migration is to declare the field once, on the root, and delete it from the
  variant. A variant that redeclared a key with a _different_ schema was already
  reporting that key inconsistently (the instance property kept both brands
  intersected, `TS2425`); it now has to pick one and put it on the root.

  The compile error is backed by a **declaration-time defect**, thrown while the
  declaration is on the stack, so a declaration reaching `extend` from JavaScript
  or through a cast fails the same way:

  ```
  Clash: field(s) "label" already declared by the root — a variant adds fields,
  it does not redeclare them.
  ```

  `computed` is unaffected: it still merges per key, and a variant may still
  replace one of the root's derivations.

  ## Breaking: a variant can no longer flag a root-declared field

  Under the old options accumulation, a variant could add `immutable: ["rootKey"]`
  and tighten a field the root declared. There is no spelling for that now, and
  the previous item is why: the only place a flag can be written is a field's
  declaration, and the field is declared on the root.

  Move the flag to the root, where every variant inherits it — flags ride the
  field-map spread, so a variant gets them with the fields. If two variants
  genuinely need different flags on the same key, they are not sharing that field:
  declare it separately on each variant and leave it off the root.

  Relaxing was never expressible and still is not: `immutable: []` did not widen
  `updateInput` before, and there is no flag that reopens an inherited field now.

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
