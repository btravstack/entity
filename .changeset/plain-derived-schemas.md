---
"@btravstack/entity": minor
---

**Breaking:** `input`, `output`, `createInput` and `updateInput` are plain all
the way down, so an entity with a nested-entity field converts to JSON Schema
(#72).

- A field holding another entity, an array of entities, an optional or
  nullable one, or an `Entity.union(...)` now embeds the nested entity's own
  plain schema in each member: its `input` in `input`, `createInput` and
  `updateInput`, its `output` (computed fields included) in `output`. A union
  becomes a discriminated union of its members' plain schemas. Every member
  converts with `z.toJSONSchema` in both directions, at any depth; before, all
  of them threw.
- `make`, `update` and the factories are unchanged: they parse through an
  internal schema that keeps the classes, so a nested field still holds a real
  instance.
- `updateInput` is now derived from `input` rather than `output`. Its keys are
  the same; only a nested entity's schema differs.
- An `Entity.union(...)` value's `input` and `output` are typed from its
  members' schemas instead of `z.ZodType<unknown>`.

To migrate: parsing with a member now yields plain data at every depth, so
`Order.output.parse(x).lines[0]` is an object, not an `OrderLine`. Code that
relied on a member to construct nested instances should call `make` instead,
which is the entry point for building entities. Types follow suit:
`z.output<typeof Order.output>` describes plain nested data, while
`Entity.Output<typeof Order>` and the instance types still carry the nested
entities.
