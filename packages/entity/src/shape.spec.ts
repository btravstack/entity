import { expect, test } from "vitest";
import { z } from "zod";

import { shape } from "./shape.js";

const Id = z.uuid().brand("Id");
const Slug = z
  .string()
  .regex(/^[a-z0-9-]{3,40}$/u)
  .brand("Slug");
const DisplayName = z.string().min(1).max(80).brand("DisplayName");

test("a shape parses valid input and preserves derivation", () => {
  const Org = shape({ id: Id, slug: Slug, name: DisplayName });
  const parsed = Org.parse({
    id: "0199b1f4-1b1e-7000-8000-000000000000",
    slug: "acme",
    name: "Acme",
  });
  expect(parsed.slug).toBe("acme");
  expect(Object.keys(Org.pick({ slug: true }).shape)).toEqual(["slug"]);
});

test("toJSONSchema works on both input and output, so OpenAPI is unaffected", () => {
  const Org = shape({ id: Id, slug: Slug });
  for (const io of ["input", "output"] as const) {
    const js = z.toJSONSchema(Org, { io });
    expect(Object.keys(js.properties ?? {})).toEqual(["id", "slug"]);
  }
});

test("enums, optional branded scalars, and arrays of branded scalars parse", () => {
  const Org = shape({
    id: Id,
    status: z.enum(["active", "inactive"]),
    parentSlug: Slug.optional(),
    tags: z.array(Slug),
  });
  const parsed = Org.parse({
    id: "0199b1f4-1b1e-7000-8000-000000000000",
    status: "active",
    tags: ["acme", "widgets"],
  });
  expect(parsed.status).toBe("active");
  expect(parsed.parentSlug).toBeUndefined();
  expect(parsed.tags).toEqual(["acme", "widgets"]);
});

test("Slug rejects values outside its pattern", () => {
  expect(Slug.safeParse("ab").success).toBe(false);
  expect(Slug.safeParse("Acme").success).toBe(false);
  expect(Slug.safeParse("acme-1").success).toBe(true);
});
