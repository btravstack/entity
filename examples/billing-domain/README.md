# billing-domain

The modelling half of the example: two entities and the vocabulary they are
built from.

```sh
pnpm --filter @btravstack/entity-example-billing-domain test
pnpm --filter @btravstack/entity-example-billing-domain typecheck
```

## What it shows

`src/index.ts`, top to bottom:

- **Branded fields.** Every data field is branded, so an `OrganizationId` and a
  `Slug` stop being interchangeable strings. A bare `z.string()` is a compile
  error — that is the guard, not an inconvenience.
- **`Money` as a branded object.** A value object with no identity: branded
  rather than made an entity. Amounts are integer minor units, because binary
  floats are the wrong tool for money.
- **`generated` / `immutable` / `computed`.** `generated` drops fields out of
  `createInput`; `immutable` is what `update` refuses; `computed` is re-derived
  on every construction path, so it cannot drift from its sources.
- **Invariants as values.** A broken rule comes back as an `InvalidEntity`
  `Result`, never an exception.
- **Nesting.** `Invoice.issuedTo` is an `Organization` — the class is itself a
  zod schema, so it parses back to a real instance with its behaviour intact.
- **A union** over `Invoice` and `CreditNote`, dispatching on `kind` — a
  _declared_ field, never `_tag`. `_tag` is non-enumerable and absent from
  `toJSON()`, so a union built on it matches nothing and says so with an empty
  `expected one of` set. This package shipped that bug for exactly one commit;
  the specs now call `make()` through the union, which is what would have caught
  it.
- **Factories.** The package reads no clock and generates no id; a factory is
  where those come in, bound once. That is what leaves the entities trivially
  testable.

## Two things that look odd on purpose

**`DunningReason` has thirty members.** Vocabularies that wide are ordinary in
billing, and this one is held at full width because it pins [#31]: `TS7056` is a
threshold on serialised _characters_, so trimming it puts the example back under
the ceiling where it compiles and guards nothing.

**`src/emit-guards.ts` is not example code.** It holds compile-time assertions
that have no runtime moment — construction staying sealed, a construction key
that cannot be forged, every `Entity.*` namespace member named so declaration
emit walks it. Its header explains the rules; the short version is that an
**unused** `@ts-expect-error` in that file is a failure, not noise. Do not copy
anything out of it.

[#31]: https://github.com/btravstack/entity/issues/31
