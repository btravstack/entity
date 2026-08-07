import { fromSchema } from "@unthrown/standard-schema";
import { expect, test } from "vitest";
import { z } from "zod";

import { Entity } from "./index.js";

const OrgId = z.uuid().brand("OrgId");
const Slug = z.string().min(1).brand("Slug");

class Organization extends Entity("Organization")(
  { id: OrgId, slug: Slug },
  { invariants: [Entity.invariant((d) => d.slug !== "reserved", "slug must not be reserved")] },
) {}

const raw = { id: "0199b1f4-1b1e-7000-8000-000000000000", slug: "acme" };

test("the class is itself a schema, so zod parses input to an instance", () => {
  // no `.parse` on the class by design — `make` is the direct route, and zod
  // reaches the schema through the internal slots
  expect(z.array(Organization).parse([raw])[0]).toBeInstanceOf(Organization);
  expect(Organization.make(raw).getOrThrow()).toBeInstanceOf(Organization);
});

test("the class nests inside a zod object and an array", () => {
  expect(z.object({ owner: Organization }).parse({ owner: raw }).owner).toBeInstanceOf(
    Organization,
  );
  const many = z.array(Organization).parse([raw, raw]);
  expect(many[0]).toBeInstanceOf(Organization);
});

test("a nested invariant failure names the failing member in the issue path", () => {
  const result = z
    .object({ owner: Organization })
    .safeParse({ owner: { ...raw, slug: "reserved" } });
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues[0]?.path).toEqual(["owner"]);
    expect(result.error.issues[0]?.message).toBe("slug must not be reserved");
  }
});

test("the class is the Standard Schema entry point", () => {
  const parse = fromSchema(Organization);
  expect(parse(raw).getOrThrow()).toBeInstanceOf(Organization);
  expect(parse({ id: "nope", slug: "" }).isErr()).toBe(true);
});

test("the schema slots are not enumerable on the class", () => {
  expect(Object.keys(Organization)).not.toContain("_zod");
  expect(Object.keys(Organization)).not.toContain("~standard");
});

test("the schema is built once and reused", () => {
  expect(Organization).toBe(Organization);
});

test("the class carries ~standard, so a framework accepts it directly", () => {
  expect("~standard" in (Organization as object)).toBe(true);
});

test("a defect during make propagates instead of becoming a validation issue", () => {
  class Buggy extends Entity("Buggy")(
    { id: OrgId },
    {
      invariants: [
        Entity.invariant(() => {
          // deliberately simulate an unmodeled defect, to pin that the schema
          // lets it propagate rather than folding it into a zod issue
          // oxlint-disable-next-line unthrown/no-throw
          throw new Error("boom");
        }, "unreachable — the predicate always throws"),
      ],
    },
  ) {}
  expect(() => z.array(Buggy).parse([{ id: raw.id }])).toThrow("boom");
});

test("a nested entity's field failure reports the full path, not just the member", () => {
  const result = z.object({ owner: Organization }).safeParse({ owner: { id: raw.id, slug: "" } });
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues[0]?.path).toEqual(["owner", "slug"]);
  }
});

test("a nested invariant failure lands on the member itself, having no path", () => {
  const result = z
    .object({ owner: Organization })
    .safeParse({ owner: { ...raw, slug: "reserved" } });
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues[0]?.path).toEqual(["owner"]);
    expect(result.error.issues[0]?.message).toBe("slug must not be reserved");
  }
});
