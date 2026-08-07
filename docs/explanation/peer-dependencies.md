---
title: Peer dependencies
description: Why zod, unthrown and @unthrown/standard-schema are peers rather than bundled dependencies.
---

# Peer dependencies

`zod`, `unthrown` and `@unthrown/standard-schema` are peer dependencies, not
bundled ones. The package hands back real `ZodObject`s and real `Result`s built
from _your_ copies. If it pinned its own, a consumer would end up with two
copies of zod in the tree, and identity checks — `result instanceof Result`,
`schema instanceof z.ZodType`, or composing an entity into your own
`z.object({...})` — can silently misbehave across the boundary between two
copies of the same package.

So all four are installed together:

```sh
pnpm add @btravstack/entity zod unthrown @unthrown/standard-schema
```
