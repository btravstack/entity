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

const Tag = z.string().min(1).brand("Tag");
const Address = z.object({ city: z.string(), lines: z.array(z.string()) }).brand("Address");

/** at most two tags — the rule a post-construction `push` used to defeat */
class Bag extends Entity("Bag")(
  { id: OrgId, tags: z.array(Tag), address: Address },
  { invariants: (d) => (d.tags.length <= 2 ? [] : ["at most 2 tags"]) },
) {}

const bagRaw = {
  id: "0199b1f4-1b1e-7000-8000-000000000000",
  tags: ["a"],
  address: { city: "Lyon", lines: ["1 rue de la Paix"] },
};

/** the casts are the point: this is what a consumer who defeats the types gets */
const asMutableArray = (value: unknown) => value as string[];
const asMutableRecord = (value: unknown) => value as Record<string, unknown>;

test("an array field cannot be mutated in place", () => {
  const bag = Bag.decode(bagRaw).getOrThrow();
  expect(() => asMutableArray(bag.tags).push("b")).toThrow(TypeError);
  expect(() => {
    asMutableArray(bag.tags)[0] = "hacked";
  }).toThrow(TypeError);
  expect(bag.encode().tags).toEqual(["a"]);
});

test("a nested object field, and the array inside it, are frozen too", () => {
  const bag = Bag.decode(bagRaw).getOrThrow();
  expect(() => {
    asMutableRecord(bag.address)["city"] = "Paris";
  }).toThrow(TypeError);
  expect(() => asMutableArray(bag.address.lines).push("floor 2")).toThrow(TypeError);
  expect(bag.encode().address).toEqual({ city: "Lyon", lines: ["1 rue de la Paix"] });
});

test("a construction-time invariant cannot be defeated after construction", () => {
  // decoding straight into the forbidden state is rejected …
  expect(Bag.decode({ ...bagRaw, tags: ["a", "b", "c"] }).isErr()).toBe(true);
  // … and so is reaching it one push at a time
  const bag = Bag.decode({ ...bagRaw, tags: ["a", "b"] }).getOrThrow();
  expect(() => asMutableArray(bag.tags).push("c")).toThrow(TypeError);
  expect(bag.tags).toHaveLength(2);
});

test("update still produces a new entity from frozen data", () => {
  const bag = Bag.decode(bagRaw).getOrThrow();
  const updated = bag.update({ tags: ["x", "y"] as unknown as z.infer<typeof Tag>[] }).getOrThrow();
  expect(updated.encode().tags).toEqual(["x", "y"]);
  expect(bag.encode().tags).toEqual(["a"]);
});

test("update cannot smuggle a mutation in through the patch it was handed", () => {
  const bag = Bag.decode(bagRaw).getOrThrow();
  const patch = { tags: ["x"] as unknown as z.infer<typeof Tag>[] };
  const updated = bag.update(patch).getOrThrow();
  asMutableArray(patch.tags).push("y");
  expect(updated.encode().tags).toEqual(["x"]);
});
