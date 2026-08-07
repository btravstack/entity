# @btravstack/entity

**A domain-entity builder for [TypeScript](https://www.typescriptlang.org/), on [zod](https://zod.dev) v4 — branded fields, immutable data, sealed construction, and `Result` instead of throws.**

One declaration gives you a type, four request/response schemas, behaviour, and
a class that is itself a zod schema — so entities nest inside each other
without losing what makes them entities. Nothing throws: every fallible
operation returns an [`unthrown`](https://github.com/btravstack/unthrown)
`Result`.

```sh
pnpm add @btravstack/entity zod unthrown @unthrown/standard-schema
```

`zod`, `unthrown` and `@unthrown/standard-schema` are peer dependencies.

```ts
import { z } from "zod";
import { Entity } from "@btravstack/entity";

const OrgId = z.uuid().brand("OrgId");
const Slug = z.string().min(1).brand("Slug");
const Name = z.string().min(1).brand("Name");
const Instant = z.iso.datetime().brand("Instant");
const Upper = z.string().min(1).brand("Upper");

class Organization extends Entity("Organization")(
  { id: OrgId, slug: Slug, name: Name, createdAt: Instant },
  {
    generated: ["id", "createdAt"],
    immutable: ["id", "createdAt", "slug"],
    computed: {
      shout: Entity.computed(
        Upper,
        (d) => d.name.toUpperCase() as z.infer<typeof Upper>,
      ),
    },
  },
) {
  get greeting(): string {
    return `Welcome, ${this.name}`;
  }
}

// Bind the effect sources once, at your composition root.
const createOrganization = Organization.factory({
  id: () => ids.next(),
  createdAt: () => clock.now(),
});

const org = createOrganization({ slug, name }).getOrThrow();
await db.insert(org.toJSON()); // the stored shape — never `_tag`
const loaded = Organization.make(row).getOrThrow(); // rows, imports, event folds
const renamed = loaded.update({ name: next }).getOrThrow(); // a NEW entity
```

| Schema member | For                                                  |
| ------------- | ---------------------------------------------------- |
| `input`       | everything `make()` accepts                          |
| `output`      | stored state and response body                       |
| `createInput` | create request — `input` minus `generated`           |
| `updateInput` | update request — `output` minus `immutable`, partial |
| _the class_   | parses to an instance; valid as a field              |

Also `Entity.union(...)` for a union that is itself entity-like, and
`SomeEntity.extend(tag)(fields)` to build a new entity from an existing one.

## Documentation

Full docs live in the repository:

- [Reference](https://github.com/btravstack/entity/blob/main/docs/reference.md) — every member, option and type
- [Explanation](https://github.com/btravstack/entity/blob/main/docs/explanation.md) — why it is built this way
- How-to: [HTTP contract](https://github.com/btravstack/entity/blob/main/docs/how-to/http-contract.md) · [persist and rehydrate](https://github.com/btravstack/entity/blob/main/docs/how-to/persist-and-rehydrate.md) · [model an aggregate](https://github.com/btravstack/entity/blob/main/docs/how-to/model-an-aggregate.md) · [test domain logic](https://github.com/btravstack/entity/blob/main/docs/how-to/test-domain-logic.md)

## License

[MIT](./LICENSE) © Benoit TRAVERS
