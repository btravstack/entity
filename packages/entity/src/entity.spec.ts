import type { SchemaIssues } from "@unthrown/standard-schema";
import { P } from "unthrown";
import { expect, test } from "vitest";
import { z } from "zod";

import { Entity } from "./index.js";
import { keysOf } from "./issues.js";

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

test("make produces an instance with typed data and working methods", () => {
  const org = Organization.make(raw).getOrThrow();
  expect(org).toBeInstanceOf(Organization);
  expect(org.slug).toBe("acme");
  expect(org.shout()).toBe("ACME");
});

test("toJSON returns the stored data", () => {
  expect(Organization.make(raw).getOrThrow().toJSON()).toEqual(raw);
});

test("with no options, input and output describe the same fields", () => {
  expect(Object.keys(Organization.output.shape).toSorted()).toEqual(
    Object.keys(Organization.input.shape).toSorted(),
  );
});

test("the tag is readable but never part of the data", () => {
  const org = Organization.make(raw).getOrThrow();
  expect(org._tag).toBe("Organization");
  expect(Object.keys(org)).not.toContain("_tag");
  expect(org.toJSON()).not.toHaveProperty("_tag");
  expect(JSON.stringify(org)).not.toContain("_tag");
  expect({ ...org }).not.toHaveProperty("_tag");
  expect(Organization.input.shape).not.toHaveProperty("_tag");
  expect(Organization.output.shape).not.toHaveProperty("_tag");
});

test("JSON.stringify emits data only, because methods live on the prototype", () => {
  expect(JSON.parse(JSON.stringify(Organization.make(raw).getOrThrow()))).toEqual(raw);
});

type Flat = { readonly path: readonly PropertyKey[]; readonly message: string };
const flatten = (issues: SchemaIssues): readonly Flat[] =>
  issues.map((i) => ({ path: keysOf(i), message: i.message }));

const orgIssuesOf = (r: ReturnType<typeof Organization.make>): readonly Flat[] =>
  r.match({
    ok: () => [{ path: [], message: "WRONGLY ACCEPTED" }],
    errCases: (m) => m.with(P.tag("InvalidEntity"), (e) => flatten(e.issues)),
    defect: () => [{ path: [], message: "DEFECT" }],
  });

test("schema validation failure surfaces as InvalidEntity, not a defect", () => {
  const failure = Organization.make({ ...raw, slug: "" }).match({
    ok: () => "WRONGLY ACCEPTED",
    errCases: (m) =>
      m.with(P.tag("InvalidEntity"), (e) => `${e.entity}:${flatten(e.issues)[0]?.path.join(".")}`),
    defect: () => "DEFECT",
  });
  expect(failure).toBe("Organization:slug");
});

test("a schema issue carries the path of the field that failed", () => {
  expect(orgIssuesOf(Organization.make({ ...raw, slug: "" }))).toEqual([
    { path: ["slug"], message: "Too small: expected string to have >=1 characters" },
  ]);
});

test("every failing field is reported, not just the first", () => {
  expect(orgIssuesOf(Organization.make({ ...raw, slug: "", name: "" }))).toEqual([
    { path: ["slug"], message: "Too small: expected string to have >=1 characters" },
    { path: ["name"], message: "Too small: expected string to have >=1 characters" },
  ]);
});

test("a whole-object issue has an empty path", () => {
  expect(orgIssuesOf(Organization.make("not an object"))).toEqual([
    { path: [], message: "Invalid input: expected object, received string" },
  ]);
});

test("a nested path keeps its segments, array indices included", () => {
  const Tag = z.string().min(2).brand("Tag");
  const Address = z.object({ city: z.string().min(2) }).brand("Address");
  class Profile extends Entity("Profile")({
    id: OrgId,
    tags: z.array(Tag).brand("Tags"),
    address: Address,
  }) {}
  const issues = Profile.make({ id: raw.id, tags: ["ok", "x"], address: { city: "y" } }).match({
    ok: () => [] as readonly Flat[],
    errCases: (m) => m.with(P.tag("InvalidEntity"), (e) => flatten(e.issues)),
    defect: () => [{ path: [], message: "DEFECT" }],
  });
  expect(issues).toEqual([
    { path: ["tags", 1], message: "Too small: expected string to have >=2 characters" },
    { path: ["address", "city"], message: "Too small: expected string to have >=2 characters" },
  ]);
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
  const org = Organization.make(raw).getOrThrow();
  expect(() => {
    (org as unknown as Record<string, unknown>)["slug"] = "hacked";
  }).toThrow(TypeError);
  expect(org.slug).toBe("acme");
});

// The entity's own class body — the supported place for behaviour and extra
// fields, now that subclassing an entity is not.
class OrgWithCache extends Entity("OrgWithCache")({
  id: OrgId,
  slug: Slug,
  name: DisplayName,
}) {
  cachedSummary = "";
}

