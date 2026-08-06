import { P } from "unthrown";
import { expect, test } from "vitest";
import { z } from "zod";

import { Entity } from "./index.js";

const OrgId = z.uuid().brand("OrgId");
const Slug = z.string().min(1).brand("Slug");
const DisplayName = z.string().min(1).max(80).brand("DisplayName");

class Organization extends Entity("Organization")({
  id: OrgId,
  slug: Slug,
  name: DisplayName,
}) {
  shout(): string {
    return this.name.toUpperCase();
  }
}

const raw = { id: "0199b1f4-1b1e-7000-8000-000000000000", slug: "acme", name: "Acme" };

test("decode produces an instance with typed data and working methods", () => {
  const org = Organization.decode(raw).getOrThrow();
  expect(org).toBeInstanceOf(Organization);
  expect(org.slug).toBe("acme");
  expect(org.shout()).toBe("ACME");
});

test("encode returns the stored data", () => {
  expect(Organization.decode(raw).getOrThrow().encode()).toEqual(raw);
});

test("with no options, decoded and encoded describe the same fields", () => {
  expect(Object.keys(Organization.decoded.shape).toSorted()).toEqual(
    Object.keys(Organization.encoded.shape).toSorted(),
  );
});

test("the tag is readable but never part of the data", () => {
  const org = Organization.decode(raw).getOrThrow();
  expect(org._tag).toBe("Organization");
  expect(Object.keys(org)).not.toContain("_tag");
  expect(org.encode()).not.toHaveProperty("_tag");
  expect(JSON.stringify(org)).not.toContain("_tag");
  expect({ ...org }).not.toHaveProperty("_tag");
  expect(Organization.encoded.shape).not.toHaveProperty("_tag");
  expect(Organization.decoded.shape).not.toHaveProperty("_tag");
});

test("JSON.stringify emits data only, because methods live on the prototype", () => {
  expect(JSON.parse(JSON.stringify(Organization.decode(raw).getOrThrow()))).toEqual(raw);
});

test("schema validation failure surfaces as InvalidEntity, not a defect", () => {
  const message = Organization.decode({ ...raw, slug: "" }).match({
    ok: () => "WRONGLY ACCEPTED",
    errCases: (m) => m.with(P.tag("InvalidEntity"), (e) => `${e.entity}:${e.issues.length}`),
    defect: () => "DEFECT",
  });
  expect(message).toBe("Organization:1");
});

test("make accepts already-stored state", () => {
  const org = Organization.make(raw).getOrThrow();
  expect(org).toBeInstanceOf(Organization);
  expect(org.slug).toBe("acme");
});

test("entityName carries the tag", () => {
  expect(Organization.entityName).toBe("Organization");
});

test("data fields are locked against mutation at runtime", () => {
  const org = Organization.decode(raw).getOrThrow();
  expect(() => {
    (org as unknown as Record<string, unknown>)["slug"] = "hacked";
  }).toThrow(TypeError);
  expect(org.slug).toBe("acme");
});

test("locking data fields leaves subclass instance fields writable", () => {
  // Object.freeze(this) would break this: subclass field initialisers run
  // after super() returns, so the object must stay extensible.
  class OrgWithCache extends Organization {
    cachedSummary = "";
  }
  const org = OrgWithCache.decode(raw).getOrThrow();
  org.cachedSummary = "computed";
  expect(org.cachedSummary).toBe("computed");
  expect(org.slug).toBe("acme");
});

test("encode does not leak subclass instance fields", () => {
  class OrgWithCache extends Organization {
    cachedSummary = "leak me";
  }
  expect(OrgWithCache.decode(raw).getOrThrow().encode()).not.toHaveProperty("cachedSummary");
});

const Instant = z.iso.datetime().brand("Instant");
const SeatLimit = z.number().int().brand("SeatLimit");
const SeatsUsed = z.number().int().brand("SeatsUsed");

class Trial extends Entity("Trial")(
  {
    id: OrgId,
    createdAt: Instant,
    trialEndsAt: Instant,
    seatLimit: SeatLimit,
    seatsUsed: SeatsUsed,
  },
  {
    invariants: (d) => [
      ...(d.trialEndsAt > d.createdAt ? [] : ["trialEndsAt must be after createdAt"]),
      ...(d.seatLimit >= d.seatsUsed ? [] : ["seatsUsed must not exceed seatLimit"]),
    ],
  },
) {}

const trialRaw = {
  id: "0199b1f4-1b1e-7000-8000-000000000000",
  createdAt: "2026-08-01T09:00:00Z",
  trialEndsAt: "2026-08-15T09:00:00Z",
  seatLimit: 5,
  seatsUsed: 2,
};

const issuesOf = (r: ReturnType<typeof Trial.decode>) =>
  r.match({
    ok: () => [] as readonly string[],
    errCases: (m) => m.with(P.tag("InvalidEntity"), (e) => e.issues),
    defect: () => ["DEFECT"],
  });

test("a satisfied invariant lets the entity through", () => {
  expect(Trial.decode(trialRaw).isOk()).toBe(true);
});

test("a broken invariant surfaces as InvalidEntity", () => {
  expect(issuesOf(Trial.decode({ ...trialRaw, trialEndsAt: "2026-07-01T09:00:00Z" }))).toEqual([
    "trialEndsAt must be after createdAt",
  ]);
});

test("every broken rule is reported, not just the first", () => {
  expect(
    issuesOf(Trial.decode({ ...trialRaw, trialEndsAt: "2026-07-01T09:00:00Z", seatsUsed: 9 })),
  ).toHaveLength(2);
});

test("invariants also run on make", () => {
  expect(Trial.make({ ...trialRaw, trialEndsAt: "2026-07-01T09:00:00Z" }).isErr()).toBe(true);
});
