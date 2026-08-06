# Contributing to @btravstack/entity

Thanks for your interest in improving `@btravstack/entity`. This is a small,
focused library — the guiding principle is **one concept = one name**, and the
surface is meant to stay small enough that the library can be "done".
Contributions that sharpen the existing design are more welcome than ones that
grow it.

## Prerequisites

- **Node** `>=22.19`
- **pnpm** `11.7.0` (pinned via `packageManager`; run `corepack enable` to get it)

## Getting started

```sh
git clone https://github.com/btravstack/entity.git
cd entity
pnpm install
```

## The gate

Every change must keep all of these green (CI runs the same set):

```sh
pnpm format --check   # oxfmt
pnpm lint              # oxlint
pnpm typecheck         # tsc (incl. type-level tests)
pnpm test              # vitest
pnpm knip               # dead code / unused deps
pnpm build              # tsdown dual CJS/ESM + d.ts
```

Run `pnpm format` (no `--check`) to auto-fix formatting.

### Type-level tests

Behaviour that only shows up at the type level — the construction seal, the
generated/immutable compile-time rules, `add`'s contextual typing — is pinned
in `packages/entity/src/*.test-d.ts` and checked by
`tsc --noEmit -p tsconfig.test-d.json` (run as part of `pnpm typecheck`). If
you change a type-level guarantee, update or add the matching `@ts-expect-error`
assertion.

## Design rules (binding)

`packages/entity/README.md` documents the public behaviour; many of its rules
were measured against a specific compiler/library version, not assumed. Where a
source comment records a measurement (a TS diagnostic code, a specific
library's output), treat it as a regression guard, not decoration — verify
before "simplifying" it away.

- **oxlint rules are binding**, including the `unthrown/*` rules enforcing this
  repo's errors-as-values convention (no throwing outside a documented defect
  path). Genuine exceptions carry a targeted `oxlint-disable` with a reason.
- **One name per concept.** Resist convenience aliases.

## Node versions

Three numbers, and they mean different things:

| Where                         | Value                  | Meaning                                                   |
| ----------------------------- | ---------------------- | --------------------------------------------------------- |
| `.node-version`               | the pinned dev version | what contributors and the primary CI job run              |
| root `package.json` `engines` | `>=22.19`              | the oldest Node this repo is _developed_ on               |
| `packages/entity` `engines`   | `>=20`                 | the oldest Node the _published package_ claims to support |

CI runs the test job on all three, plus the two current release lines:
`["", "20", "22.19", "24", "26"]`. Both declared floors are therefore checked
rather than merely claimed, and a consumer on current LTS or the live release
line is exercised rather than assumed. If you raise `packages/entity`'s
`engines`, raise the matching entry in `node-versions` in
`.github/workflows/ci.yml` too — the matrix is what proves the claim.

`24` overlaps `""` for as long as `.node-version` stays on 24.x. It is listed
explicitly anyway, so that bumping `.node-version` to 26 does not silently
drop 24 from the matrix.

## Commit convention

Commits follow [Conventional Commits](https://www.conventionalcommits.org/) and
are checked by **commitlint** via a **lefthook** `commit-msg` hook. Examples:

```
feat: add a `readonly` helper for computed fields
fix: re-run invariants on every entry point, not just decode
docs: clarify the decoded omit/add split
chore(deps): bump zod
```

## Changesets

User-facing changes need a changeset so the release notes and version bumps are
generated correctly:

```sh
pnpm changeset
```

Describe the change in one line and pick a semver bump. Purely internal changes
(tests, CI, refactors with no API/behaviour impact) don't need one.

## Pull requests

- Keep PRs focused — one concern each.
- Make sure the full gate passes locally before pushing.
- Reference the issue you're addressing, if any.

By contributing, you agree that your contributions are licensed under the
project's [MIT License](./LICENSE).
