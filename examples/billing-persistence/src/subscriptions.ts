/**
 * One aggregate, two persistence styles, and no change to the domain (#158).
 *
 * `Subscription` decides in events: every command returns a `Decision`, the
 * events plus the verified state they produce. A repository chooses which
 * half it stores:
 *
 * - **state-based**: the state's `toJSON()` and a version, with the events
 *   written to an outbox in the same atomic step (#37 does this against a
 *   real database). Loading is `make`.
 * - **event-sourced**: the events, appended to the subscription's stream if it
 *   is still at the version the command read. Loading is `replay`.
 *
 * Both implement one port, and `changeSeats` below runs against either: the
 * switch is infrastructure, not a domain rewrite. Both stores are in memory
 * and round-trip through JSON, so what comes back is genuinely stored data.
 */
import type { Entity } from "@btravstack/entity";
import {
  Subscription,
  type SeatsUnchanged,
  type SubscriptionEvent,
  type SubscriptionIsCancelled,
} from "@btravstack/entity-example-billing-domain/subscription";
import { Err, Ok, TaggedError, type Result } from "unthrown";

type Decision = Entity.Decision<Subscription, SubscriptionEvent>;

export class SubscriptionNotFound extends TaggedError("SubscriptionNotFound")<{ id: string }> {
  override message = `no subscription ${this.id}`;
}

/** Someone saved since this command loaded: retry from a fresh load, never overwrite. */
export class ConcurrentModification extends TaggedError("ConcurrentModification")<{
  id: string;
  expected: number;
}> {
  override message = `subscription ${this.id} changed since version ${this.expected}`;
}

/** A loaded aggregate and the version a save must still find. */
export type Loaded = { readonly subscription: Subscription; readonly version: number };

export type SubscriptionRepository = {
  load(id: string): Result<Loaded, SubscriptionNotFound | Entity.InvalidEntity>;
  /** `expected` is the version the command read; `0` for a new subscription. Returns the new version. */
  save(decision: Decision, expected: number): Result<number, ConcurrentModification>;
};

const stored = <T>(value: T): unknown => JSON.parse(JSON.stringify(value));

/** The state's row and a version; the decision's events go to the outbox in the same step. */
export class StateBasedSubscriptions implements SubscriptionRepository {
  readonly #rows = new Map<string, { state: unknown; version: number }>();
  readonly outbox: unknown[] = [];

  load(id: string): Result<Loaded, SubscriptionNotFound | Entity.InvalidEntity> {
    const row = this.#rows.get(id);
    if (row === undefined) return Err(new SubscriptionNotFound({ id }));
    return Subscription.make(row.state).map((subscription) => ({
      subscription,
      version: row.version,
    }));
  }

  save(decision: Decision, expected: number): Result<number, ConcurrentModification> {
    const { id } = decision.state;
    const current = this.#rows.get(id)?.version ?? 0;
    if (current !== expected) return Err(new ConcurrentModification({ id, expected }));
    // One synchronous block stands in for one transaction: the row and the
    // outbox move together or not at all.
    const version = current + 1;
    this.#rows.set(id, { state: stored(decision.state.toJSON()), version });
    this.outbox.push(...decision.events.map((event) => stored({ aggregateId: id, event })));
    return Ok(version);
  }
}

/** The decision's events, appended to the stream; the stream's length is its version. */
export class EventSourcedSubscriptions implements SubscriptionRepository {
  readonly #streams = new Map<string, unknown[]>();

  load(id: string): Result<Loaded, SubscriptionNotFound | Entity.InvalidEntity> {
    const stream = this.#streams.get(id);
    if (stream === undefined) return Err(new SubscriptionNotFound({ id }));
    return Subscription.replay(stream).map((subscription) => ({
      subscription,
      version: stream.length,
    }));
  }

  save(decision: Decision, expected: number): Result<number, ConcurrentModification> {
    const { id } = decision.state;
    const stream = this.#streams.get(id) ?? [];
    if (stream.length !== expected) return Err(new ConcurrentModification({ id, expected }));
    const next = [...stream, ...decision.events.map(stored)];
    this.#streams.set(id, next);
    return Ok(next.length);
  }
}

/** A use case, written once against the port: load, decide, save. */
export const changeSeats =
  (repository: SubscriptionRepository) =>
  (
    id: string,
    seats: number,
  ): Result<
    number,
    | SubscriptionNotFound
    | Entity.InvalidEntity
    | SubscriptionIsCancelled
    | SeatsUnchanged
    | ConcurrentModification
  > =>
    repository
      .load(id)
      .flatMap(({ subscription, version }) =>
        subscription.changeSeats(seats).flatMap((decision) => repository.save(decision, version)),
      );
