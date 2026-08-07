---
"@btravstack/entity": minor
---

**BREAKING**: `instance` is removed — the entity class is now itself a zod
schema.

```ts
// before
class Order extends Entity("Order")({ customer: Customer.instance }) {}
z.object({ owner: Organization.instance });
fromSchema(Organization.instance);

// after
class Order extends Entity("Order")({ customer: Customer }) {}
z.object({ owner: Organization });
fromSchema(Organization);
```

The class carries zod's internal slots (`_zod`, `~standard`) but **not** its
methods. That is deliberate: the full `ZodType` surface would put a throwing
`.parse()` on every entity beside the `make` that returns a `Result`. Use
`make` to parse, and zod's function forms to wrap — `z.optional(Organization)`
rather than `Organization.optional()`.

`Entity.union(...)` is a schema on the same terms, so a union composes and
nests identically.

Migration: delete `.instance`. `z.object({ owner: Organization })` now works,
which it never did before.
