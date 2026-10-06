/**
 * An aggregate root whose state changes only through events (#158).
 *
 * `Entity.aggregate` declares the fields, the events, and one handler per
 * event: `opens` for the event that creates a subscription, `evolve` for every
 * other one. There is no `update()`. A command checks its business rules,
 * then calls `this.emit(...)`, which folds the events onto the current state,
 * verifies the result with `make`, and returns a sealed `Decision`: the events
 * and the state they produce, together.
 *
 * Nothing here knows how a subscription is stored. `examples/billing-persistence`
 * saves the same decisions twice over, once as state rows plus an outbox and
 * once as an event stream, without a line of this file changing.
 */
import { Entity } from "@btravstack/entity";
import { Err, TaggedError, type Result } from "unthrown";
import { z } from "zod";

import { Instant, OrganizationId } from "./vocabulary.js";

export const SubscriptionId = z.uuid().brand("SubscriptionId");
export const Seats = z.number().int().positive().brand("Seats");

/**
 * Every event a subscription can produce. Events are messages, so they carry
 * plain values; the aggregate's own fields are where the brands live.
 */
export const SubscriptionEvent = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("SubscriptionStarted"),
    subscriptionId: z.uuid(),
    organizationId: z.uuid(),
    seats: z.number().int().positive(),
  }),
  z.object({ type: z.literal("SeatsChanged"), seats: z.number().int().positive() }),
  z.object({ type: z.literal("SubscriptionCancelled"), at: z.iso.datetime() }),
]);
export type SubscriptionEvent = z.output<typeof SubscriptionEvent>;

export class SubscriptionIsCancelled extends TaggedError("SubscriptionIsCancelled")<{
  subscriptionId: string;
}> {
  override message = `subscription ${this.subscriptionId} is cancelled`;
}

export class SeatsUnchanged extends TaggedError("SeatsUnchanged")<{ seats: number }> {
  override message = `the subscription already has ${this.seats} seats`;
}

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
      ensure: (d) => (d.status === "CANCELLED") === (d.cancelledAt !== undefined),
      message: "a cancelled subscription, and only a cancelled one, records when it ended",
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
    SubscriptionCancelled: (r, e) => ({ ...r, status: "CANCELLED", cancelledAt: e.at }),
  },
}) {
  changeSeats(
    seats: number,
  ): Result<
    Entity.Decision<Subscription, SubscriptionEvent>,
    SubscriptionIsCancelled | SeatsUnchanged
  > {
    if (this.status === "CANCELLED") {
      return Err(new SubscriptionIsCancelled({ subscriptionId: this.id }));
    }
    if (seats === this.seats) return Err(new SeatsUnchanged({ seats }));
    return this.emit({ type: "SeatsChanged", seats });
  }

  cancel(
    at: string,
  ): Result<Entity.Decision<Subscription, SubscriptionEvent>, SubscriptionIsCancelled> {
    if (this.status === "CANCELLED") {
      return Err(new SubscriptionIsCancelled({ subscriptionId: this.id }));
    }
    return this.emit({ type: "SubscriptionCancelled", at });
  }
}

/** The creation command. The id travels in the opening event, so it is generated here. */
export const startSubscription = (
  organizationId: string,
  seats: number,
): Result<Entity.Decision<Subscription, SubscriptionEvent>, never> =>
  Subscription.start({
    type: "SubscriptionStarted",
    subscriptionId: crypto.randomUUID(),
    organizationId,
    seats,
  });
