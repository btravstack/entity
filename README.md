<div align="center">

<picture>
  <source media="(prefers-color-scheme: dark)" srcset="docs/public/logo-dark.svg">
  <img src="docs/public/logo-light.svg" alt="entity" width="170" height="114" />
</picture>

# entity

**A domain-entity builder for [TypeScript](https://www.typescriptlang.org/), on [zod](https://zod.dev) v4 — branded fields, immutable data, sealed construction, and `Result` instead of throws.**

[![CI](https://github.com/btravstack/entity/actions/workflows/ci.yml/badge.svg)](https://github.com/btravstack/entity/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/%40btravstack%2Fentity.svg?logo=npm)](https://www.npmjs.com/package/@btravstack/entity)
[![npm downloads](https://img.shields.io/npm/dm/%40btravstack%2Fentity.svg)](https://www.npmjs.com/package/@btravstack/entity)
[![TypeScript](https://img.shields.io/badge/TypeScript-7.0-blue?logo=typescript)](https://www.typescriptlang.org/)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](https://opensource.org/licenses/MIT)

[**Documentation**](https://btravstack.github.io/entity/) · [**Getting started**](https://btravstack.github.io/entity/tutorial/getting-started) · [**Reference**](https://btravstack.github.io/entity/reference/declaration) · [**Why entity?**](https://btravstack.github.io/entity/explanation/why-entity)

</div>

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
  {
    id: Entity.field(OrgId, { generated: true, immutable: true }),
    slug: Entity.field(Slug, { immutable: true }),
    name: DisplayName,
    createdAt: Entity.field(Instant, { generated: true, immutable: true }),
  },
  {
    computed: {
      shout: Entity.computed(Upper, (d) => d.name.toUpperCase()),
    },
    invariants: [
      Entity.invariant(
        (d) => d.name.length <= 80,
        "name must be at most 80 characters",
      ),
    ],
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
install all four.
([Why](https://btravstack.github.io/entity/explanation/peer-dependencies).)

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
//    compile error, and rejected at runtime if smuggled past it.
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
| `createInput` | `ZodObject` | create request — `input` minus the `generated` fields                    |
| `updateInput` | `ZodObject` | update request — `output` minus the `immutable` fields, partial          |
| _the class_   | zod schema  | parses to an instance; valid as a field, and anywhere zod takes a schema |

| Entry point                       | Takes                           | For                                        |
| --------------------------------- | ------------------------------- | ------------------------------------------ |
| `SomeEntity.factory(gens)(input)` | caller fields only              | a create use case                          |
| `SomeEntity.make(data)`           | everything `input` describes    | a row, an event fold, an untrusted import  |
| `entity.update(patch)`            | a partial of the mutable fields | an update use case                         |
| `entity.toJSON()`                 | —                               | the stored data, for a write or a response |

| Field flag  | `Entity.field(schema, …)` | Meaning                                          |
| ----------- | ------------------------- | ------------------------------------------------ |
| `generated` | `{ generated: true }`     | the domain supplies this field, never the caller |
| `immutable` | `{ immutable: true }`     | it never changes after creation                  |

| Option       | Meaning                                                                 |
| ------------ | ----------------------------------------------------------------------- |
| `computed`   | fields derived from the declared ones, re-derived on every construction |
| `invariants` | rules built with `Entity.invariant`; any failing rule rejects           |

An entity is **final**. Fields and behaviour shared by several entities go on a
root, `Entity.abstract(name)(fields)`, and extension lives there; a union of
entities is a value you name:

```ts
abstract class AccountBase extends Entity.abstract("Account")({
  id: AccountId,
  label: DisplayName,
}) {
  abstract describe(): string; // every variant owes this — the compiler checks
}

class Personal extends AccountBase.extend("Personal")({
  kind: z.literal("personal"),
}) {
  override describe(): string {
    return `personal ${this.label}`;
  }
}

// `Business` is declared the same way, on the same root
export const Account = Entity.union("kind", [Personal, Business]);
export type Account = Entity.Instance<typeof Account>;

Account.make(row); // Result<Personal | Business, InvalidEntity>
```

The const and the type are one declaration in two halves, and both names are
needed: the const is what you call, the type is `Personal | Business`, so
`P.tag(...)` narrows it. A variant is still a real instance of its root, so
`instanceof` narrows to it too and `AccountBase` stays the annotation for "I
only need the shared behaviour".

There is no class form. Putting the union at a base-class position is `TS2507`
at the declaration, because a class's instance type cannot be a union at all
(`TS2509`).
([Why](https://btravstack.github.io/entity/explanation/unions-and-roots).)

## Documentation

**[btravstack.github.io/entity](https://btravstack.github.io/entity/)** — built
with VitePress from [`docs/`](./docs), and organised by the four
[Diátaxis](https://diataxis.fr/) modes:

- **[Tutorial](https://btravstack.github.io/entity/tutorial/getting-started)** — from nothing to a working entity, one step at a time.
- **How-to guides** — [expose an HTTP contract](https://btravstack.github.io/entity/how-to/http-contract) · [persist and rehydrate](https://btravstack.github.io/entity/how-to/persist-and-rehydrate) · [model an aggregate](https://btravstack.github.io/entity/how-to/model-an-aggregate) · [test domain logic](https://btravstack.github.io/entity/how-to/test-domain-logic)
- **[Reference](https://btravstack.github.io/entity/reference/declaration)** — every member, option and type, with signatures. Plus the [generated API reference](https://btravstack.github.io/entity/api/).
- **[Explanation](https://btravstack.github.io/entity/explanation/why-entity)** — why it is built this way: sealed construction, deep immutability, no I/O, why an entity is final and a union has no class form.

## Development

See [CONTRIBUTING.md](./CONTRIBUTING.md) for the contribution gate, the commit
convention, and how the Node version matrix is chosen.

## License

[MIT](./LICENSE) © Benoit TRAVERS
