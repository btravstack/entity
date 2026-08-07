import { DisplayName, Slug, createOrganization } from "@btravstack/entity-example-billing-domain";
import { P } from "unthrown";
import { expect, test } from "vitest";

import { InMemoryOrganizationRepository } from "./index.js";

const acme = () =>
  createOrganization({
    slug: Slug.parse("acme"),
    name: DisplayName.parse("Acme SA"),
  }).getOrThrow();

test("an entity survives the round trip through storage", () => {
  const repo = new InMemoryOrganizationRepository();
  const saved = acme();
  repo.save(saved);

  const loaded = repo.byId(saved.id).getOrThrow();
  expect(loaded.equals(saved)).toBe(true);
  // Behaviour comes back too, not just data — `make` returns a real instance.
  expect(loaded.isSelfTitled).toBe(true);
});

test("the stored row is exactly the shape, and never carries _tag", () => {
  const repo = new InMemoryOrganizationRepository();
  const saved = acme();
  repo.save(saved);

  const row = repo.rawRow(saved.id);
  expect(row).toBeDefined();
  expect("_tag" in row!).toBe(false);
  expect(Object.keys(row!).sort()).toEqual(["createdAt", "displayLabel", "id", "name", "slug"]);
});

test("a corrupt row comes back as an error, not an exception", async () => {
  const repo = new InMemoryOrganizationRepository();
  const id = "11111111-1111-4111-8111-111111111111";
  repo.seedRaw(id, { id, slug: "", name: "" });

  const loaded = repo.byId(id as never);
  expect(loaded.isErr()).toBe(true);

  const kind = await loaded.match({
    ok: () => "ok",
    errCases: (m) =>
      m
        .with(P.tag("InvalidEntity"), () => "invalid")
        .with(P.tag("OrganizationNotFound"), () => "not-found"),
    defect: () => "defect",
  });
  expect(kind).toBe("invalid");
});

test("a missing row is NotFound, which is a different fact from corrupt", async () => {
  const repo = new InMemoryOrganizationRepository();
  const missing = repo.byId("22222222-2222-4222-8222-222222222222" as never);

  expect(missing.isErr()).toBe(true);
  const kind = await missing.match({
    ok: () => "ok",
    errCases: (m) =>
      m
        .with(P.tag("InvalidEntity"), () => "invalid")
        .with(P.tag("OrganizationNotFound"), () => "not-found"),
    defect: () => "defect",
  });
  expect(kind).toBe("not-found");
});

test("update writes a new row and leaves the entity in hand untouched", () => {
  const repo = new InMemoryOrganizationRepository();
  const saved = acme();
  repo.save(saved);

  const renamed = saved.update({ name: DisplayName.parse("Acme SAS") }).getOrThrow();
  repo.save(renamed);

  expect(repo.byId(saved.id).getOrThrow().name).toBe("Acme SAS");
  expect(saved.name).toBe("Acme SA");
});
