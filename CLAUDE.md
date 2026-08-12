# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`@btravstack/entity` — a domain-entity builder on zod v4. One declaration
(`class X extends Entity("X")(fields, options)`) yields a type, four plain
`ZodObject` validators, behaviour, and a class that is itself a zod schema. Every
fallible operation returns an `unthrown` `Result<T, InvalidEntity>` instead of
throwing.

pnpm + turbo monorepo with five workspaces: the package, `packages/entity`; the
documentation site, `docs`; and three example packages under `examples/`, which
document the library and double as its declaration-emit fixtures. Root scripts
delegate to turbo; workspace scripts are where the real commands live.

## Commands

Scripts are in `package.json`; the root ones delegate to turbo. Three things
that are not derivable from there:

- **The gate CI runs, in order**: `format --check`, `lint`, `typecheck`,
  `test`, `knip`, `build`. `typecheck` spans two workspaces:
  `packages/entity` runs the main `tsc` plus the `.test-d.ts` pass, and
  `examples/billing-domain` compiles **its own declarations twice** — once on
  the repo's TypeScript (7.0.2) and once on 5.9.3 through the
  `typescript-consumer` alias. That example is the fixture proving a downstream
  library can build against this package; it is not decoration.
  The second compiler is not redundant, though the reason is narrower than it
  looks. **Both versions enforce `TS7056`; 5.9.3's threshold is simply lower.**
  Measured on one entity carrying a 30-member enum, a branded timestamp and a
  six-member literal union: 5.9.3 reported `TS7056`, 7.0.2 accepted the same
  shape and reported only `TS4020`. Widen the entity and both report it. So a
  band of realistic domain widths fails for consumers and passes here —
  which is the band issues #31 and #32 shipped through.
  A fourth step then **type-checks the emitted `node_modules/.emit-check` with
  5.9.3**, because emitting cleanly is not the same as emitting something that
  compiles: a dangling type-parameter reference in the output is no emit-time
  diagnostic, and one shipped that way (`TS2304`, a bare `A2` from `extend`'s
  return type). Never give that step `--skipLibCheck` — it disables `.d.ts`
  checking outright and the run passes on broken output. Measured.
  That example keeps its abstract root in `src/root.ts`, exported, rather than
  beside its variants: a root reaches a variant's `.d.ts` as a synthesised local
  `declare abstract class` when the two share a module and as a **named import**
  when they do not, and only the first path was compiled while the root lived in
  `index.ts`.
- **A `paths` mapping is not how the emit fixture resolves the package.**
  `examples/billing-domain` depends on `@btravstack/entity` as `workspace:*`
  and reaches `dist/index.d.mts` through its real `exports`, the way an actual
  consumer does. The deleted `packages/entity/consumer/` faked that with
  `paths`.
- **A single test file runs from inside `packages/entity`**, not the root.
- **The docs site runs from inside `docs`**: `pnpm --filter ./docs dev`.
  `pnpm build` at the root builds it too, since it is a workspace.

## The documentation site

