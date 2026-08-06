import { P } from "unthrown";
import { expect, test } from "vitest";
import { z } from "zod";

import { Entity } from "./index.js";

const OrgId = z.uuid().brand("OrgId");
const Slug = z.string().min(1).brand("Slug");
const DisplayName = z.string().min(1).brand("DisplayName");
const Instant = z.iso.datetime().brand("Instant");

class Organization extends Entity("Organization")(
  { id: OrgId, slug: Slug, name: DisplayName, createdAt: Instant, trialEndsAt: Instant },
  {
    generated: ["id", "createdAt"],
    immutable: ["id", "createdAt", "slug"],
    invariants: (d) => (d.trialEndsAt > d.createdAt ? [] : ["trialEndsAt must be after createdAt"]),
  },
) {}

const input = {
  slug: "acme",
  name: "Acme",
  trialEndsAt: "2026-09-01T09:00:00Z",
} as never;
const generated = {
  id: "0199b1f4-1b1e-7000-8000-000000000000",
  createdAt: "2026-08-06T09:00:00Z",
} as never;

test("create applies the generated values", () => {
  const org = Organization.create(input, generated).getOrThrow();
  expect(org.id).toBe("0199b1f4-1b1e-7000-8000-000000000000");
  expect(org.createdAt).toBe("2026-08-06T09:00:00Z");
  expect(org.slug).toBe("acme");
});

test("create ignores a generated field smuggled in by a caller", () => {
  const org = Organization.create(
    { ...(input as object), id: "0199b1f4-1b1e-7000-8000-999999999999" } as never,
    generated,
  ).getOrThrow();
  expect(org.id).toBe("0199b1f4-1b1e-7000-8000-000000000000");
});

test("create enforces invariants", () => {
  const bad = Organization.create(
    { ...(input as object), trialEndsAt: "2026-01-01T09:00:00Z" } as never,
    generated,
  );
  expect(bad.isErr()).toBe(true);
});

test("createInput omits exactly the generated fields", () => {
  expect(Object.keys(Organization.createInput.shape).toSorted()).toEqual(
    ["name", "slug", "trialEndsAt"].toSorted(),
  );
});

test("updateInput is partial and omits the immutable fields", () => {
  expect(Object.keys(Organization.updateInput.shape).toSorted()).toEqual(
    ["name", "trialEndsAt"].toSorted(),
  );
  expect(Organization.updateInput.safeParse({}).success).toBe(true);
});

test("update returns a new instance and leaves the original untouched", () => {
  const org = Organization.create(input, generated).getOrThrow();
  const renamed = org.update({ name: "Renamed" as never }).getOrThrow();
  expect(renamed).not.toBe(org);
  expect(renamed.name).toBe("Renamed");
  expect(org.name).toBe("Acme");
  expect(renamed.id).toBe(org.id);
});

test("update ignores an immutable field smuggled in at runtime", () => {
  const org = Organization.create(input, generated).getOrThrow();
  const updated = org.update({ slug: "other" } as never).getOrThrow();
  expect(updated.slug).toBe("acme");
});

test("update re-runs invariants", () => {
  const org = Organization.create(input, generated).getOrThrow();
  const issues = org.update({ trialEndsAt: "2026-01-01T09:00:00Z" as never }).match({
    ok: () => [] as readonly string[],
    errCases: (m) => m.with(P.tag("InvalidEntity"), (e) => e.issues),
    defect: () => ["DEFECT"],
  });
  expect(issues).toEqual(["trialEndsAt must be after createdAt"]);
});

test("an entity with no generated or immutable options still exposes both schemas", () => {
  class Plain extends Entity("Plain")({ id: OrgId, slug: Slug }) {}
  expect(Object.keys(Plain.createInput.shape).toSorted()).toEqual(["id", "slug"]);
  expect(Object.keys(Plain.updateInput.shape).toSorted()).toEqual(["id", "slug"]);
});
