# API reference

Generated from the source with [TypeDoc](https://typedoc.org/) — every exported
symbol, with its signature and TSDoc.

- **[`@btravstack/entity`](/api/entity/)** — `Entity`, the merged `Entity`
  namespace, and the three seal names (`BaseInstance`, `ConstructionKey`,
  `Sealed`) the published declarations force out.

::: tip Looking for prose?
The generated pages document _signatures_. For what each member is **for**, with
worked examples, read the hand-written [Reference](/reference/declaration); for
_why_ the surface is shaped this way, read the
[Explanation](/explanation/why-entity).
:::

## The shape of the surface

`index.ts` exports exactly one name you write against:

```ts
import { Entity } from "@btravstack/entity";
```

`Entity.computed`, `Entity.invariant`, `Entity.union` and `Entity.InvalidEntity`
hang off it as values, and every public type lives in a merged
`declare namespace Entity`. A bare `computed` or `union` would be too generic to
take from a consumer's import scope, so nothing else is exported — with one
measured exception, [`BaseInstance` / `ConstructionKey` /
`Sealed`](/reference/types#the-seal-names).
