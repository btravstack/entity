---
title: Tags and identity
description: Why every instance carries a runtime _tag that never reaches the wire, why a serialisable union must discriminate on a domain field instead, and the four different things "the same" can mean.
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

## Four kinds of sameness

"Are these the same?" has four different answers, and the package keeps them
apart:

| Question                        | Answered by                                       |
| ------------------------------- | ------------------------------------------------- |
| the same kind of entity?        | the runtime `_tag`, or `instanceof`               |
| the same object in memory?      | `a === b`                                         |
| the same business entity?       | `a.sameIdentityAs(b)`, over the `identity` fields |
| the same state, field by field? | your deep-equality function over `toJSON()`       |

In domain-driven design an entity _is_ its identity: rename an organization and
it is still that organization, so the question code usually means is the third
one. That is the only comparison the package provides.

```ts
class Organization extends Entity("Organization")({
  id: Entity.field(OrgId, { identity: true, generated: true }),
  name: DisplayName,
}) {}

renamed.sameIdentityAs(org); // true: same id
```

Identity has a scope, and the scope is wherever it is declared. Flagged on a
plain entity, it belongs to that entity, so an invoice and a customer that
happen to share an id string are never the same. Flagged on an abstract root,
it belongs to the root, so every variant shares it. That is what a lifecycle
needs: a draft and the published document it became are one entity in two
states.

```ts
const DocumentBase = Entity.abstract("Document")({
  id: Entity.field(DocumentId, { identity: true }),
  title: Title,
});
class Draft extends DocumentBase.extend("Draft")({
  status: z.literal("DRAFT"),
}) {}
class Published extends DocumentBase.extend("Published")({
  status: z.literal("PUBLISHED"),
}) {}

draft.sameIdentityAs(published); // true when the ids match
```

When the variants of one root are genuinely different entities, such as an
invoice and a credit note, flag the id on each variant instead of on the root.
Each variant is then its own scope.

The fourth question, the same state, has no method. It used to be `equals`,
which compared whole stored states with `node:util`'s `isDeepStrictEqual`. It
answered a question entity code rarely asks under a name that suggests the
DDD one, and it was the package's only Node import. Comparing two states is
one line over `toJSON()` in the code that wants it.
