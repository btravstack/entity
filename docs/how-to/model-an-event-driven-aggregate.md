---
title: Model an event-driven aggregate
description: Declare an aggregate root whose state changes only through events, return sealed decisions from its commands, and persist the same aggregate as state rows or as an event stream without touching the domain.
---

# Model an event-driven aggregate

**Problem:** an aggregate root should change only through its commands, each
command should say what happened, and the events it reports must describe the
state it returns. With an ordinary entity, `update()` is public, so any caller
can skip a command, and nothing ties the events a method returns to the state
it returns. You also want to choose between storing state and storing events
without rewriting the domain.

`Entity.aggregate` is an entity with no `update()`: its state changes only
through declared events, and every command returns a sealed `Decision`.

> Snippets below assume these imports:
>
> ```ts
> import { z } from "zod";
> import { Err, TaggedError, type Result } from "unthrown";
> import { Entity } from "@btravstack/entity";
> ```
>
> They follow `Subscription` in the
> [billing domain example](/examples/billing-domain), and the two repositories
> in the [persistence example](/examples/billing-persistence). Every snippet
> compiles there and is covered by a test.

## Declare the events

The events are one zod discriminated union on `type`. They are messages, so
they carry plain values; the aggregate's fields are where the brands live.

```ts
export const SubscriptionEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("SubscriptionStarted"),
    subscriptionId: z.uuid(),
    organizationId: z.uuid(),
    seats: z.number().int().positive(),
  }),
  z.object({
    type: z.literal("SeatsChanged"),
    seats: z.number().int().positive(),
  }),
  z.object({ type: z.literal("SubscriptionCancelled"), at: z.iso.datetime() }),
]);
export type SubscriptionEvent = z.output<typeof SubscriptionEvent>;
```

## Declare the aggregate: fields, then handlers

After the tag, the fields come in their own call, and the handlers in the next
one:

```ts
export class Subscription extends Entity.aggregate("Subscription")({
  id: Entity.field(SubscriptionId, { identity: true }),
  organizationId: Entity.field(OrganizationId, { immutable: true }),
  seats: Seats,
  status: z.enum(["ACTIVE", "CANCELLED"]),
  cancelledAt: Instant.optional(),
})({
  events: SubscriptionEvent,
  invariants: [
    Entity.invariant({
      code: "CANCELLATION_WITHOUT_DATE",
      ensure: (d) =>
        (d.status === "CANCELLED") === (d.cancelledAt !== undefined),
      message:
        "a cancelled subscription, and only a cancelled one, records when it ended",
    }),
  ],
  opens: {
    SubscriptionStarted: (e) => ({
      id: e.subscriptionId,
      organizationId: e.organizationId,
      seats: e.seats,
      status: "ACTIVE",
    }),
  },
  evolve: {
    SeatsChanged: (r, e) => ({ ...r, seats: e.seats }),
    SubscriptionCancelled: (r, e) => ({
      ...r,
      status: "CANCELLED",
      cancelledAt: e.at,
    }),
  },
}) {}
```

- `opens` maps each **creation** event to the first record.
- `evolve` maps **every other** event to a function from the current record to
  the next. Leave one out and the declaration does not compile; put a creation
  event in it and it does not compile either.
- A handler works on a plain, unbranded record, because nothing has validated
  it yet. One `make` at the end of a fold is what turns the record into a
  `Subscription`.

Keeping fields and handlers in separate calls is what keeps that record exact. With the fields fixed first, a
handler returning `status: "ACTIVE"` is checked against the enum, and a
missing field is a compile error rather than a surprise at runtime.

`invariants`, `computed` and the `identity` and `immutable` flags work as on any
entity. What an aggregate does not have is `update`, the factories,
`createInput` and `updateInput`.

## Decide with emit

A command checks its business rules, then emits:

```ts
changeSeats(seats: number): Result<
  Entity.Decision<Subscription, SubscriptionEvent>,
  SubscriptionIsCancelled | SeatsUnchanged
> {
  if (this.status === "CANCELLED") {
    return Err(new SubscriptionIsCancelled({ subscriptionId: this.id }));
  }
  if (seats === this.seats) return Err(new SeatsUnchanged({ seats }));
  return this.emit({ type: "SeatsChanged", seats });
}
```

