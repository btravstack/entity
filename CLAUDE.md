# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`@btravstack/entity` — a domain-entity builder on zod v4. One declaration
(`class X extends Entity("X")(fields, options)`) yields a type, four plain
`ZodObject` validators, behaviour, and a class that is itself a zod schema. Every
fallible operation returns an `unthrown` `Result<T, InvalidEntity>` instead of
throwing.

pnpm + turbo monorepo with a single package, `packages/entity`. Root scripts
delegate to turbo; package scripts are where the real commands live.

## Commands

Scripts are in `package.json`; the root ones delegate to turbo. Two things
that are not derivable from there:

- **The gate CI runs, in order**: `format --check`, `lint`, `typecheck`,
  `test`, `knip`, `build`. `typecheck` is three passes — the main `tsc`, the
  `.test-d.ts` pass, and the consumer declaration-emit pass.
- **A single test file runs from inside `packages/entity`**, not the root.

## Architecture

Eight source modules under `packages/entity/src`, split by what they own:

- **`entity.ts`** — the builder. `Entity(tag)(fields, options)` derives the
  four `ZodObject`s (`input`, `output`, `createInput`, `updateInput`) from
  one field map plus `generated` / `immutable` / `computed`,
  then returns a `Base` class carrying them as statics. `create` delegates to
  `make`; `update` delegates to `make`; every path funnels through
  `construct`, which runs `invariants` and seals the constructor call. Data
  fields are installed with `Object.defineProperty(..., { writable: false })`
  and `_tag` non-enumerably, which is why `_tag` never reaches `toJSON()`,
  `JSON.stringify`, or spread. `toJSON()` is the **only** public projection —
  it, `equals` and `update` all route through a module-private `project`, so
  there is no second public spelling of the same data.
- **`freeze.ts`** — `deepFreeze`, the runtime half of immutability. Freezes
  and recurses into arrays and plain objects, freezes `Date` as a leaf, and
  deliberately leaves `Map`/`Set`/class instances alone. The constructor
  passes one `WeakSet` across every field, so a subtree two fields share is
  walked once.
- **`types.ts`** — the whole type-level derivation (`OutputOf`,
  `CreateInputOf`, `PatchOf`, `UpdateInputShapeOf`, `EntityStatic`), plus
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
  reports its own issues.
- **`shape.ts`** — `OnlyNominal`, the type-level check rejecting unbranded
  fields, and `shape()`, the only sanctioned way to build a domain object.
- **`issues.ts`** — `keysOf` and `renderIssue`. Standard Schema permits a path
  segment to be a bare `PropertyKey` or a `{ key }` wrapper; zod emits the
  bare form, and `keysOf` normalises it wherever a path meets an API wanting
  plain keys.
- **`computed.ts`** / **`errors.ts`** — the `computed(schema, from)` helper and
  the `InvalidEntity` tagged error. Computed fields are re-derived on every
  construction path, so they cannot drift from their sources.

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
  cite a specific TS diagnostic code (TS2411, TS2526, TS4020, TS4111) or a
  measured library behaviour. Verify before "simplifying" them away — the
  catalog in `pnpm-workspace.yaml` pins `typescript` and `@orpc/zod` to the
  exact versions those measurements were taken against, with the reason inline.
- **Type-level behaviour lives in `*.test-d.ts`**, checked by
  `tsc --noEmit -p tsconfig.test-d.json`. They are excluded from the main tsc
  pass, from oxlint, and from knip. Changing a compile-time guarantee (the
  seal, `generated`/`immutable` rules, `computed`'s contextual typing) means
  updating the matching `@ts-expect-error` assertion.
- **One concept, one name.** The surface is meant to stay small enough that the
  library can be "done". Resist convenience aliases.
- **Entities are not subclassable.** One `extends` is the declaration form;
  `construct` defects on anything deeper. Behaviour goes in the entity's own
  class body. This is runtime-only — TypeScript has no `final`, and
  `private`/`protected` constructors were measured to break the declaration
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
