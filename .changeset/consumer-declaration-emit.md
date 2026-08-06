---
"@btravstack/entity": minor
---

Fix: a downstream library that emits its own declarations can now use the
package at all.

`class X extends Entity("X")(...)` failed with `TS4020: 'extends' clause of
exported class has or is using private name 'CtorKey'` (and `'BaseInstance'`)
for any consumer compiling with `declaration: true` — which is every published
TypeScript library. The package's own build never surfaced it, because its
`tsc` pass is `noEmit`.

The construction seal now uses an exported-but-unconstructable
`ConstructionKey` instead of a module-private `unique symbol`: a `unique
symbol` in computed-key position cannot be named across a module boundary even
when exported, while an ordinary property whose _type_ is an exported class
can. `ConstructionKey`, `Sealed` and `BaseInstance` are exported as types so
the emitted declarations can reference them; none is constructible and none is
meant to be used directly.

The seal is unchanged in strength — `new SomeEntity(...)` is still a compile
error, and `ConstructionKey` cannot be forged structurally.
