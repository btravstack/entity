# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

`@btravstack/entity` — a domain-entity builder on zod v4. One declaration
(`class X extends Entity("X")(fields, options)`) yields a type, four plain
`ZodObject` validators, behaviour, and a composable `instance` schema. Every
fallible operation returns an `unthrown` `Result<T, InvalidEntity>` instead of
throwing.

pnpm + turbo monorepo with a single package, `packages/entity`. Root scripts
delegate to turbo; package scripts are where the real commands live.

## Commands

Run from the repo root:

```sh
pnpm build            # tsdown → dist, dual CJS/ESM + .d.ts
pnpm test             # vitest run (src/**/*.spec.ts)
pnpm typecheck        # tsc --noEmit, both the main pass and the .test-d.ts pass
pnpm test:types       # the .test-d.ts pass alone
pnpm lint             # oxlint
pnpm format           # oxfmt (add --check for CI-style verification)
pnpm knip             # dead code / unused deps
```

The full gate CI runs is: `format --check`, `lint`, `typecheck`, `test`,
`knip`, `build`.

Single test / single file — run inside `packages/entity`:

```sh
pnpm vitest run src/crud.spec.ts
pnpm vitest run -t "update returns a new entity"
pnpm vitest              # watch mode
```

Node is pinned in `.node-version` (24.16.0); pnpm 11.7.0 via `packageManager`
(`corepack enable`).

## Architecture

Six source modules under `packages/entity/src`, split by what they own:

- **`entity.ts`** — the builder. `Entity(tag)(fields, options)` derives the
  four `ZodObject`s (`encoded`, `decoded`, `createInput`, `updateInput`) from
  one field map plus `generated` / `immutable` / `decoded.omit` / `decoded.add`,
  then returns a `Base` class carrying them as statics. `create` delegates to
  `decode`; `update` delegates to `make`; every path funnels through
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
- **`types.ts`** — the whole type-level derivation (`DecodedOf`,
  `CreateInputOf`, `PatchOf`, `UpdateInputShapeOf`, `EntityStatic`), plus
  `Sealed<D>`, the module-private `unique symbol` that makes `new X(...)` a
  compile error. Written independently of the builder's body-local values so
  `EntityStatic` can serve as the builder's explicit return annotation.
- **`instance.ts`** — `attachInstance` installs `instance` and `~standard` as
  lazy, self-overwriting accessor getters. The getter (not a plain value) is
  what makes `X.instance.parse(...)` build an `X` rather than the base class,
  since the subclass does not exist when the builder runs.
- **`shape.ts`** — `OnlyNominal`, the type-level check rejecting unbranded
  fields, and `shape()`, the only sanctioned way to build a domain object.
- **`add.ts`** / **`errors.ts`** — the curried `add(fields)(from)` helper and
  the `InvalidEntity` tagged error.

The design rule the whole package turns on: **contracts compose the four plain
`ZodObject`s; domain code composes `instance`.** `instance` carries a
`.transform()`, so `z.toJSONSchema(instance, { io: "output" })` throws by
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
  seal, `generated`/`immutable` rules, `add`'s contextual typing) means
  updating the matching `@ts-expect-error` assertion.
- **One concept, one name.** The surface is meant to stay small enough that the
  library can be "done". Resist convenience aliases.
- **No I/O.** The package reads no clock and generates no id — `create` takes
  domain-generated values as its second argument, by design.
- `zod`, `unthrown` and `@unthrown/standard-schema` are peer dependencies to
  avoid duplicate copies breaking `instanceof` / schema-composition identity.
  Keep them that way.
- Dependencies go through the `catalog:` protocol in `pnpm-workspace.yaml`, not
  inline version ranges.

## Commits and releases

Conventional Commits, enforced by commitlint via a lefthook `commit-msg` hook.
Lefthook also runs format + lint pre-commit. User-facing changes need a
changeset (`pnpm changeset`); purely internal changes do not.
