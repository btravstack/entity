---
title: Sealed construction
description: Why new SomeEntity(…) does not compile, the two alternatives that were measured and rejected, and why entities are not subclassable.
---

# Sealed construction

`new SomeEntity(...)` does not compile. The constructor takes a `Sealed<D>`,
and no outside code can produce a value assignable to it — so every instance
comes through `make`, `update` or a factory, which means the invariants have
run and the stored data is exactly what `output` describes.

The seal is a type, not a runtime check, because a runtime guard would mean
throwing — which this package exists to avoid.

Two alternatives were measured and rejected:

- **`private constructor`** → `TS2675: Cannot extend a class 'Base'`. The
  declaration form `class X extends Entity("X")(…)` stops compiling outright.
- **`protected constructor`** → seals correctly (`TS2674`) but breaks the
  statics with `TS2684` — a protected constructor type is not assignable to a
  public one — so `make` could only return the base class.

The key is an **exported but unconstructable** `ConstructionKey` rather than a
module-private `unique symbol`. That matters for consumers: a `unique symbol`
in computed-key position cannot be named across a module boundary even when
exported, so any downstream library compiling with `declaration: true` failed
with `TS4020: 'extends' clause of exported class has or is using private name`.
A fixture in CI compiles a consumer with declaration emit against the built
types, so that cannot regress.

## Entities are not subclassable

`class Sub extends Organization {}` fails at construction with a `Defect`.

A bare subclass is an alias you cannot tell apart from what it aliases: same
tag, same schemas, indistinguishable under `equals`.
[`extend`](/reference/declaration#someentity-extend-tag-fields-options) exists
for the legitimate case and produces a genuine entity with its own identity.

The prohibition is runtime-only. TypeScript has no `final`, and the constructor
accessibility modifiers that would express it break the declaration form or the
statics (see above). So the declaration compiles and reports on first
construction.

Redeclaring a data field in a subclass is caught earlier — TypeScript reports
`TS4114` under `noImplicitOverride`, and the field is non-configurable, so
construction fails with `TypeError: Cannot redefine property`.
