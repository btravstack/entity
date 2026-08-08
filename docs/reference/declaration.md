---
title: Declaring an entity
description: Entity(tag)(fields, options), the field rules, the four options, and the Entity.computed / Entity.invariant / Entity.abstract / Entity.union declaration helpers.
---

# Declaring an entity

The builder itself, the rules a field map must satisfy, the four options, and the
helpers that go inside them. For _why_ it is shaped this way, see
[Explanation](/explanation/why-entity); for task recipes, see the
[how-to guides](/how-to/http-contract).

> Snippets on this page assume these imports:
>
> ```ts
> import { z } from "zod";
> import { Entity } from "@btravstack/entity";
> ```

## `Entity(tag)(fields, options?)`

Declares an entity. Curried on the tag so it reads next to the class name.

```ts
class Organization extends Entity("Organization")(fields, options) {}
```

The declared class is **final**. There is no `Organization.extend`, and a bare
`class Sub extends Organization {}` is
[rejected at construction](/explanation/sealed-construction#an-entity-is-final).
Fields shared by several entities go on an
[abstract root](#entity-abstract-name-fields-options); behaviour that belongs to
this one entity goes in its own class body.

### `fields`

A map of field name to schema. Every field must be **nominal** — a branded
schema, a narrow literal union, a boolean, or another entity class. A bare
`z.string()` is a compile error naming `DomainFieldMustBeBrandedOrAnEntity`.
([Why](/explanation/branded-fields).)

The check looks through two wrappers: `.optional()` is stripped, and one array
level is unwrapped. So `z.array(Customer)`, `z.optional(Slug)` and even
`z.array(Slug).optional()` are all accepted — the rule applies to the element,
not the container.

Four names are reserved, because an entity installs them on every instance:
`_tag`, `equals`, `toJSON`, `update`. Using one is a compile error naming
`FieldNameIsReservedByEntity`.

### `options`

| Option       | Type                               | Effect                                                                             |
| ------------ | ---------------------------------- | ---------------------------------------------------------------------------------- |
| `generated`  | `readonly (keyof fields)[]`        | omitted from `createInput`; supplied by a factory's generators                     |
| `immutable`  | `readonly (keyof output)[]`        | omitted from `updateInput`; `update()` rejects them even if smuggled past the type |
| `computed`   | `{ [name]: Entity.ComputedField }` | derived fields; added to `output`, re-derived on every construction                |
| `invariants` | `readonly Entity.Invariant[]`      | rules spanning two or more declared fields; any failing rule rejects               |

`generated` and `immutable` are keyed off the field names, so a typo is a
compile error rather than a silently-inert entry.

`Entity.ComputedField<T, D>` and `Entity.Invariant<D>` are both generic; the
parameters are elided above because you never write them. `Entity.computed` and
`Entity.invariant` infer them from the surrounding declaration, which is what
makes `d` contextually typed with no annotation.

## `Entity.computed(schema, from)`

One derived field: its schema, and the function producing it.

```ts
computed: {
  fullName: Entity.computed(FullName, (d) => `${d.first} ${d.last}` as z.infer<typeof FullName>),
  initials: Entity.computed(Initials, (d) => `${d.first[0]}${d.last[0]}` as z.infer<typeof Initials>),
}
```

`d` is the declared shape, contextually typed. Each return value is checked
against **that field's** schema. A computed field cannot read another computed
field — every derivation is a function of declared data only.

Output that fails its own schema is a `Defect`, named for the field
(`Person.computed.initials: …`).

Computed fields are re-derived on every construction path rather than stored —
see [Why `computed` re-derives](/explanation/computed-fields), which also covers
when to reach for a plain getter instead.

## `Entity.invariant(ensure, message)`

One rule spanning the whole entity: the predicate, and what to say when it
fails.

```ts
invariants: [
  Entity.invariant(
    (d) => d.name.length <= 80,
    "name must be at most 80 characters",
  ),
  Entity.invariant(
    (d) => d.endsAt > d.startsAt,
    (d) => `endsAt must be after ${d.startsAt}`,
  ),
];
```

`ensure` returning **true** means valid — a rule reads as the assertion it
makes. `d` is contextually typed and needs no annotation. `message` takes the
data when the text depends on it.

Every failing rule in the list reports, not just the first, and none of them
carries a `path`: an invariant spans the entity, which is what separates it from
a field complaint.

`d` is the **declared** fields, not the output — a rule cannot read a computed
field. Every computed value is a function of declared data, so any rule about
one is expressible over its sources, and a computed value failing its own schema
is already a Defect rather than something to re-check here.

A predicate that throws is a Defect, not an `InvalidEntity`, on the same
reasoning as `computed`.

## `Entity.abstract(name)(fields, options?)`

A **root**: the fields and the behaviour several entities share, in a class that
is extended rather than instantiated.

```ts
abstract class AccountBase extends Entity.abstract("Account")(
  { id: AccountId, label: Label },
  { immutable: ["id"] },
) {
  abstract describe(): string;

  get slug(): string {
    return this.label.toLowerCase();
  }
}
```

`fields` and `options` are exactly what `Entity(tag)(…)` takes — same field
rules, same four options — and both are inherited by every entity extended from
the root.

A root is **not** an entity. It has no `make`, no `factory`, and none of the
four schema members; those belong to a variant, which has a tag to build them
under. Reaching its constructor is a defect:

```
Account: an abstract root has no instances — extend it and use make()
```

`name` is what labels the root in that message. It never reaches an instance:
a variant's `_tag` is the variant's own, and on the root's instance type `_tag`
is widened to `string` so shared behaviour can still read it.
([Why](/explanation/unions-and-roots#why-the-root-carries-no-tag).)

| On a root                                             |                                                        |
| ----------------------------------------------------- | ------------------------------------------------------ |
| `abstract` members                                    | enforced on every variant — `TS2515` if one is missing |
| methods and getters                                   | inherited by every variant                             |
| **class-body fields** (`count = 0`)                   | typed, but **never initialised** — see below           |
| **statics** (`static of() {}`)                        | **not** inherited; they stay on the root               |
| `toJSON`, `equals`, `update`                          | callable, never overridable                            |
| `variant instanceof Root`                             | `true`                                                 |
| an intermediate `abstract class … {}` (no new fields) | inherited, behaviour and the root's fields both        |

`extend` rewires the **instance prototype** and nothing else — one
`setPrototypeOf` on the new entity's prototype. That single fact is behind every
row above that is not plain inheritance.

A class-body **field** is never initialised. The variant's generated base
extends nothing, so a root's constructor never runs and no field initialiser
fires:

```ts
abstract class WithField extends Entity.abstract("WithField")({ id }) {
  counter = 0; // typed `number`; `undefined` at runtime, and not an own property
}
```

Use a **getter or a method** for anything a root needs to hold. The type level
cannot catch the field form: mapping the root's instance type is exactly what
`TS2425` forbids, so the field's declared type survives into the variant intact.

Visibility makes no difference, and `private` is the worst version of it. A
`private cache = new Map()` on a root compiles, in the root and in every
variant; the field is `undefined` at runtime; and the first root method that
reads it fails at the point of use rather than at the declaration —
measured: `TypeError: Cannot read properties of undefined (reading 'size')`.

**Statics are not inherited either**, for the same reason: the static chain is
untouched, so `Root.of(…)` is not `Variant.of(…)`. The type side agrees, so
this surfaces as a compile error rather than an `undefined is not a function`.

The three prototype methods are the one asymmetry in the other direction: the
entity's own prototype sits above the root's, so a member declared under one of
those names on a root compiles and is silently never called. Behaviour that must
differ per variant goes in the variant's body — an `abstract` member on the root
is how to require it.

An intermediate root is an ordinary abstract class, so behaviour can be layered
without another declaration:

```ts
abstract class Auditable extends AccountBase {
  audit(): string {
    return `${this._tag}:${this.id}`;
  }
}

class Business extends Auditable.extend("Business")({
  kind: z.literal("business"),
}) {
  override describe(): string {
    return `business ${this.slug}`;
  }
}
```

An intermediate adds behaviour only. There is no way to declare further fields
on one — fields come from a root's `fields` map and a variant's `extend` call,
and nothing in between.

### Where a root goes

A root has to be **exported** for entities in another module to extend it:
`extend` is a call on the value, so an unexported root can only be extended
inside its own module.

Both arrangements work, and this repo compiles both, because they emit
differently. A root's instance type is the last type argument of every variant's
`Entity.Static`, so it reaches the `.d.ts` of whatever module the variants are
exported from — kept beside its variants, TypeScript synthesises a local
`declare abstract class` for it; across a module boundary, the emitted
declaration has to name the export, and opens with
`import { AccountBase } from "./root.js"`.
[`examples/billing-domain`](/examples/billing-domain) splits the two apart so
the second path is covered by the two-compiler declaration pass.

### `Root.extend(tag)(fields, options?)`

A **new** entity carrying the root's fields plus more, under its own tag — its
own schemas, its own `equals` identity — inheriting the **instance** half of the
class body of whatever it was called on: its methods and accessors, but not its
statics and not its field initialisers
([above](#entity-abstract-name-fields-options)).

```ts
class Personal extends AccountBase.extend("Personal")({
  kind: z.literal("personal"),
}) {
  override describe(): string {
    return `personal ${this.slug}`;
  }
}
```

Options **accumulate**, root-then-variant. A variant adds to what it inherits
and cannot shed it, so it is never quietly laxer than its root.

| Option       | How a variant's declaration meets the root's                  |
| ------------ | ------------------------------------------------------------- |
| `generated`  | concatenated, root-then-variant                               |
| `immutable`  | concatenated, root-then-variant                               |
| `invariants` | concatenated, root-then-variant                               |
| `computed`   | merged **per key** — a repeated key takes the variant's entry |

A variant names only what it adds. `Personal` above declares no options and
inherits everything `AccountBase` declared; a variant declaring
`immutable: ["kind"]` is immutable in `kind` **and** in every key the root
listed.

Relaxing is not expressible. `immutable: []` on a variant does not widen
`updateInput`, and `invariants: []` does not clear the root's rules — an empty
list contributes nothing, which is not the same as taking something away.

The key lists are not deduplicated, and do not need to be. Each is turned into a
keyed lookup before it reaches a schema or a patch check, so naming a key the
root already declared is harmless.

`computed` merges per key rather than concatenating, because it is a map. A
variant can add a derived field beside the root's, and can **redefine** one the
root declared — its schema and its derivation replace that entry alone — but
cannot drop one.

Redefining an inherited computed key has one edge, measured. The variant's
derivation is what runs, and every surface read off the declaration agrees with
it: `Variant.output.shape`, `toJSON()` and `Entity.Output<typeof Variant>` all
carry the variant's schema. The **instance property** does not — it keeps the
root's type intersected in, so a key the root branded `Upper` and the variant
rebranded `Label` reads as `Upper & Label` on an instance, and is still
assignable where the root's brand is expected. The root's instance type is
intersected into every variant **unmapped**, and subtracting a key from it is
exactly what `TS2425` forbids: any mapped form turns the root's methods into
function-typed properties and breaks every variant implementing an `abstract`
member. There is no fix pending; read the field off
`Entity.Output<typeof Variant>` where its exact type matters.

`extend` lives only on a root. The entity it returns is final.

## `Entity.union(discriminant, members)`

A union of entities, declared as a class.

```ts
class Account extends Entity.union("kind", [Personal, Business]) {
  /** a union's class body is for statics — it has no instances */
  static parse(row: unknown) {
    return Account.make(row);
  }
}

Account.make(row); // Result<Personal | Business, InvalidEntity>
Account.input; // discriminated union, one branch per member
Account.output; // ditto — JSON Schema both directions
Account.members; // the tuple, for registries and exhaustiveness
Account.discriminant; // "kind"
```

As a **type**, `Account` is the root its members share — `AccountBase` above —
or the empty type when they share none. The exact member union is
`Entity.Instance<typeof Account>`; `make` returns it either way.
([Why](/explanation/unions-and-roots#why-a-union-s-type-is-its-members-root-not-its-members).)

`new Account(...)` does not compile, and reaching the constructor at runtime is
a defect — `make` dispatches to a member, so nothing is ever an instance of the
union:

```
Personal | Business: a union has no instances — use make()
```

`discriminant` names a declared domain field, not `_tag`. The union dispatches
on it rather than trying each branch, so a failing member reports its own
issues. The union is a schema too, so it nests as a field.

A payload whose discriminant matches no member fails as an `InvalidEntity`
whose one issue carries `path: [discriminant]` — see
[Errors](/reference/errors#which-channel-a-failure-takes). Two members claiming
the same discriminant value is a **declaration-time defect**: `Entity.union`
throws, naming both members, rather than letting the last one silently win the
dispatch table.

```ts
Entity.union("kind", [User, AlsoUser]);
// throws: union("kind"): members "User" and "AlsoUser"
//         both claim discriminant value "user"
```

`_tag` cannot serve as the discriminant here, and that is not an oversight —
[it never reaches the wire](/explanation/tags-and-identity).
