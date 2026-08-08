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

`zod`, `unthrown` and `@unthrown/standard-schema` are peer dependencies. The
zod range is `^4.3.0` — the floor is measured, not guessed: the full surface
typechecks, emits declarations and passes its runtime assertions on 4.3.0.
Nothing here needs a later minor, and monorepos commonly pin one zod across
every package, so the range is kept as wide as it is true.

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

| Schema member | For                                                                 |
| ------------- | ------------------------------------------------------------------- |
| `input`       | everything `make()` accepts                                         |
| `output`      | stored state and response body                                      |
| `createInput` | create request — `input` minus `generated`                          |
| `updateInput` | update request — `output` minus `immutable` and `computed`, partial |
| _the class_   | parses to an instance; valid as a field                             |

An entity is **final**. Fields and behaviour shared by several entities go on a
root, `Entity.abstract(name)(fields)`, and extension lives there; a union of
entities is declared as a class:

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
class Account extends Entity.union("kind", [Personal, Business]) {}

Account.make(row); // Result<Personal | Business, InvalidEntity>
```

## Documentation

**[btravstack.github.io/entity](https://btravstack.github.io/entity/)**

- [Getting started](https://btravstack.github.io/entity/tutorial/getting-started) — from nothing to a working entity
- [Reference](https://btravstack.github.io/entity/reference/declaration) — every member, option and type
- [Explanation](https://btravstack.github.io/entity/explanation/why-entity) — why it is built this way
- How-to: [HTTP contract](https://btravstack.github.io/entity/how-to/http-contract) · [persist and rehydrate](https://btravstack.github.io/entity/how-to/persist-and-rehydrate) · [model an aggregate](https://btravstack.github.io/entity/how-to/model-an-aggregate) · [test domain logic](https://btravstack.github.io/entity/how-to/test-domain-logic)

## License

[MIT](./LICENSE) © Benoit TRAVERS
