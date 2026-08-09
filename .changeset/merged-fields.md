---
"@btravstack/entity": minor
---

Type a root's merged field map as child-wins, matching the runtime.

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
