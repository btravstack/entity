---
"@btravstack/entity": minor
---

**BREAKING**: `decoded: { omit, add }` is replaced by a top-level `computed`.

`omit` is removed. A field the entity should not store is transformed before
`create` is called, in the use case that owns the transformation — which also
lets it be async, as password hashing is.

`add` becomes `computed`, takes two arguments instead of being curried, and —
the substantive change — reads the **declared** fields and is **re-derived on
every construction** rather than computed once from the wire payload and
frozen. A derived value can no longer go stale against its sources, and `make`
heals a row written before the derivation changed.

```ts
// before — computed once from the wire payload, then frozen
decoded: {
  omit: ["secret"],
  add: add({ fingerprint: Fingerprint })((e) => ({ fingerprint: hash(e.secret) })),
}

// after — derived from the declared fields, re-derived on every construction
computed: computed({ fullName: FullName }, (d) => ({
  fullName: `${d.first} ${d.last}`,
}))
```

Computed fields remain absent from `updateInput` and `Patch`. `DecodedOf`,
`PatchOf` and `UpdateInputShapeOf` lose their omit type parameter, and
`AddedOf`/`AddSpec` are renamed `ComputedOf`/`ComputedSpec`.
