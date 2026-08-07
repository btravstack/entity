---
"@btravstack/entity": minor
---

**BREAKING**: a factory is a function, not an object with `.create`.

```ts
// before
const orgs = Organization.factory({
  id: () => ids.next(),
  createdAt: () => clock.now(),
});
orgs.create({ slug, name });

// after
const createOrg = Organization.factory({
  id: () => ids.next(),
  createdAt: () => clock.now(),
});
createOrg({ slug, name });
```

Nothing but `create` ever consumed the generators, so the object around it was
ceremony. `factoryAsync` changes the same way.

Migration: drop `.create`.
