---
title: Examples
description: Three small packages modelling one billing domain — code that compiles and is covered by tests, unlike the snippets in the guide.
---

# Examples

Annotated tours of the runnable packages under
[`examples/`](https://github.com/btravstack/entity/tree/main/examples). They
model one small billing domain between them, each showing a different job.

**Unlike the snippets elsewhere in this guide, this code compiles and is covered
by tests.** One of the three goes further: `billing-domain` is the fixture
proving a downstream library can emit its own declarations against this package.

Nothing needs installing and nothing needs to be listening:

```sh
pnpm install
pnpm test
```

## [Billing domain](/examples/billing-domain)

Declaring the entities: branded fields, `generated` / `immutable` / `computed`,
invariants as values, one entity nested inside another, an abstract root with
two variants gathered under a discriminated union, and factories binding the id
and clock the package refuses to read for itself.

## [HTTP contract](/examples/billing-api)

The four plain `ZodObject`s composed into an oRPC contract and converted to JSON
Schema in both directions — and the class deliberately refusing to convert,
because it parses to an instance rather than to data.

## [Persistence](/examples/billing-persistence)

`toJSON()` out, `make()` back, over an in-memory store: the round trip, the
absent `_tag`, and a corrupt row arriving as a `Result` rather than a throw.

## Why these exist as packages rather than snippets

Every fenced block in the rest of this guide is written by hand. It is checked
by review and nothing else, so it can drift from the library without any build
noticing.

These three cannot. They are workspace packages: they typecheck, their specs
run in CI, and they consume `@btravstack/entity` through its real published
entry point rather than a path alias. If the library changes underneath them,
something goes red.

That property is not theoretical. Writing `billing-domain` immediately surfaced
a declaration-emit bug — an exported `const` holding `Entity.union(...)` failed
with `TS4023` — that the package's own test suite could not see, because
`vitest` never typechecks and the bug lived only in emitted declarations.
