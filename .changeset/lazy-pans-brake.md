---
"@btravstack/entity": minor
---

`equals` now delegates to `node:util`'s `isDeepStrictEqual` instead of a
hand-rolled traversal. Behaviour is unchanged for every case the suite pins —
`bigint`, `Set`/`Map` by contents, nested key order, typed arrays and
`ArrayBuffer` bytewise, `RegExp`, `Date`, and cyclic values — with one
difference: `+0` and `-0` now compare **unequal** (`Object.is` semantics) where
the previous implementation treated them as equal (SameValueZero).

This makes the package **Node-only**: it now imports a `node:` builtin, so a
browser or edge bundle without a `node:util` shim will fail to resolve it.
