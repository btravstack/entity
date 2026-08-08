---
"@btravstack/entity": minor
---

`extend` options now accumulate instead of replacing. `generated` and
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

The same `TS2344` loosens three constraints. `Entity.Static`, `Entity.Abstract`
and `Entity.BaseInstance` now take any `PropertyKey` where they previously
required a tuple constrained to `keyof`; tightening one back on its own
reintroduces the error, so it is not fixable asymmetrically. Hand-written entity
declarations are unaffected — the builders still constrain the real call sites —
but all three are named in consumers' emitted declarations, which is why it is
listed here.
