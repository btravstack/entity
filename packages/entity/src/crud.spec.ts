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
const createOrg = Organization.factory({
  id: () => "0199b1f4-1b1e-7000-8000-000000000000" as never,
  createdAt: () => "2026-08-06T09:00:00Z" as never,
});

test("create applies the generated values", () => {
  const org = createOrg(input).getOrThrow();
  expect(org.id).toBe("0199b1f4-1b1e-7000-8000-000000000000");
  expect(org.createdAt).toBe("2026-08-06T09:00:00Z");
  expect(org.slug).toBe("acme");
});

test("create ignores a generated field smuggled in by a caller", () => {
  const org = createOrg({
    ...(input as object),
    id: "0199b1f4-1b1e-7000-8000-999999999999",
  } as never).getOrThrow();
  expect(org.id).toBe("0199b1f4-1b1e-7000-8000-000000000000");
});

test("create enforces invariants", () => {
  const bad = createOrg({ ...(input as object), trialEndsAt: "2026-01-01T09:00:00Z" } as never);
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
  const org = createOrg(input).getOrThrow();
  const renamed = org.update({ name: "Renamed" as never }).getOrThrow();
  expect(renamed).not.toBe(org);
  expect(renamed.name).toBe("Renamed");
  expect(org.name).toBe("Acme");
  expect(renamed.id).toBe(org.id);
});

test("update ignores an immutable field smuggled in at runtime", () => {
  const org = createOrg(input).getOrThrow();
  const updated = org.update({ slug: "other" } as never).getOrThrow();
  expect(updated.slug).toBe("acme");
});

test("update re-runs invariants", () => {
  const org = createOrg(input).getOrThrow();
  const issues = org.update({ trialEndsAt: "2026-01-01T09:00:00Z" as never }).match({
    ok: () => [] as readonly string[],
    errCases: (m) => m.with(P.tag("InvalidEntity"), (e) => e.issues.map((i) => i.message)),
    defect: () => ["DEFECT"],
  });
  expect(issues).toEqual(["trialEndsAt must be after createdAt"]);
});

test("an entity with no generated or immutable options still exposes both schemas", () => {
  class Plain extends Entity("Plain")({ id: OrgId, slug: Slug }) {}
  expect(Object.keys(Plain.createInput.shape).toSorted()).toEqual(["id", "slug"]);
  expect(Object.keys(Plain.updateInput.shape).toSorted()).toEqual(["id", "slug"]);
});

test("a generator runs once per create, not once per factory", () => {
  let n = 0;
  const countedCreate = Organization.factory({
    id: () => `0199b1f4-1b1e-7000-8000-00000000000${(n += 1)}` as never,
    createdAt: () => "2026-08-06T09:00:00Z" as never,
  });
  const a = countedCreate(input).getOrThrow();
  const b = countedCreate(input).getOrThrow();
  expect(a.id).not.toBe(b.id);
  expect(n).toBe(2);
});

test("an async factory awaits its generators", async () => {
  const createOrgAsync = Organization.factoryAsync({
    id: () => Promise.resolve("0199b1f4-1b1e-7000-8000-000000000000" as never),
    createdAt: () => Promise.resolve("2026-08-06T09:00:00Z" as never),
  });
  const org = (await createOrgAsync(input)).getOrThrow();
  expect(org.id).toBe("0199b1f4-1b1e-7000-8000-000000000000");
});

test("an async factory still reports invariant failures as InvalidEntity", async () => {
  const createOrgAsync = Organization.factoryAsync({
    id: () => Promise.resolve("0199b1f4-1b1e-7000-8000-000000000000" as never),
    createdAt: () => Promise.resolve("2026-08-06T09:00:00Z" as never),
  });
  const outcome = (
    await createOrgAsync({ ...(input as object), trialEndsAt: "2026-01-01T09:00:00Z" } as never)
  ).match({
    ok: () => "WRONGLY ACCEPTED",
    errCases: (m) => m.with(P.tag("InvalidEntity"), () => "invalid"),
    defect: () => "defect",
  });
  expect(outcome).toBe("invalid");
});

test("a rejecting generator is a defect, not an InvalidEntity", async () => {
  const createBroken = Organization.factoryAsync({
    id: () => Promise.reject(new Error("id source unreachable")),
    createdAt: () => Promise.resolve("2026-08-06T09:00:00Z" as never),
  });
  const outcome = (await createBroken(input)).match({
    ok: () => "WRONGLY ACCEPTED",
    errCases: (m) => m.with(P.tag("InvalidEntity"), () => "invalid"),
    defect: () => "defect",
  });
  expect(outcome).toBe("defect");
});
