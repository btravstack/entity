# @btravstack/entity

Domain entities on zod v4: branded fields, immutable data, sealed
construction, and `Result` instead of throws.

```ts
import { z } from "zod";
import { Entity } from "@btravstack/entity";

const OrgId = z.uuid().brand("OrgId");
const Slug = z.string().min(1).brand("Slug");
const DisplayName = z.string().min(1).brand("DisplayName");
const Instant = z.iso.datetime().brand("Instant");

class Organization extends Entity("Organization")(
  { id: OrgId, slug: Slug, name: DisplayName, createdAt: Instant },
  {
    generated: ["id", "createdAt"],
    immutable: ["id", "createdAt", "slug"],
    invariants: (d) => (d.name.length > 0 ? [] : ["name must not be empty"]),
  },
) {}

// effect sources bound once, at the composition root
const orgs = Organization.factory({
  id: () => ids.next(),
  createdAt: () => clock.now(),
});

const org = orgs.create({ slug, name }).getOrThrow();

org.update({ name: newName }); // a NEW entity; immutable fields rejected at compile time
Organization.make(row); // row mappers and event folds
org.toJSON(); // stored data — never carries _tag
org.equals(other); // equal stored data
```

Every fallible entry point (`make`, `make`, `create`, `update`) returns an
`unthrown` `Result<T, InvalidEntity>` — call `.getOrThrow()`, `.match()`, or
any other `Result` combinator on it, per this library's error-as-values
convention. `InvalidEntity.issues` is `SchemaIssues` — Standard Schema issues,
kept structured: a **schema** issue carries the failing field's `path`, an
`invariants` message has none. See the [root README](../../README.md) for the full guide,
including `computed` fields, unions, and the lifecycle in a
hexagonal architecture.

## `Entity(tag)(fields, options?)`

`fields` is a map of field name to a **branded** zod schema — an unbranded
field is a compile error, so every field carries a nominal type from the
start. `tag` is curried separately from `fields` so it reads next to the
class name it labels, ahead of the field map.

`options` are all optional:

| Option       | Meaning                                                                                                       |
| ------------ | ------------------------------------------------------------------------------------------------------------- |
| `generated`  | keys the domain supplies, not the caller — omitted from `createInput`                                         |
| `immutable`  | keys that never change after creation — omitted from `updateInput`                                            |
| `computed`   | fields derived from the declared ones, declared with the `computed` helper — re-derived on every construction |
| `invariants` | `(output) => readonly string[]` — non-empty means rejected, checked on every `make`, `create` and `update`    |

## Statics

| Static               | Kind            | Purpose                                                                   |
| -------------------- | --------------- | ------------------------------------------------------------------------- |
| `entityName`         | `string`        | the tag passed to `Entity(tag)`                                           |
| `input`              | `ZodObject`     | the full wire object                                                      |
| `output`             | `ZodObject`     | stored state and response body                                            |
| `createInput`        | `ZodObject`     | create request — `input` minus `generated`                                |
| `updateInput`        | `ZodObject`     | update request — `output` minus `immutable`, partial                      |
| `instance`           | `ZodType`       | parses straight to a class instance, for nesting entities in domain code  |
| `~standard`          | Standard Schema | `instance`'s Standard Schema entry point                                  |
| `make(state)`        | method          | already-stored state → entity, for row mappers and event folds            |
| `factory(gens)`      | method          | binds the generated fields' sources → `{ create(input) }`                 |
| `factoryAsync(gens)` | method          | same, for promise-returning generators → `{ create(input): AsyncResult }` |

**Contracts compose the four `ZodObject`s (`input`, `output`, `createInput`,
`updateInput`); domain code composes `instance`.** All four `ZodObject`s
generate JSON Schema in both `"input"` and `"output"` directions. `instance`
carries a transform, so it has no _output_ representation —
`z.toJSONSchema(SomeEntity.instance, { io: "output" })` throws by design, and a
test in `contract.spec.ts` pins that.

## Instance members

- the declared data fields, **deeply** read-only: each is installed
  non-writable _and_ deep-frozen at construction, and typed
  `DeepReadonly<...>`, so `entity.tags.push(...)` and
  `entity.address.city = ...` are compile errors and `TypeError`s, not silent
  mutations of validated state — see
  [Immutability](../../README.md#immutability) for what the freeze covers and
  why `Object.freeze(this)` is not used
- `_tag` — a **non-enumerable, runtime-only** literal, matchable with
  `P.tag(...)`. It never reaches the wire: it is absent from every schema, and
  from `toJSON()`, `Object.keys(...)` and `{ ...entity }`. A union
  that must survive JSON round-tripping discriminates on a declared domain
  field, not on `_tag` — see `union.spec.ts`.
- `update(patch)` — a partial of the mutable fields → a **new** entity,
  re-running the invariants; immutable fields are dropped even if smuggled
  in at runtime past the type check
- `toJSON()` — the stored data, projected to exactly the `output` schema's
  keys, even when the class body declares extra fields. This is the **only** public
  projection: it is the hook `JSON.stringify` looks for, so it has to exist,
  and a second method returning the same value under a domain name would be
  the alias this package resists. A repository write is
  `db.insert(org.toJSON())`
- `equals(other)` — true when both are the same entity type and their
  stored data is deep-equal. Two separate `Entity(...)` calls never compare
  equal, even with identical fields

## Computed fields

`computed` declares fields derived from the declared ones:

```ts
computed: {
  fullName: computed(FullName, (d) => `${d.first} ${d.last}`),
  initials: computed(Initials, (d) => `${d.first[0]}${d.last[0]}`),
}
```

One entry per derived field. `d` is the declared shape, contextually typed, and
each return value is checked against that field's own schema, so every value
must already be branded.

A computed field is **re-derived on every construction** — `make`, `make` and
`update` alike — so it cannot drift from the data it derives from, and `make`
heals a row written before the derivation changed. It follows that it is not
patchable: absent from `updateInput` and `Patch`, and dropped by `update()`
even if smuggled in at runtime.

Use a **getter** instead when the derived value is domain-only. A getter
carries no schema, so it cannot reach `output`, the JSON Schema, or
`toJSON()`; `computed` exists for exactly the cases where it must.

## Helper types

Four generic type-level helpers name each shape by reading it off an entity
class, instead of re-declaring it:

```ts
import type { CreateInput, Input, Output, Patch } from "@btravstack/entity";

type OrgWire = Input<typeof Organization>; // for mapper and request signatures
type OrgState = Output<typeof Organization>; // for `make` and repository signatures
type OrgCreate = CreateInput<typeof Organization>; // what `create` accepts from a caller
type OrgPatch = Patch<typeof Organization>; // what `update` accepts
```

## Peer dependencies

This package peer-depends on `zod` (`^4.4.0`), `unthrown` (`^5.0.0`) and
`@unthrown/standard-schema` (`^5.0.0`) rather than bundling its own copies. It
hands back real `ZodObject`s and real `Result`s from those exact packages, so
a consumer's own `z.toJSONSchema`, `instanceof` checks against `unthrown`
constructs, and `P.tag` matching all operate on one shared runtime — a second
copy of `zod` or `unthrown` in the dependency tree would silently break
identity checks like `result instanceof Result` or a discriminated schema
built by mixing this package's output with the consumer's own.

See the [root README](../../README.md) for the full guide and design
rationale.

## License

[MIT](./LICENSE) © Benoit TRAVERS
