---
title: Declaring an entity
description: Entity(tag)(fields, options), the field rules, the four options, and the Entity.computed / Entity.invariant / extend / union declaration helpers.
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

## `SomeEntity.extend(tag)(fields, options?)`

A **new** entity carrying the parent's fields plus more, under its own tag —
its own schemas, its own `equals` identity.

```ts
class PersonWithAge extends Person.extend("PersonWithAge")({ age: Age }) {
  get isAdult(): boolean {
    return this.age >= 18;
  }
}
```

Options merge per key, child winning — **except `invariants`**, which
concatenates parent-then-child. An extension can add rules; it cannot shed them,
so it is never quietly laxer than what it extends. Declaring `invariants: []` on
a child does not clear the parent's.

`extend` rebuilds from the **declaration**, so class-body members do not carry
over — re-declare them.

This is the only supported way to build on an existing entity: a bare
`class Sub extends Organization {}` is
[rejected at construction](/explanation/sealed-construction#entities-are-not-subclassable).

## `Entity.union(discriminant, members)`

A union of entities that is itself entity-like.

```ts
const Member = Entity.union("kind", [User, ServiceAccount]);

Member.make(row); // Result<User | ServiceAccount, InvalidEntity>
Member.input; // discriminated union, one branch per member
Member.output; // ditto — JSON Schema both directions
Member.members; // the tuple, for registries and exhaustiveness
Member.discriminant; // "kind"
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
