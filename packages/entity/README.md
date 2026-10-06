# @btravstack/entity

**A domain-entity builder for [TypeScript](https://www.typescriptlang.org/), on [zod](https://zod.dev) v4 — branded fields, immutable data, sealed construction, and `Result` instead of throws.**

One declaration gives you a type, four derived schemas to build contracts from,
behaviour, and a class that is itself a zod schema — so entities nest inside each other
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
  {
    id: Entity.field(OrgId, { generated: true, immutable: true }),
    slug: Entity.field(Slug, { immutable: true }),
    name: Name,
    createdAt: Entity.field(Instant, { generated: true, immutable: true }),
  },
  {
    computed: {
      shout: Entity.computed(Upper, (d) => d.name.toUpperCase()),
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

| Schema member | For                                                                           |
| ------------- | ----------------------------------------------------------------------------- |
| `input`       | everything `make()` accepts                                                   |
| `output`      | stored state, internal fields included: pick a response from it, by allowlist |
| `createInput` | what the domain lets a create set — `input` minus the `generated` fields      |
| `updateInput` | what the domain lets change — `input` minus the `immutable` fields, partial   |
| _the class_   | parses to an instance; valid as a field                                       |

The four are building blocks, not a public API. A route picks from them by
allowlist, so an internal field stays internal and a new one stays out until
someone adds it: see [Expose an HTTP
contract](https://btravstack.github.io/entity/how-to/http-contract).

`generated`, `immutable`, `identity` and `unbranded` are **flags on the
field**, written with `Entity.field(schema, flags)`; a field carrying none is a
bare schema.
`computed` and `invariants` are the two declaration options.

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

A variant is a real instance of its root, so `instanceof` narrows to it, and
`Account` as a type is `Personal | Business`. There is no class form: putting
the union at a base-class position is `TS2507` at the declaration, because a
class's instance type cannot be a union at all (`TS2509`).

## Aggregates

An aggregate root changes only through events. `Entity.aggregate` declares the
fields, then the events and one handler per event. It has no `update()`: every
command checks its business rules and returns a sealed decision.

```ts
class Subscription extends Entity.aggregate("Subscription")({
  id: Entity.field(SubscriptionId, { identity: true }), // a root needs an identity
  seats: Seats,
  status: z.enum(["ACTIVE", "CANCELLED"]),
})({
  events: SubscriptionEvent, // a zod discriminated union on `type`
  opens: {
    SubscriptionStarted: (e) => ({
      id: e.subscriptionId,
      seats: e.seats,
      status: "ACTIVE",
    }),
  },
  evolve: {
    // one handler per event, or it does not compile
    SeatsChanged: (r, e) => ({ ...r, seats: e.seats }),
    SubscriptionCancelled: (r) => ({ ...r, status: "CANCELLED" }),
  },
}) {
  changeSeats(seats: number) {
    if (this.status === "CANCELLED") return Err(new SubscriptionIsCancelled());
    return this.emit({ type: "SeatsChanged", seats }); // fold, verify once, decide
  }
}

const decision = subscription.changeSeats(5).getOrThrow();
decision.events; // every event since the load
decision.expectedVersion; // the version the store must still be at
repository.save(decision); // a state row and an outbox, or an event stream
```

Only `emit` and `start` build a decision, so a repository is only ever handed
events that were folded and checked against every invariant. Load with
`make(row, { version })` or `replay(stream)`; the same aggregate persists as
state or as events without touching its declaration. Use `Entity` for
everything inside the boundary, and for simple models where a public `update()`
costs nothing. See [Model an event-driven
aggregate](https://btravstack.github.io/entity/how-to/model-an-event-driven-aggregate).

## Documentation

**[btravstack.github.io/entity](https://btravstack.github.io/entity/)**

- [Guarantees and compatibility](https://btravstack.github.io/entity/reference/guarantees) — what is enforced, what is left to you, supported Node/TypeScript/zod versions
- [Compared with zod and Effect](https://btravstack.github.io/entity/explanation/compared) — one model, three ways
- [Getting started](https://btravstack.github.io/entity/tutorial/getting-started) — from nothing to a working entity
- [Reference](https://btravstack.github.io/entity/reference/declaration) — every member, option and type
- [Explanation](https://btravstack.github.io/entity/explanation/why-entity) — why it is built this way
- How-to: [HTTP contract](https://btravstack.github.io/entity/how-to/http-contract) · [persist and rehydrate](https://btravstack.github.io/entity/how-to/persist-and-rehydrate) · [model an aggregate](https://btravstack.github.io/entity/how-to/model-an-aggregate) · [model an event-driven aggregate](https://btravstack.github.io/entity/how-to/model-an-event-driven-aggregate) · [test domain logic](https://btravstack.github.io/entity/how-to/test-domain-logic)

## License

[MIT](./LICENSE) © Benoit TRAVERS
