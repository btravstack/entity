import type { Entity } from "@btravstack/entity";
import { DisplayName, Slug } from "@btravstack/entity-example-billing-domain";
import type { Organization } from "@btravstack/entity-example-billing-domain";
import { P, type AsyncResult } from "unthrown";
import { expect, test } from "vitest";

import {
  InMemoryOrganizationStore,
  registerOrganization,
  type OrganizationStore,
  type SlugTaken,
} from "./uniqueness.js";

const acme = (name = "Acme SA") => ({ slug: Slug.parse("acme"), name: DisplayName.parse(name) });

/** The HTTP edge: three channels, three different answers. */
const status = (result: AsyncResult<Organization, Entity.InvalidEntity | SlugTaken>) =>
  result.match({
    ok: () => 201,
    errCases: (m) => m.with(P.tag("InvalidEntity"), () => 422).with(P.tag("SlugTaken"), () => 409),
    defect: () => 503,
  });

/**
 * Holds every insert until both requests have done their lookup — the
 * interleaving a loaded server produces by accident, produced on purpose so
 * the test does not depend on scheduling luck.
 */
const racing = (store: OrganizationStore) => {
  const answers: boolean[] = [];
  let resolve = () => {};
  const bothLooked = new Promise<void>((r) => (resolve = r));

  const raced: OrganizationStore = {
    slugIsTaken: async (slug) => {
      const taken = await store.slugIsTaken(slug);
      answers.push(taken);
      if (answers.length === 2) resolve();
      return taken;
    },
    insert: async (organization) => {
      await bothLooked;
      return store.insert(organization);
    },
  };
  return { raced, answers };
};

test("a second registration of the same slug fails the preflight", async () => {
  const register = registerOrganization(new InMemoryOrganizationStore());

  expect(await status(register(acme()))).toBe(201);
  expect(await status(register(acme("Acme SAS")))).toBe(409);
});

test("two concurrent creates both pass the preflight; the unique constraint rejects one", async () => {
  const { raced, answers } = racing(new InMemoryOrganizationStore());
  const register = registerOrganization(raced);

  const outcomes = await Promise.all([
    status(register(acme())),
    status(register(acme("Acme SAS"))),
  ]);

  // Both lookups saw a free slug: the preflight cannot establish uniqueness.
  expect(answers).toEqual([false, false]);
  // The store can, because it checks and writes in one step. The loser gets
  // the same 409 the preflight would have given it, never a 503.
  expect(outcomes.sort()).toEqual([201, 409]);
});

test("an invariant failure never reaches the store", async () => {
  const untouched: OrganizationStore = {
    slugIsTaken: () => Promise.reject(new Error("must not be called")),
    insert: () => Promise.reject(new Error("must not be called")),
  };

  expect(await status(registerOrganization(untouched)(acme("A".repeat(81))))).toBe(422);
});

test("an unavailable store is a defect, not a conflict", async () => {
  const down: OrganizationStore = {
    slugIsTaken: () => Promise.resolve(false),
    insert: () => Promise.reject(new Error("connection refused")),
  };

  expect(await status(registerOrganization(down)(acme()))).toBe(503);
});
