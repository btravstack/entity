import { expect, test } from "vitest";
import { z } from "zod";

import { Entity } from "./index.js";

const OrgId = z.uuid().brand("OrgId");
const Slug = z.string().min(1).brand("Slug");
const Tag = z.string().min(1).brand("Tag");

class Organization extends Entity("Organization")({
  id: OrgId,
  slug: Slug,
  tags: z.array(Tag),
}) {}
class Team extends Entity("Team")({ id: OrgId, slug: Slug, tags: z.array(Tag) }) {}

const raw = { id: "0199b1f4-1b1e-7000-8000-000000000000", slug: "acme", tags: ["a", "b"] };

test("distinct instances with the same data are equal", () => {
  const a = Organization.decode(raw).getOrThrow();
  const b = Organization.decode(raw).getOrThrow();
  expect(a === b).toBe(false);
  expect(a.equals(b)).toBe(true);
});

test("differing data is unequal", () => {
  const a = Organization.decode(raw).getOrThrow();
  const b = Organization.decode({ ...raw, slug: "other" }).getOrThrow();
  expect(a.equals(b)).toBe(false);
});

test("entities holding equal arrays are equal", () => {
  // This is the case a shallow, reference-comparing rule got wrong.
  const a = Organization.decode({ ...raw, tags: ["x", "y"] }).getOrThrow();
  const b = Organization.decode({ ...raw, tags: ["x", "y"] }).getOrThrow();
  expect(a.encode().tags === b.encode().tags).toBe(false);
  expect(a.equals(b)).toBe(true);
});

test("different entity types with identical data are unequal", () => {
  expect(Organization.decode(raw).getOrThrow().equals(Team.decode(raw).getOrThrow())).toBe(false);
});

test("sibling subclasses of one entity with the same data are equal", () => {
  // Identity is the entity a class was built from, not the class itself: both
  // sides are still an `Organization`, so equal stored data means equal entity.
  class Vendor extends Organization {}
  class Customer extends Organization {}
  expect(Vendor.decode(raw).getOrThrow().equals(Customer.decode(raw).getOrThrow())).toBe(true);
});

test("comparing against a non-entity is false, not a throw", () => {
  const org = Organization.decode(raw).getOrThrow();
  expect(org.equals(raw)).toBe(false);
  expect(org.equals(undefined)).toBe(false);
});