test("locking data fields leaves class-body instance fields writable", () => {
  // Object.freeze(this) would break this: class-body field initialisers run
  // after super() returns, so the object must stay extensible.
  const org = OrgWithCache.make(raw).getOrThrow();
  org.cachedSummary = "computed";
  expect(org.cachedSummary).toBe("computed");
  expect(org.slug).toBe("acme");
});

test("toJSON does not leak class-body instance fields", () => {
  const org = OrgWithCache.make(raw).getOrThrow();
  org.cachedSummary = "leak me";
  expect(org.toJSON()).not.toHaveProperty("cachedSummary");
});

test("subclassing an entity is a defect, not a silent success", () => {
  class Sub extends Organization {}
  const outcome = Sub.make(raw).match({
    ok: () => "WRONGLY ACCEPTED",
    errCases: (m) => m.with(P.tag("InvalidEntity"), () => "invalid"),
    defect: () => "defect",
  });
  expect(outcome).toBe("defect");
});

test("using the builder's return directly, without extends, still works", () => {
  const Anon = Entity("Anon")({ id: OrgId, slug: Slug, name: DisplayName });
  expect(Anon.make(raw).getOrThrow().slug).toBe("acme");
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

const issuesOf = (r: ReturnType<typeof Trial.make>): readonly Flat[] =>
  r.match({
    ok: () => [] as readonly Flat[],
    errCases: (m) => m.with(P.tag("InvalidEntity"), (e) => flatten(e.issues)),
    defect: () => [{ path: [], message: "DEFECT" }],
  });

test("a satisfied invariant lets the entity through", () => {
  expect(Trial.make(trialRaw).isOk()).toBe(true);
});

test("a broken invariant surfaces as InvalidEntity", () => {
  expect(issuesOf(Trial.make({ ...trialRaw, trialEndsAt: "2026-07-01T09:00:00Z" }))).toEqual([
    { path: [], message: "trialEndsAt must be after createdAt" },
  ]);
});

test("every broken rule is reported, not just the first", () => {
  expect(
    issuesOf(Trial.make({ ...trialRaw, trialEndsAt: "2026-07-01T09:00:00Z", seatsUsed: 9 })),
  ).toHaveLength(2);
});

test("an invariant issue has no path, unlike a schema issue", () => {
  const [issue] = issuesOf(Trial.make({ ...trialRaw, trialEndsAt: "2026-07-01T09:00:00Z" }));
  expect(issue?.path).toEqual([]);
  expect(issue?.message).toBe("trialEndsAt must be after createdAt");
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
  const bag = Bag.make(bagRaw).getOrThrow();
  expect(() => asMutableArray(bag.tags).push("b")).toThrow(TypeError);
  expect(() => {
    asMutableArray(bag.tags)[0] = "hacked";
  }).toThrow(TypeError);
  expect(bag.toJSON().tags).toEqual(["a"]);
});

test("a nested object field, and the array inside it, are frozen too", () => {
  const bag = Bag.make(bagRaw).getOrThrow();
  expect(() => {
    asMutableRecord(bag.address)["city"] = "Paris";
  }).toThrow(TypeError);
  expect(() => asMutableArray(bag.address.lines).push("floor 2")).toThrow(TypeError);
  expect(bag.toJSON().address).toEqual({ city: "Lyon", lines: ["1 rue de la Paix"] });
});

test("a construction-time invariant cannot be defeated after construction", () => {
  // decoding straight into the forbidden state is rejected …
  expect(Bag.make({ ...bagRaw, tags: ["a", "b", "c"] }).isErr()).toBe(true);
  // … and so is reaching it one push at a time
  const bag = Bag.make({ ...bagRaw, tags: ["a", "b"] }).getOrThrow();
  expect(() => asMutableArray(bag.tags).push("c")).toThrow(TypeError);
  expect(bag.tags).toHaveLength(2);
});

test("update still produces a new entity from frozen data", () => {
  const bag = Bag.make(bagRaw).getOrThrow();
  const updated = bag.update({ tags: ["x", "y"] as unknown as z.infer<typeof Tag>[] }).getOrThrow();
  expect(updated.toJSON().tags).toEqual(["x", "y"]);
  expect(bag.toJSON().tags).toEqual(["a"]);
});

test("update cannot smuggle a mutation in through the patch it was handed", () => {
  const bag = Bag.make(bagRaw).getOrThrow();
  const patch = { tags: ["x"] as unknown as z.infer<typeof Tag>[] };
  const updated = bag.update(patch).getOrThrow();
  asMutableArray(patch.tags).push("y");
  expect(updated.toJSON().tags).toEqual(["x"]);
});