`emit` parses each event against the declared union, folds the events onto the
current state with the handlers, and verifies the result with `make`. It
returns a `Decision`: the events, and the state they produce. That state is
the instance the verification built, and it is what gets persisted.

`emit` accepts every declared event except the creation events: an aggregate
that exists cannot be created again, so `subscription.emit({ type:
"SubscriptionStarted", … })` does not compile.

Only `emit` and `start` can build a `Decision`. A hand-written
`{ state, events }` does not compile, so a repository that takes a `Decision`
can only be handed events that were folded and checked.

What `emit` treats as a bug, it returns as a **defect**, not an error: an event
that breaks an invariant, an event that fails its own schema, or a handler that
throws. Each one means the command decided something that cannot hold, which
is a defect to fix rather than an outcome to show the caller. Check business
rules before emitting, and return a typed error when one fails, as
`changeSeats` does.

## Create with start

Creation is `start`, which only accepts a creation event:

```ts
export const startSubscription = (organizationId: string, seats: number) =>
  Subscription.start({
    type: "SubscriptionStarted",
    subscriptionId: crypto.randomUUID(),
    organizationId,
    seats,
  });
```

The id travels in the opening event, so the command generates it. There is no
factory: an aggregate is created by an event, like everything else that happens
to it.

## Persist the state, or the events

A decision holds both halves, so the repository picks one. The domain code
above does not change.

**State-based.** Store `decision.state.toJSON()` with a version, and write
`decision.events` to an outbox in the same transaction. Load with `make`.

```ts
save(decision: Decision, expected: number): Result<number, ConcurrentModification> {
  const { id } = decision.state;
  const current = this.#rows.get(id)?.version ?? 0;
  if (current !== expected) return Err(new ConcurrentModification({ id, expected }));
  this.#rows.set(id, { state: decision.state.toJSON(), version: current + 1 });
  this.outbox.push(...decision.events);
  return Ok(current + 1);
}
```

**Event-sourced.** Append `decision.events` to the stream if it is still at the
version the command read. Load with `replay`.

```ts
load(id: string) {
  const stream = this.#streams.get(id);
  if (stream === undefined) return Err(new SubscriptionNotFound({ id }));
  return Subscription.replay(stream).map((subscription) => ({
    subscription,
    version: stream.length,
  }));
}
```

A use case written against the port runs on either:

```ts
export const changeSeats =
  (repository: SubscriptionRepository) => (id: string, seats: number) =>
    repository
      .load(id)
      .flatMap(({ subscription, version }) =>
        subscription
          .changeSeats(seats)
          .flatMap((decision) => repository.save(decision, version)),
      );
```

Version checks, the outbox and the event store all stay in the adapter: the
aggregate does no I/O. [Persist an aggregate relationally](/how-to/persist-relationally)
does the state-based half against a real database.

## Rehydrate without emitting

`make` (a snapshot or a state row) and `replay` (a stream) both return an
aggregate and emit nothing.

`replay` treats a stored stream as untrusted input, the way `make` treats a
row: every event is parsed against the declared union, and a bad one is an
`InvalidEntity` whose issue path starts with the event's index. The stream must
start with a creation event, and a creation event later in the stream is
refused.

`replay` is strict. Its last step is `make`, so a stream that breaks a rule
added since it was written is an `InvalidEntity`, just as an old row would be,
and it hits harder: every command on that aggregate re-folds the stream.
Upcast old event versions in the adapter before `replay`, and keep a rule that
only governs new transitions in the command rather than in `invariants`.
[Add a stricter rule without an outage](/how-to/add-a-stricter-rule) covers
both.

## Choose between an entity and an aggregate

Use `Entity.aggregate` for a root whose changes are worth naming, and whose
state other code should not patch directly. Use `Entity` for everything inside
the boundary (an order's lines, a value-like record) and for simple models
where a public `update` costs nothing. An aggregate cannot be nested as another
entity's field: a root is referenced by id, never embedded.

[Write commands and events](/how-to/write-commands) shows the same commands on
an ordinary entity, where the pattern is a convention rather than a guarantee.
