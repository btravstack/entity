---
title: No I/O, by design
description: Why the package reads no clock and generates no id, and why generators are functions bound at the composition root.
---

# No I/O, by design

The package reads no clock and generates no id. A factory's generators, not an
internal `crypto.randomUUID()`/`Date.now()`, are how a domain-generated value
reaches an entity.

The _rule_ — which fields the domain owns, and that a caller may never supply
them — lives in the declaration. The _sources_ are bound once at your
composition root. That keeps the entity pure, and lets a test bind fixed
generators instead of stubbing globals.

Generators are functions, called once per create, so a factory built at startup
still yields a fresh id per entity.

```ts
// composition root
const createOrganization = Organization.factory({
  id: () => ids.next(),
  createdAt: () => clock.now(),
});

// a test — no global stubbing, no fake timers
const createFixed = Organization.factory({
  id: () => FIXED_ID,
  createdAt: () => FIXED_INSTANT,
});
```

See [`factory` / `factoryAsync`](/reference/entry-points) for the signatures, and
[Test domain logic](/how-to/test-domain-logic#bind-fixed-generators-instead-of-stubbing-globals)
for the testing pattern this enables.
