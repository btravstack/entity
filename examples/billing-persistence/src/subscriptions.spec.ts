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
    expect(repo.save(started, 0)).toBeOkWith(1);

    expect(changeSeats(repo)(started.state.id, 5)).toBeOk();

    const { subscription, version } = repo.load(started.state.id).getOrThrow();
    expect(subscription.seats).toBe(5);
    expect(subscription.sameIdentityAs(started.state)).toBe(true);
    expect(version).toBe(2);
  });

  test(`${style}: two saves from the same version, one wins and one is a conflict`, () => {
    const repo = repository();
    const started = startSubscription(organizationId, 3).get();
    repo.save(started, 0).getOrThrow();

    const mine = repo.load(started.state.id).getOrThrow();
    const theirs = repo.load(started.state.id).getOrThrow();

    const a = mine.subscription.changeSeats(4).getOrThrow();
    const b = theirs.subscription.changeSeats(6).getOrThrow();
    expect(repo.save(a, mine.version)).toBeOkWith(2);
    expect(repo.save(b, theirs.version)).toBeErrTagged("ConcurrentModification");
  });

  test(`${style}: a refused command saves nothing`, () => {
    const repo = repository();
    const started = startSubscription(organizationId, 3).get();
    repo.save(started, 0).getOrThrow();

    expect(changeSeats(repo)(started.state.id, 3)).toBeErrTagged("SeatsUnchanged");
    expect(repo.load(started.state.id).getOrThrow().version).toBe(1);
  });
}

test("state-based: the decision's events reach the outbox with the state", () => {
  const repo = new StateBasedSubscriptions();
  const started = startSubscription(organizationId, 3).get();
  repo.save(started, 0).getOrThrow();
  changeSeats(repo)(started.state.id, 5).getOrThrow();

  expect(repo.outbox.map((row) => (row as { event: { type: string } }).event.type)).toEqual([
    "SubscriptionStarted",
    "SeatsChanged",
  ]);
});

test("event-sourced and state-based stores agree on the state, from the same decisions", () => {
  const states = new StateBasedSubscriptions();
  const events = new EventSourcedSubscriptions();
  const started = startSubscription(organizationId, 3).get();
  const cancelled = started.state.cancel("2026-10-06T09:00:00.000Z").getOrThrow();
  for (const repo of [states, events]) {
    repo.save(started, 0).getOrThrow();
    repo.save(cancelled, 1).getOrThrow();
  }

  const fromRow = states.load(started.state.id).getOrThrow().subscription;
  const fromStream = events.load(started.state.id).getOrThrow().subscription;
  expect(fromStream.toJSON()).toEqual(fromRow.toJSON());
  expect(fromStream.status).toBe("CANCELLED");
});