`docs/` is a VitePress site deployed to <https://btravstack.github.io/entity/>
by `.github/workflows/deploy-docs.yml` once CI is green on `main`. It is
organised by the four [Diátaxis](https://diataxis.fr/) modes — `tutorial/`,
`how-to/`, `reference/`, `explanation/` — with one shared sidebar across all
four so any page reaches any other. `docs/.vitepress/theme/custom.css` sets a
single `--accent` token; the shared `@btravstack/theme` derives every other
shade from it.

Its build is `typedoc && vitepress build`. TypeDoc reads
`packages/entity/src/index.ts` straight through and writes `docs/api/entity/`,
which is git-ignored and regenerated every build — `docs/api/index.md` is the
one hand-written page under `api/`.

**An em dash in a heading you link to ships a dead anchor, and the build stays
green.** VitePress's dead-link check does not validate anchors, and its
slugifier replaces ASCII punctuation but passes U+2014 through — measured:
`### Everywhere else, parse — through a mint helper` emitted
`id="everywhere-else-parse-—-through-a-mint-helper"`, which no natural link
spelling matches. Keep em dashes out of linked headings.

TypeDoc runs from **`docs/`** rather than from `packages/entity/` (where the
other btravstack repos put it), with its own TypeScript from the named
`typedoc` catalog. That is forced, not stylistic: the default catalog's
`typescript: 7.0.2` is the native port and ships no JS compiler API, so TypeDoc
cannot run against it. Measured — the reason is inline in
`pnpm-workspace.yaml`.

## Architecture

Twelve source modules under `packages/entity/src` besides `index.ts`, split by
what they own:

- **`entity.ts`** — the builder. `Entity(tag)(fields, options)` derives the
  four `ZodObject`s (`input`, `output`, `createInput`, `updateInput`) from
  one field map — the `generated` / `immutable` flags its entries carry —
  plus `computed`,
  then returns a `Base` class carrying them as statics. `create` delegates to
  `make`; `update` delegates to `make`; every path funnels through
  `construct`, which runs `invariants` and seals the constructor call. Data
  fields are installed with `Object.defineProperty(..., { writable: false })`
  and `_tag` non-enumerably, which is why `_tag` never reaches `toJSON()`,
  `JSON.stringify`, or spread. `toJSON()` is the **only** public projection —
  it, `equals` and `update` all route through a module-private `project`, so
  there is no second public spelling of the same data. It also carries the
  whole public surface: `Entity.field` / `Entity.computed` / `Entity.invariant` /
  `Entity.abstract` / `Entity.union` / `Entity.InvalidEntity` as expando
  properties, and every public type in a
  merged `declare namespace Entity`. Namespace members alias imported types
  through `*Src` names deliberately — see the comment there before renaming
  one.
- **`base.ts`** — `Entity.abstract(name)(fields, options?)` and the `extend`
  that lives on what it returns. A root is tagless, has no `make` and none of
  the four schema members; it exists to be extended and to hold the behaviour
  every variant shares. `extend` rebuilds a fresh entity from the declaration
  record (a `WeakMap` keyed by the class, walked up the _static_ chain so a
  user's own intermediate subclass still finds it), then rewires the new
  prototype onto the receiver's — which is what makes `variant instanceof Root`
  true, picks up a behaviour-only intermediate root, and leaves the entity's own
  `toJSON`/`equals`/`update` shadowing anything a root declares under those
  names. The rewiring is **instance-prototype only** — one `setPrototypeOf` on
  `child.prototype` — and that single fact explains the rest: a root's
  `static` members are not inherited (the static chain is untouched), a root's
  class-body **field** is typed but never initialised (the variant's generated
  base extends nothing, so a root's constructor never runs), and the
  construction seal is unaffected. `docs/reference/declaration.md` states all
  three; `base.spec.ts` pins them. A variant **accumulates** onto the root:
  `invariants` concatenate, `computed` merges **per key**, and the flags need no
  merging at all — they ride the field-map spread, wrapped, so a variant
  inherits them with the fields. Relaxing is not expressible. **Redeclaring an
  inherited field is forbidden**, flagged or not: a compile error naming
  `FieldAlreadyDeclaredByTheRoot`, plus a declaration-time defect naming the
  keys and the tag — a bare-schema redeclaration used to drop the root's flags
  silently. Built against a loosened `BuildEntity` passed in from `entity.ts`, so
  this module imports no builder and there is no cycle.
- **Equality** — `equals` is `node:util`'s **`isDeepStrictEqual`**, not `JSON.stringify` and
  not a hand-rolled walk: serialising **threw** on a `bigint` field, compared
  `Set`/`Map`/typed-array fields with different contents as **equal**, and
  reported a nested record as changed when only its key order differed. All
  three were measured, as was the cyclic-field stack overflow;
  `equal.spec.ts` pins every one against the stdlib function. This import is
  what makes the package **Node-only**.
- **`freeze.ts`** — `deepFreeze`, the runtime half of immutability. Freezes
  and recurses into arrays and plain objects, freezes `Date` as a leaf, and
  deliberately leaves `Map`/`Set`/class instances alone. Which _fields_ to skip
  entirely is decided in `entity.ts` from the **schema** (`z.custom` /
  `z.instanceof`), not here from the runtime shape — those hand back the
  caller's own reference, and freezing one in place broke the caller. The constructor
  passes one `WeakSet` across every field, so a subtree two fields share is
  walked once.
- **`types.ts`** — the whole type-level derivation (`OutputOf`,
  `CreateInputOf`, `PatchOf`, `UpdateInputShapeOf`, `EntityStatic`,
  `AbstractEntity`/`RootInstance`/`BehaviourOf`), plus
  `Sealed<D>`, the module-private `unique symbol` that makes `new X(...)` a
  compile error. Written independently of the builder's body-local values so
  `EntityStatic` can serve as the builder's explicit return annotation.
- **`schema.ts`** — `attachSchema` makes the entity class itself a zod
  schema by delegating `_zod` and `~standard` to a lazily built, per-receiver
  transform. Only those two slots, never the full `ZodType`: the methods would
  put a throwing `.parse()` beside `make`. Reading from the receiver is what
  makes a schema built from a subclass yield that subclass.
- **`union.ts`** — `Entity.union(discriminant, members)`. Dispatches on the
  declared discriminant rather than trying each branch, so a failing member
  reports its own issues. It returns a **value** with no construct signature, so
  the idiom is the pair —
  `export const Account = Entity.union("kind", [Personal, Business])` plus
  `export type Account = Entity.Instance<typeof Account>`, and an entry point is
  a plain function beside the const rather than a static. There is no class
  form: a class's instance type cannot be a union (**TS2509**), so the class
  form could only ever type as the members' shared root, which never narrowed
  and was redundant with the root the author had already named — and it failed
  late, at the first call site touching a member-only field. Reaching for it is
  now **TS2507** at the declaration, pinned by a used `@ts-expect-error` in
  `union.test-d.ts`.
- **`field.ts`** — `field(schema, flags)`, public as `Entity.field`, and the
  `FieldSpec` it returns: a plain `{ schema, flags }` record, never a proxy or a
  subclass, because anything standing in front of an entity-class field breaks
  `make`, which constructs through `this` (`TypeError: Ctor is not a constructor`
  — measured). Two spellings in the signature are load bearing and
  both are commented there: `flags` is intersected with a mapped rejection so a
  misspelled key is a compile error (a constraint is not an excess-property
  check — `{ generated: true, imutable: true }` compiled clean and left the
  field mutable), and `schema` is **bare `T`**, never intersected with
  `OnlyNominal`, because an intersection at an inference site broke zod's
  `$ZodBranded` alias preservation across every branded field (measured, −874 B
  over the billing fixture's emitted `.d.ts`). The nominal check lives at the
  field map, which already unwraps `FieldSpec` through `SchemaOf`.
- **`shape.ts`** — `OnlyNominal`, the type-level check rejecting unbranded
  fields, and `shape()`, which builds the validated field map. Both are
  internal; neither is exported from `index.ts`.
- **`issues.ts`** — `keysOf` and `renderIssue`. Standard Schema permits a path
  segment to be a bare `PropertyKey` or a `{ key }` wrapper; zod emits the
  bare form, and `keysOf` normalises it wherever a path meets an API wanting
  plain keys.
- **`computed.ts`** / **`errors.ts`** — the `computed(schema, from)` helper
  (public as `Entity.computed`) and the `InvalidEntity` tagged error. Computed
  fields are re-derived on every construction path, so they cannot drift from
  their sources.
- **`invariant.ts`** — `invariant(ensure, message)`, public as
  `Entity.invariant`. A rule's `d` is `InputOf<S>`, **not** `OutputOf<S, A>`,
  and that is not a simplification: `OutputOf` carries the deferred
  `ComputedOf<A>` conditional, `A` is unresolved while the invariants array is
  checked, and typing `d` as the output degrades it to a bag of `unknown`
  wherever an entity declares `computed` too. Measured — see the comment there.

The design rule the whole package turns on: **contracts compose the four plain
`ZodObject`s; domain code composes the class itself.** The class carries a
`.transform()`, so `z.toJSONSchema(SomeEntity, { io: "output" })` throws by
design — `contract.spec.ts` pins that both ways.

## Binding conventions

- **Errors are values.** The `unthrown/*` oxlint rules are enforced as errors.
  Do not add a `throw` outside a documented defect path. Genuine exceptions
  carry a targeted `oxlint-disable` with a reason — several already exist for
  `no-catch-all-pattern` where `SchemaIssues` is a single non-union type.
- **Comments recording measurements are regression guards.** Many comments
  cite a specific TS diagnostic code (TS2344, TS2411, TS2425, TS2507, TS2509,
  TS2515, TS2526, TS4020, TS4111) or a measured library behaviour. The four
  around roots and unions: a base constructor may not return a union or a
  `never`-collapsed intersection (**TS2509** — why a union has no class form,
  and `RootInstance` widening `_tag` to `string`; **TS2507** is what a reader
  now hits at the declaration instead), a mapped behaviour type turns a method
  into a property and breaks a variant's `override` (**TS2425** — `BehaviourOf`,
  which must stay unmapped), and abstractness **does** propagate through the
  intersection (**TS2515**), which is why a root's `abstract` member binds every
  variant. Verify before "simplifying" them away — the
  catalog in
  `pnpm-workspace.yaml` pins `typescript` and `@orpc/zod` to the exact versions
  those measurements were taken against, with the reason inline.
- **The dead-end ledger: a key union in type-argument position cannot be
  de-aliased.** `GeneratedKeys<S>` / `ImmutableKeys<S>` are computed **inside**
  `EntityStatic` / `AbstractEntity` / `BaseInstance`, never passed as type
  arguments, and the comment on `GeneratedKeys` in `types.ts` is the record.
  In argument position the printer re-carries the whole field map at every
  appearance — the spike measured **+57.8%** on the billing fixture's emitted
  declarations, +104% on `index.d.ts` alone — and three attempts to make the
  emitter write the alias instead all failed on **both** 7.0.2 and 5.9.3: an
  alias annotation, a defaulted parameter plus `infer`, and a
  mapped-object-plus-`keyof` indirection each reconstituted the alias through
  union-origin tracking. The fix is **arity reduction**, not a better spelling:
  `Entity.Static<Tag, S, A, B?>`, `Entity.Abstract<Name, S, A>`,
  `Entity.BaseInstance<S, A>`. Inside a body `S` prints by name and the map
  appears once — measured at **+8.0%** total, ~90 B per flagged-field
  appearance, with **zero** `GeneratedKeys<` / `ImmutableKeys<` in the emitted
  `.d.ts` set. That grep is the acceptance test; do not move these into a
  parameter list.
- **Type-level behaviour lives in `*.test-d.ts`**, checked by
  `tsc --noEmit -p tsconfig.test-d.json`. They are excluded from the main tsc
  pass, from oxlint, and from knip. Changing a compile-time guarantee (the
  seal, the `generated`/`immutable` flags, the redeclaration forbid,
  `computed`'s contextual typing) means
  updating the matching `@ts-expect-error` assertion.
- **One concept, one name.** The surface is meant to stay small enough that the
  library can be "done". Resist convenience aliases.
- **`index.ts` exports `Entity`, and nothing else you write against.** A bare
  `computed` or `union` is too generic to take from a consumer's import scope,
  so everything hangs off the builder. The sole exception is the ten
  declaration-emit names — `AbstractEntity`, `BaseInstance`, `ConstructionKey`,
  `EntityStatic`, `EntityUnion`, `FieldSpec`, `MergedComputed`, `MergedFields`,
  `Sealed`, `UnionMember` — exported at the top
  level as well: a downstream
  library compiling with `declaration: true` emits the _underlying_ name, not
  the namespace path aliasing it, so hiding them fails the consumer pass with
  `TS4020`. That is measured, not assumed — `examples/billing-domain/src/emit-guards.ts`
  names every namespace member for exactly this reason, and an **unused**
  `@ts-expect-error` there is a failure signal, not noise.
- **Entities are final.** One `extends` is the declaration form; `construct`
  defects on anything deeper, and `EntityStatic` carries no `extend`. Behaviour
  goes in the entity's own class body. Extension lives on `Entity.abstract`,
  which is tagless and can therefore carry a class body into every variant —
  `base.ts` above. The ban on a deeper `extends` is runtime-only: TypeScript has no `final`,
  and `private`/`protected` constructors were measured to break the declaration
  form (TS2675) and the statics (TS2684) respectively.
- **No I/O.** The package reads no clock and generates no id. `create` lives on
  a factory (`Entity.factory(generators)` / `factoryAsync`) — a function you
  call with the caller's fields — bound at the
  composition root; generators are functions, called once per `create`. A
  rejecting async generator is a Defect, not an `InvalidEntity`.
- `zod`, `unthrown` and `@unthrown/standard-schema` are peer dependencies to
  avoid duplicate copies breaking `instanceof` / schema-composition identity.
  Keep them that way.
- Dependencies go through the `catalog:` protocol in `pnpm-workspace.yaml`, not
  inline version ranges.

## Commits and releases

Conventional Commits, enforced by commitlint via a lefthook `commit-msg` hook.
Lefthook also runs format + lint pre-commit. User-facing changes need a
changeset (`pnpm changeset`); purely internal changes do not.
