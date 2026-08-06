---
"@btravstack/entity": minor
---

**BREAKING**: `Entity.create(input, generated)` is replaced by
`Entity.factory(generators).create(input)`.

Generators are bound once where your ports already live, so a create use case
passes only caller input. They are functions, never values, and each is called
once per `create`. `Entity.factoryAsync(generators)` is the promise-returning
variant; its `create` returns an `AsyncResult`, and a generator that rejects
surfaces as a `Defect` rather than an `InvalidEntity`.

Migration:

```ts
// before
Organization.create({ slug, name }, { id: ids.next(), createdAt: clock.now() });

// after
const orgs = Organization.factory({
  id: () => ids.next(),
  createdAt: () => clock.now(),
});
orgs.create({ slug, name });
```
