import { fromSchema } from "@unthrown/standard-schema";
import { expect, test } from "vitest";
import { z } from "zod";

import { Entity } from "./index.js";

const OrgId = z.uuid().brand("OrgId");
const Slug = z.string().min(1).brand("Slug");

class Organization extends Entity("Organization")(
  { id: OrgId, slug: Slug },
  { invariants: (d) => (d.slug === "reserved" ? ["slug must not be reserved"] : []) },
) {}

const raw = { id: "0199b1f4-1b1e-7000-8000-000000000000", slug: "acme" };

test("instance parses input data into a class instance", () => {
  expect(Organization.instance.parse(raw)).toBeInstanceOf(Organization);
});

test("instance nests inside a zod object and an array", () => {
  expect(z.object({ owner: Organization.instance }).parse({ owner: raw }).owner).toBeInstanceOf(
    Organization,
  );
  const many = z.array(Organization.instance).parse([raw, raw]);
  expect(many[0]).toBeInstanceOf(Organization);
});

test("a nested invariant failure names the failing member in the issue path", () => {
  const result = z
    .object({ owner: Organization.instance })
    .safeParse({ owner: { ...raw, slug: "reserved" } });
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues[0]?.path).toEqual(["owner"]);
    expect(result.error.issues[0]?.message).toBe("slug must not be reserved");
  }
});

test("instance is the Standard Schema entry point", () => {
  const parse = fromSchema(Organization.instance);
  expect(parse(raw).getOrThrow()).toBeInstanceOf(Organization);
  expect(parse({ id: "nope", slug: "" }).isErr()).toBe(true);
});

test("instance is not enumerable on the class", () => {
  expect(Object.keys(Organization)).not.toContain("instance");
});

test("instance is built once and reused", () => {
  expect(Organization.instance).toBe(Organization.instance);
});

test("instance is a Standard Schema, so it is what a framework receives", () => {
  expect("~standard" in (Organization.instance as object)).toBe(true);
});

test("a defect during make propagates instead of becoming a validation issue", () => {
  class Buggy extends Entity("Buggy")(
    { id: OrgId },
    {
      invariants: () => {
        // deliberately simulate an unmodeled defect, to pin that `instance`
        // lets it propagate rather than folding it into a zod issue
        // oxlint-disable-next-line unthrown/no-throw
        throw new Error("boom");
      },
    },
  ) {}
  expect(() => Buggy.instance.parse({ id: raw.id })).toThrow("boom");
});

test("a nested entity's field failure reports the full path, not just the member", () => {
  const result = z
    .object({ owner: Organization.instance })
    .safeParse({ owner: { id: raw.id, slug: "" } });
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues[0]?.path).toEqual(["owner", "slug"]);
  }
});

test("a nested invariant failure lands on the member itself, having no path", () => {
  const result = z
    .object({ owner: Organization.instance })
    .safeParse({ owner: { ...raw, slug: "reserved" } });
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues[0]?.path).toEqual(["owner"]);
    expect(result.error.issues[0]?.message).toBe("slug must not be reserved");
  }
});
