# Explanation

Why the package is built the way it is. Several of these record behaviour that
was **measured**, not assumed — the diagnostic codes are quoted so a future
change can re-check rather than re-litigate.

> Snippets below assume these imports:
>
> ```ts
> import { z } from "zod";
> import { match, P } from "unthrown";
> import { Entity, computed } from "@btravstack/entity";
> ```

## What an entity is, and why this exists

An entity is simultaneously four things: a **type** your domain code programs
against, a **validator** for data crossing a trust boundary, a **value with
behaviour** (methods, invariants), and something that **nests inside other
entities**. Most tools give you two or three at once — a validation library
gives a type and a validator; a plain class gives a type and behaviour — and
stitching the rest together by hand is exactly the repetitive, error-prone work
a library should absorb.

[Effect's `Schema.Class`](https://www.effect.website/docs/v3/schema/classes)
gets all four right at once and is the closest prior art. This package targets
the same shape on top of **zod v4** and
**[Standard Schema](https://standardschema.dev)**, with entry points named for
the use case they serve rather than one generic `parse`.

## The rule the design turns on

**Contracts compose the four `ZodObject`s; domain code composes the class.**

It comes from a real constraint in zod's schema-to-JSON-Schema conversion: a
schema carrying a `.transform()` — which is what turns parsed data into a class
instance — has no output representation. The class does exactly that, so
`z.toJSONSchema(Organization, { io: "output" })` throws by design, while the
four plain `ZodObject`s convert in both directions with no hand-written omit
lists.

## No I/O, by design

The package reads no clock and generates no id. A factory's generators, not an
internal `crypto.randomUUID()`/`Date.now()`, are how a domain-generated value
reaches an entity.

The _rule_ — which fields the domain owns, and that a caller may never supply
them — lives in the declaration. The _sources_ are bound once at your
composition root. That keeps the entity pure, and lets a test bind fixed
generators instead of stubbing globals.

Generators are functions, called once per create, so a factory built at startup
still yields a fresh id per entity.

## Sealed construction

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

## Immutability

Data is immutable in both halves. Each field is installed non-writable, and its
value is **deep-frozen** — a shallow guard would leave `org.tags.push(…)` legal,
which could push an entity into a state its own invariants had already
rejected. The instance type is `DeepReadonly<…>`, not a shallow `Readonly<…>`,
so mutation is a compile error first and a `TypeError` only if a consumer casts
around the type system:

```ts
org.slug = otherSlug; // ✗ compile error — read-only property
(org as never as Record<string, unknown>).slug = "hacked"; // TypeError

// on a `Team` declared with `tags: z.array(Tag)` and `address: Address`
team.tags.push(tag); // ✗ compile error — tags is `readonly Tag[]`
(team.tags as never as string[]).push("hacked"); // TypeError — the array is frozen
team.address.city = "Paris"; // ✗ compile error — nested objects are readonly too
```

Locking the binding alone would not be enough: `writable: false` stops
`team.tags = [...]` but not `team.tags.push(...)`, and a shallow `Readonly<D>`
types an array field as a mutable `Tag[]`, because `z.infer` of `z.array(Tag)`
is `Tag[]`. Both halves matter — the second is what lets `invariants` mean
anything after construction.

What the freeze covers is deliberately narrow: arrays and plain objects are
frozen and recursed into; `Date` is frozen as a leaf; `Map`, `Set`, typed arrays
and anything a `z.custom(...)` field hands through are left alone, because
freezing those is either theatre (a frozen `Map` still accepts `.set`) or
destructive. A field whose schema yields a live mutable object is outside the
guarantee.

`Object.freeze(this)` is **not** used and cannot be: a class body's field
initialisers run after `super()` returns, so the instance itself must stay
extensible.

## Why `computed` re-derives

A computed field reads the declared fields and is re-derived on `make` and
`update` alike, rather than computed once and stored.

The alternative was tried and is quietly wrong. Deriving `fullName` from
`first` + `last` once, then renaming the person, leaves `fullName` frozen at the
old value — and since a derived field is not patchable, unrepairable. Every
plausible use (`totalCents`, `tier`, `wordCount`, `durationDays`) has that shape.

Re-deriving also makes `make` self-healing: a row written before a derivation
changed, or before the field existed at all, is corrected on read rather than
trusted. That is why `make` validates against `input` and not `output` —
validating stored computed values would reject exactly the rows it is meant to
repair.

**Why not a getter?** Because a getter carries no schema. It cannot appear in
`output`, cannot generate JSON Schema, and is skipped by `toJSON()` — it lives
on the prototype, not in the data. The rule:

|                                                    | use        |
| -------------------------------------------------- | ---------- |
| derived, needed in the response body / JSON Schema | `computed` |
| derived, domain-only behaviour                     | a getter   |

## Entities are not subclassable

`class Sub extends Organization {}` fails at construction with a `Defect`.

A bare subclass is an alias you cannot tell apart from what it aliases: same
tag, same schemas, indistinguishable under `equals`. `extend` exists for the
legitimate case and produces a genuine entity with its own identity.

The prohibition is runtime-only. TypeScript has no `final`, and the constructor
accessibility modifiers that would express it break the declaration form or the
statics (see [Sealed construction](#sealed-construction)). So the declaration
compiles and reports on first construction.

Redeclaring a data field in a subclass is caught earlier — TypeScript reports
`TS4114` under `noImplicitOverride`, and the field is non-configurable, so
construction fails with `TypeError: Cannot redefine property`.

## `_tag` is runtime-only

Every instance carries a non-enumerable `_tag`, for pattern matching with
`unthrown`'s `P.tag(...)`:

```ts
match(member)
  .with(P.tag("User"), (u) => u.email)
  .with(P.tag("ServiceAccount"), (s) => s.label)
  .exhaustive();
```

It never reaches the wire — absent from every schema, from `toJSON()`,
`JSON.stringify`, `Object.keys` and spread. That has a direct consequence: a
union that must survive a JSON round trip **cannot** discriminate on `_tag`,
because it is not there after serialisation. Declare the discriminant as an
ordinary domain field; `Entity.union` takes that field.

The two are not redundant. A brand is per-field and type-only; the tag is
per-entity and runtime-present, which is what makes it matchable. `entityName`
is the same string read from the class rather than an instance — the only path
for code holding the class and no instance.

## Errors are values, and defects are separate

Every fallible entry point returns `Result<T, InvalidEntity>`. Bad input is
modelled; a bug in domain code is not.

The line: a field failing its schema or a broken invariant is `InvalidEntity` —
expected, caller-caused. A `computed` function throwing or producing data its
own schema rejects is a **defect**: `computed` is pure, total and typed, so a
violation is a bug rather than bad input. An async generator rejecting is a
defect for the same reason — infrastructure failing is not bad domain input.

A defect is never folded into a validation issue, even when the entity is
nested inside another schema. An unmodelled bug stays distinguishable from bad
caller input all the way to the edge.

Issues are carried **structured**, exactly as the validator produced them, so
keying a field-level error response is a `path` lookup rather than a string
parse.

## Peer dependencies

`zod`, `unthrown` and `@unthrown/standard-schema` are peer dependencies, not
bundled ones. The package hands back real `ZodObject`s and real `Result`s built
from _your_ copies. If it pinned its own, a consumer would end up with two
copies of zod in the tree, and identity checks — `result instanceof Result`,
`schema instanceof z.ZodType`, or composing an entity into your own
`z.object({...})` — can silently misbehave across the boundary between two
copies of the same package.
