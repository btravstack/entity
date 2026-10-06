import { startSubscription } from "@btravstack/entity-example-billing-domain/subscription";
import { expect, test } from "vitest";

import {
  EventSourcedSubscriptions,
  StateBasedSubscriptions,
  changeSeats,
  type SubscriptionRepository,
} from "./subscriptions.js";

const organizationId = "0199b1f4-1b1e-7000-8000-0000000000aa";

/** The same scenarios, run against each persistence style. */
const styles: readonly (readonly [string, () => SubscriptionRepository])[] = [
  ["state-based", () => new StateBasedSubscriptions()],
  ["event-sourced", () => new EventSourcedSubscriptions()],
];

for (const [style, repository] of styles) {
  test(`${style}: a started, changed subscription loads back in the state it was decided in`, () => {
    const repo = repository();
    const started = startSubscription(organizationId, 3).get();
    expect(repo.save(started)).toBeOk();

    expect(changeSeats(repo)(started.state.id, 5)).toBeOk();

    const subscription = repo.load(started.state.id).getOrThrow();
    expect(subscription.seats).toBe(5);
    expect(subscription.sameIdentityAs(started.state)).toBe(true);
  });

  test(`${style}: two saves from the same load, one wins and one is a conflict`, () => {
    const repo = repository();
    const started = startSubscription(organizationId, 3).get();
    repo.save(started).getOrThrow();

    const mine = repo.load(started.state.id).getOrThrow();
    const theirs = repo.load(started.state.id).getOrThrow();

    expect(repo.save(mine.changeSeats(4).getOrThrow())).toBeOk();
    expect(repo.save(theirs.changeSeats(6).getOrThrow())).toBeErrTagged("ConcurrentModification");
  });

  test(`${style}: a refused command saves nothing`, () => {
    const repo = repository();
    const started = startSubscription(organizationId, 3).get();
    repo.save(started).getOrThrow();

    expect(changeSeats(repo)(started.state.id, 3)).toBeErrTagged("SeatsUnchanged");
    expect(repo.load(started.state.id).getOrThrow().seats).toBe(3);
  });

  test(`${style}: chained commands save as one decision, losing none of their events`, () => {
    const repo = repository();
    // start, change and cancel before anything is stored: the last decision holds all three
    const decision = startSubscription(organizationId, 3)
      .get()
      .state.changeSeats(5)
      .getOrThrow()
      .state.cancel("2026-10-06T09:00:00.000Z")
      .getOrThrow();
    expect(decision.events.map((e) => e.type)).toEqual([
      "SubscriptionStarted",
      "SeatsChanged",
      "SubscriptionCancelled",
    ]);
    repo.save(decision).getOrThrow();

    const reloaded = repo.load(decision.state.id).getOrThrow();
    expect(reloaded.seats).toBe(5);
    expect(reloaded.status).toBe("CANCELLED");
  });

  test(`${style}: deciding again from an already-saved state is a conflict, never an overwrite`, () => {
    const repo = repository();
    const started = startSubscription(organizationId, 3).get();
    repo.save(started).getOrThrow();
    // `started.state` still says "nothing stored yet": a reload is the way forward
    expect(repo.save(started.state.changeSeats(4).getOrThrow())).toBeErrTagged(
      "ConcurrentModification",
    );
  });
}

test("state-based: the decision's events reach the outbox with the state", () => {
  const repo = new StateBasedSubscriptions();
  const started = startSubscription(organizationId, 3).get();
  repo.save(started).getOrThrow();
  changeSeats(repo)(started.state.id, 5).getOrThrow();

  expect(repo.outbox.map((row) => (row as { event: { type: string } }).event.type)).toEqual([
    "SubscriptionStarted",
    "SeatsChanged",
  ]);
});

test("event-sourced and state-based stores agree on the state, from the same decision", () => {
  const states = new StateBasedSubscriptions();
  const events = new EventSourcedSubscriptions();
  const cancelled = startSubscription(organizationId, 3)
    .get()
    .state.cancel("2026-10-06T09:00:00.000Z")
    .getOrThrow();
  states.save(cancelled).getOrThrow();
  events.save(cancelled).getOrThrow();

  const fromRow = states.load(cancelled.state.id).getOrThrow();
  const fromStream = events.load(cancelled.state.id).getOrThrow();
  expect(fromStream.toJSON()).toEqual(fromRow.toJSON());
  expect(fromStream.status).toBe("CANCELLED");
});
