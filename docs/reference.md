# Reference

Every member of the public surface. For _why_ it is shaped this way, see
[Explanation](./explanation.md); for task recipes, see the
[how-to guides](./how-to/).

> Snippets below assume these imports:
>
> ```ts
> import { z } from "zod";
> import { match, P } from "unthrown";
> import { Entity, computed } from "@btravstack/entity";
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

| Option       | Type                            | Effect                                                                           |
| ------------ | ------------------------------- | -------------------------------------------------------------------------------- |
| `generated`  | `readonly (keyof fields)[]`     | omitted from `createInput`; supplied by a factory's generators                   |
| `immutable`  | `readonly (keyof output)[]`     | omitted from `updateInput`; `update()` drops them even if smuggled in at runtime |
| `computed`   | `{ [name]: ComputedField }`     | derived fields; added to `output`, re-derived on every construction              |
| `invariants` | `(output) => readonly string[]` | rules spanning two or more fields; a non-empty result rejects                    |

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

### `Entity.factory(generators)` → `(input) => Result<Entity, InvalidEntity>`

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

### `Entity.factoryAsync(generators)` → `(input) => AsyncResult<Entity, InvalidEntity>`

The same for promise-returning generators. A generator that **rejects**
surfaces as a `Defect`, not an `InvalidEntity`.

### `Entity.make(data)` → `Result<Entity, InvalidEntity>`

The only way in. Validates against `input`, re-derives the computed fields,
checks the invariants, constructs. Extra keys are ignored, so a stored row
carrying computed columns round-trips.

### `entity.update(patch)` → `Result<Entity, InvalidEntity>`

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

## `computed(schema, from)`

One derived field: its schema, and the function producing it.

```ts
computed: {
  fullName: computed(FullName, (d) => `${d.first} ${d.last}` as z.infer<typeof FullName>),
  initials: computed(Initials, (d) => `${d.first[0]}${d.last[0]}` as z.infer<typeof Initials>),
}
```

`d` is the declared shape, contextually typed. Each return value is checked
against **that field's** schema. A computed field cannot read another computed
field — every derivation is a function of declared data only.

Output that fails its own schema is a `Defect`, named for the field
(`Person.computed.initials: …`).

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

Options merge per key, child winning. `extend` rebuilds from the
**declaration**, so class-body members do not carry over — re-declare them.

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

## `InvalidEntity`

```ts
class InvalidEntity extends TaggedError("InvalidEntity")<{
  readonly entity: string;
  readonly issues: SchemaIssues; // readonly StandardSchemaV1.Issue[]
}> {}
```

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
import type { CreateInput, Input, Output, Patch } from "@btravstack/entity";

type OrgWire = Input<typeof Organization>; // what make() accepts
type OrgState = Output<typeof Organization>; // what toJSON() returns
type OrgCreate = CreateInput<typeof Organization>; // what a factory accepts
type OrgPatch = Patch<typeof Organization>; // what update() accepts
```

`BaseInstance`, `ConstructionKey` and `Sealed` are also exported, but only so a
consumer's emitted declarations can name them. They are not part of the API you
write against.
