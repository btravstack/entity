---
"@btravstack/entity": minor
---

`Entity.aggregate(tag)(fields)(options)` declares an aggregate root whose state
changes only through events. The options declare the `events` (a zod
discriminated union on `type`), an `opens` handler per creation event and an
`evolve` handler per other event; omitting one is a compile error.

- An aggregate has no `update()` and no factories. A command checks its
  business rules and calls `this.emit(...events)`, which parses the events,
  folds them, verifies the result with one `make`, and returns a sealed
  `Entity.Decision`: the events and the verified state. Only `emit` and
  `start` can build one, and events that break an invariant are a defect.
- `SomeAggregate.start(event)` creates from a creation event.
  `SomeAggregate.replay(events)` parses and folds a stored stream; `make`
  still rehydrates a snapshot or a state row. Neither emits events.
- The same aggregate persists as state plus an outbox or as an event stream
  without changing its declaration.

`Entity` keeps its API. Four new top-level declaration-emit names:
`AggregateStatic`, `AggregateInstance`, `Decision`, `DecisionKey`, plus
`Entity.Decision`, `Entity.Event` and `Entity.Aggregate` in the namespace.
