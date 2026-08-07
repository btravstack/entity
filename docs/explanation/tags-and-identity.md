---
title: Tags and identity
description: Why every instance carries a runtime _tag that never reaches the wire, and why a serialisable union must discriminate on a domain field instead.
---

# Tags and identity

Every instance carries a non-enumerable `_tag`, for pattern matching with
`unthrown`'s `P.tag(...)`:

```ts
match(member)
  .with(P.tag("User"), (u) => u.email)
  .with(P.tag("ServiceAccount"), (s) => s.label)
  .exhaustive();
```

It never reaches the wire — absent from every schema, from `toJSON()`,
`JSON.stringify`, `Object.keys` and spread. That has a direct consequence: a
union that must survive a JSON round trip **cannot** discriminate on `_tag`,
because it is not there after serialisation. Declare the discriminant as an
ordinary domain field; [`Entity.union`](/reference/declaration#entity-union-discriminant-members)
takes that field.

The two are not redundant. A brand is per-field and type-only; the tag is
per-entity and runtime-present, which is what makes it matchable. `entityName`
is the same string read from the class rather than an instance — the only path
for code holding the class and no instance.

[Model an aggregate](/how-to/model-an-aggregate#model-a-union-of-entities)
declares such a union against a real payload.
