# Collapse the public surface onto `Entity`

**Status:** approved design, not yet implemented
**Date:** 2026-08-07

## Problem

`@btravstack/entity` exports three values (`Entity`, `computed`, `InvalidEntity`)
and nine types at the top level. Two of those names are generic enough to be
hostile in a consumer's import scope — `computed` above all, which collides
directly with Vue, MobX, Angular signals and Solid.

The repository already made this call once and wrote down the reasoning, at
`packages/entity/src/entity.ts:387-393`:

> Grouped under `Entity` rather than exported loose: `union` alone is too
> generic a name to take from a consumer's import scope, and it reads as
> `z.union`'s sibling when it is nothing of the sort.

So the convention is not "standalone by default". It is a name-pollution test
that `union` failed and `computed` fails harder. Applying the test consistently
collapses the surface to a single exported name.

## Decision

`index.ts` exports exactly one name: `Entity`.

| today                                     | after                   |
| ----------------------------------------- | ----------------------- |
| `computed`                                | `Entity.computed`       |
| `InvalidEntity`                           | `Entity.InvalidEntity`  |
| `Input` `Output` `CreateInput` `Patch`    | `Entity.Input` …        |
| `ComputedField`                           | `Entity.ComputedField`  |
| `EntityUnion`                             | `Entity.Union`          |
| `BaseInstance` `ConstructionKey` `Sealed` | `Entity.BaseInstance` … |
| `Entity.union` (already grouped)          | unchanged               |

Resulting usage:

```ts
import { Entity } from "@btravstack/entity";

class Person extends Entity("Person")(
  { first: First, last: Last },
  {
    computed: {
      fullName: Entity.computed(
        FullName,
        (d) => `${d.first} ${d.last}` as FullName,
      ),
    },
  },
) {}

type Row = Entity.Output<typeof Person>;
const isInvalid = (e: unknown) => e instanceof Entity.InvalidEntity;
```

### Decisions taken explicitly

- **`InvalidEntity` moves.** Its name is specific rather than generic, so it
  passes the name-pollution test on its own merits and could have stayed. It
  moves anyway: one exported name with no exceptions is worth more than the
  characters saved at each `instanceof`.
- **`EntityUnion` becomes `Entity.Union`.** The stutter only existed to
  disambiguate a top-level name. `Entity.Union` (type) sits beside
  `Entity.union` (value), differing only in case — legal, since types and
  values occupy separate declaration spaces, and the same shape as zod's
  `z.union` / `z.ZodUnion`.
- **`shape()` is out of scope.** `CLAUDE.md` calls it "the only sanctioned way
  to build a domain object", but it is not exported from `index.ts`. Treated as
  internal; the stale `CLAUDE.md` claim is corrected as part of this change, not
  by making `shape` public. Growing the surface cuts against the repo's
  "small enough to be done" rule.

## Mechanism

`Entity` stays a `function` **declaration** in `entity.ts`, merged with a
type-only `export declare namespace Entity` in the same file. Values attach as
expando properties, exactly as `Entity.union` already does:

```ts
Entity.computed = computed;
Entity.InvalidEntity = InvalidEntity;

export declare namespace Entity {
  export type Output<E extends { readonly __output: unknown }> = E["__output"];
  export type ComputedField<T extends z.core.$ZodType, D> = ComputedFieldSrc<
    T,
    D
  >;
  export type ConstructionKey = ConstructionKeySrc;
  // …
}
```

This is the only viable mechanism, not one of several. `export const Entity =
Object.assign(fn, { … })` cannot merge with a namespace — TypeScript requires a
function _declaration_ for the merge.

### Binding constraint: a namespace member must not share its name with the type it aliases

Verified by spike against the real pipeline (tsdown + TypeScript 7.0.2 + the
consumer declaration-emit fixture).

Writing the obvious thing:

```ts
export declare namespace Entity {
  export type ConstructionKey = import("./types.js").ConstructionKey;
}
```

emits this into `dist/index.d.mts`:

```ts
declare namespace Entity {
  type ConstructionKey = ConstructionKey; // circular self-alias
}
```

tsdown's dts bundler collapses the dynamic import to a bare local name, which
inside the namespace resolves to the member itself. **This compiles.** Nothing
fails loudly. What happens instead is that the type degenerates, and in the
spike that silently voided the construction seal: the consumer fixture's
`@ts-expect-error` on a forged `ConstructionKey` became _unused_, which was the
only signal that a compile-time guarantee had been destroyed.

The fix is to import each source type under a distinct internal alias
(`ConstructionKeySrc`, `ComputedFieldSrc`, …) and have the namespace member
reference that. Confirmed to emit and consume cleanly.

Two consequences for implementation:

1. Every namespace member that aliases an imported type needs a differently
   named internal alias. This must be recorded as a comment in `entity.ts`,
   in the style of the repo's other measured-behaviour guards.
2. `tsconfig.consumer.json` is the only thing standing between this failure mode
   and a shipped release. Its `@ts-expect-error` assertions are load-bearing;
   an _unused_ one is a failure signal here, not noise.

This is the same class of defect as the `TS4020` history recorded on
`ConstructionKey` in `types.ts`.

## Files affected

- `packages/entity/src/entity.ts` — namespace declaration, expando assignments,
  internal source aliases, the constraint comment.
- `packages/entity/src/index.ts` — reduced to a single export.
- `packages/entity/consumer/index.ts` — exercise `Entity.computed`,
  `Entity.ConstructionKey`, `Entity.Output`, `Entity.InvalidEntity` through the
  built `d.mts`.
- Specs and type-level tests — 12 `computed(` call sites: `computed.spec.ts`
  (6), `entity.test-d.ts` (3), and one each in `contract.spec.ts`,
  `extend.spec.ts`, `nesting.spec.ts`. Plus their `import { computed }` lines.
- Docs — `README.md`, `packages/entity/README.md`, `docs/reference.md`,
  `docs/explanation.md`, all four `docs/how-to/*.md` (including the shared
  imports preamble in each).
- `CLAUDE.md` — the entry-point list, and the stale `shape()` claim.

## Versioning

Breaking change to the public API. Package is at `0.1.0`, so a **minor** bump
under changesets' 0.x semantics. No deprecated top-level aliases are kept: the
repo's "one concept, one name / resist convenience aliases" rule forbids
carrying both spellings, and at 0.1.0 the installed base does not justify an
exception.

## Verification

The existing gate, in order: `format --check`, `lint`, `typecheck` (all three
passes), `test`, `knip`, `build`.

Two checks specific to this change:

- The **consumer pass must report zero diagnostics**, including no
  `TS2578: Unused '@ts-expect-error'`. An unused directive there means a type
  degenerated — see the constraint above.
- Inspect the emitted `dist/index.d.mts` by eye for self-referential aliases
  inside `declare namespace Entity`. The spike showed the compiler will not
  catch these for you.

## Sequencing

PR #23 (`docs/fix-restructure-fallout`) edits `docs/reference.md`,
`docs/explanation.md` and three of the four how-to guides — the same files this
change rewrites. **Merge #23 first, then rebase this work onto `main`.** This
branch is currently cut from `main` and does not contain those fixes; doing the
docs pass here before #23 lands would duplicate or revert them.

## Out of scope

- Making `shape()` public.
- Any change to entity runtime behaviour. This is a relocation of names.
