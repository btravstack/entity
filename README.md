# @btravstack/entity

**A domain-entity builder for [TypeScript](https://www.typescriptlang.org/), on [zod](https://zod.dev) v4 — branded fields, immutable data, sealed construction, and `Result` instead of throws.**

[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-blue?logo=typescript)](https://www.typescriptlang.org/)

One declaration gives you a type, four request/response schemas, behaviour, and
a class that is itself a zod schema — so entities nest inside each other
without losing what makes them entities. Nothing throws: every fallible
operation returns an [`unthrown`](https://github.com/btravstack/unthrown)
`Result`.

```ts
import { z } from "zod";
import { Entity } from "@btravstack/entity";

const OrgId = z.uuid().brand("OrgId");
const Slug = z.string().min(1).brand("Slug");
const DisplayName = z.string().min(1).brand("DisplayName");
const Instant = z.iso.datetime().brand("Instant");
const Upper = z.string().min(1).brand("Upper");

class Organization extends Entity("Organization")(
  { id: OrgId, slug: Slug, name: DisplayName, createdAt: Instant },
  {
    generated: ["id", "createdAt"],
    immutable: ["id", "createdAt", "slug"],
    computed: {
      shout: Entity.computed(
        Upper,
        (d) => d.name.toUpperCase() as z.infer<typeof Upper>,
      ),
    },
    invariants: (d) =>
      d.name.length <= 80 ? [] : ["name must be at most 80 characters"],
  },
) {
  get greeting(): string {
    return `Welcome, ${this.name}`;
  }
}
```

## Install

```sh
pnpm add @btravstack/entity zod unthrown @unthrown/standard-schema
```

`zod`, `unthrown` and `@unthrown/standard-schema` are **peer dependencies** —
install all four. ([Why](./docs/explanation.md#peer-dependencies).)

## A worked example

One pass through the whole lifecycle: declare, create, persist, rehydrate,
respond.

```ts
// 1. Bind the effect sources once, where your ports already live. The entity
//    reads no clock and generates no id itself.
const createOrganization = Organization.factory({
  id: () => ids.next(),
  createdAt: () => clock.now(),
});

// 2. A create use case supplies only the caller's fields.
const org = createOrganization({ slug, name }).getOrThrow();
org.greeting; // "Welcome, Acme" — from your class body
org.shout; // "ACME" — derived, and re-derived on every construction

// 3. Persist. `toJSON()` projects exactly the stored shape — never `_tag`,
//    never your class-body fields.
await db.insert(org.toJSON());

// 4. Rehydrate a row. Same entry point as an untrusted payload: validate,
//    re-derive the computed fields, check the invariants, construct.
const loaded = Organization.make(row).getOrThrow();

// 5. Update. Returns a NEW entity; invariants re-run; immutable fields are a
//    compile error and are dropped at runtime if smuggled past it.
const renamed = loaded.update({ name: nextName }).getOrThrow();

// 6. Respond. The four schema members are plain `ZodObject`s, so a contract
//    layer converts them to JSON Schema in both directions.
const ResponseBody = Organization.output;
```

Failures are values, not exceptions:

```ts
import { P } from "unthrown";

Organization.make({ ...row, name: "" }).match({
  ok: (o) => o,
  errCases: (m) => m.with(P.tag("InvalidEntity"), (e) => e.issues), // [{ path: ["name"], … }]
  defect: (cause) => report(cause), // a bug in domain code, kept separate
});
```

## The surface, at a glance

| Schema member | Type        | For                                                                      |
| ------------- | ----------- | ------------------------------------------------------------------------ |
| `input`       | `ZodObject` | everything `make()` accepts                                              |
| `output`      | `ZodObject` | stored state and response body                                           |
| `createInput` | `ZodObject` | create request — `input` minus `generated`                               |
| `updateInput` | `ZodObject` | update request — `output` minus `immutable`, partial                     |
| _the class_   | zod schema  | parses to an instance; valid as a field, and anywhere zod takes a schema |

| Entry point                       | Takes                           | For                                        |
| --------------------------------- | ------------------------------- | ------------------------------------------ |
| `SomeEntity.factory(gens)(input)` | caller fields only              | a create use case                          |
| `SomeEntity.make(data)`           | everything `input` describes    | a row, an event fold, an untrusted import  |
| `entity.update(patch)`            | a partial of the mutable fields | an update use case                         |
| `entity.toJSON()`                 | —                               | the stored data, for a write or a response |

| Option       | Meaning                                                                 |
| ------------ | ----------------------------------------------------------------------- |
| `generated`  | fields the domain supplies, never the caller                            |
| `immutable`  | fields that never change after creation                                 |
| `computed`   | fields derived from the declared ones, re-derived on every construction |
| `invariants` | `(output) => string[]` — a non-empty result rejects                     |

Also `Entity.union(discriminant, members)` for a union that is itself
entity-like, and `SomeEntity.extend(tag)(fields)` to build a new entity from an
existing one.

## Documentation

- **[Reference](./docs/reference.md)** — every member, option and type, with signatures.
- **[Explanation](./docs/explanation.md)** — why it is built this way: sealed construction, deep immutability, no I/O, why entities are not subclassable.
- **How-to guides**
  - [Expose an HTTP contract](./docs/how-to/http-contract.md)
  - [Persist and rehydrate](./docs/how-to/persist-and-rehydrate.md)
  - [Model an aggregate](./docs/how-to/model-an-aggregate.md)
  - [Test domain logic](./docs/how-to/test-domain-logic.md)

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution gate, the commit
convention, and how the Node version matrix is chosen.

## License

[MIT](./LICENSE) © Benoit TRAVERS
