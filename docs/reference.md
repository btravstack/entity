# Reference

Every member of the public surface. For _why_ it is shaped this way, see
[Explanation](./explanation.md); for task recipes, see the
[how-to guides](./how-to/).

> Snippets below assume these imports:
>
> ```ts
> import { z } from "zod";
> import { match, P } from "unthrown";
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

Four names are reserved, because an entity installs them on every instance:
`_tag`, `equals`, `toJSON`, `update`. Using one is a compile error naming
`FieldNameIsReservedByEntity`.

### `options`

| Option       | Type                        | Effect                                                                           |
| ------------ | --------------------------- | -------------------------------------------------------------------------------- |
| `generated`  | `readonly (keyof fields)[]` | omitted from `createInput`; supplied by a factory's generators                   |
| `immutable`  | `readonly (keyof output)[]` | omitted from `updateInput`; `update()` drops them even if smuggled in at runtime |
| `computed`   | `{ [name]: ComputedField }` | derived fields; added to `output`, re-derived on every construction              |
| `invariants` | `readonly Invariant[]`      | rules spanning two or more declared fields; any failing rule rejects             |

`generated` and `immutable` are keyed off the field names, so a typo is a
compile error rather than a silently-inert entry.

## Schema members

```ts
Organization.input; // ZodObject — everything make() accepts
Organization.output; // ZodObject — stored state and response body
Organization.createInput; // ZodObject — input minus generated
Organization.updateInput; // ZodObject — output minus immutable, partial
Organization.entityName; // the tag, as a literal type
Organization; // …is itself a zod schema, parsing to an instance
```

`output` is `input` plus the computed fields. All four `ZodObject`s generate
JSON Schema in **both** `"input"` and `"output"` directions.

The class carries zod's internal slots (`_zod`, `~standard`) but **not** its
methods, so it composes anywhere zod takes a schema while `.parse()` — which
throws — does not exist on it:

```ts
z.object({ owner: Organization }); // ✓
z.array(Organization); // ✓
z.optional(Organization); // ✓ the function form
Organization.optional(); // ✗ does not exist
Organization.parse(raw); // ✗ does not exist — use make()
z.toJSONSchema(Organization, { io: "output" }); // ✗ throws — the class carries a transform
```

## Entry points

### `SomeEntity.factory(generators)` → `(input) => Result<SomeEntity, InvalidEntity>`

Binds the `generated` fields' sources. Generators are **functions**, called
once per create.

```ts
const createOrg = Organization.factory({
  id: () => ids.next(),
  createdAt: () => clock.now(),
});
createOrg({ slug, name }); // Result<Organization, InvalidEntity>
```

Pass an arrow, not a bare method reference — `{ id: ids.next }` loses `this`.

### `SomeEntity.factoryAsync(generators)` → `(input) => AsyncResult<SomeEntity, InvalidEntity>`

The same for promise-returning generators — an id from a database sequence,
say. A generator that **rejects** surfaces as a `Defect`, not an
`InvalidEntity`: infrastructure failing is not the same as bad domain input.

```ts
const createOrgAsync = Organization.factoryAsync({
  id: () => ids.nextFromSequence(),
  createdAt: () => clock.now(),
});
(await createOrgAsync({ slug, name })).getOrThrow();
```

### `SomeEntity.make(data)` → `Result<SomeEntity, InvalidEntity>`

The only way in. Validates against `input`, re-derives the computed fields,
checks the invariants, constructs. Extra keys are ignored, so a stored row
carrying computed columns round-trips.

### `entity.update(patch)` → `Result<SomeEntity, InvalidEntity>`

Returns a **new** entity. Re-runs the invariants and re-derives the computed
fields. `immutable` and `computed` fields are absent from the patch type and
dropped at runtime.

### `entity.toJSON()` → the stored shape

Projects exactly `output`'s keys. Excludes `_tag` and any class-body fields.
Called implicitly by `JSON.stringify`.

### `entity.equals(other)` → `boolean`

True when both are the same entity and their stored data is deep-equal.
Compares the serialised form, so entities holding equal arrays compare equal.
Two separate `Entity(...)` calls never compare equal, even with identical
fields.

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

## `Entity.InvalidEntity`

```ts
class InvalidEntity extends TaggedError("InvalidEntity")<{
  readonly entity: string;
  readonly issues: SchemaIssues; // readonly StandardSchemaV1.Issue[]
}> {}
```

Reachable as both a value and a type — `e instanceof Entity.InvalidEntity` and
`const e: Entity.InvalidEntity`. The signatures above write it unqualified, the
way `SomeEntity` is also a stand-in; `Entity.InvalidEntity` is how you spell it.
Matching by tag needs no import at all: `P.tag("InvalidEntity")`.

Schema failures carry the failing field's `path`; an `invariants` violation has
none — that absence distinguishes a whole-entity rule from a field complaint.

| Failure                                  | Channel                              |
| ---------------------------------------- | ------------------------------------ |
| a field fails its own schema             | `InvalidEntity`, issue has a `path`  |
| a broken `invariants` rule               | `InvalidEntity`, issue has no `path` |
| `computed` output failing its own schema | **defect**                           |
| a `computed` function throwing           | **defect**                           |
| an async generator rejecting             | **defect**                           |
| subclassing an entity                    | **defect**                           |

## Helper types

```ts
import { Entity } from "@btravstack/entity";

type OrgWire = Entity.Input<typeof Organization>; // what make() accepts
type OrgState = Entity.Output<typeof Organization>; // what toJSON() returns
type OrgCreate = Entity.CreateInput<typeof Organization>; // what a factory accepts
type OrgPatch = Entity.Patch<typeof Organization>; // what update() accepts
```

Also `Entity.ComputedField` and `Entity.Union`, the shapes `Entity.computed` and
`Entity.union` return.

`BaseInstance`, `ConstructionKey` and `Sealed` are the one exception to the
single-import rule: they are exported at the top level **as well as** under
`Entity`, because a downstream library compiling with `declaration: true` emits
the underlying name rather than the namespace path that aliases it, and would
otherwise fail with `TS4020`. They are not part of the API you write against.

```ts
import type { BaseInstance, ConstructionKey, Sealed } from "@btravstack/entity";
```
