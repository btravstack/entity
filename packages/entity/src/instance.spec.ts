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

test("instance decodes encoded input to a class instance", () => {
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

test("the class itself is a Standard Schema", () => {
  const parse = fromSchema(Organization);
  expect(parse(raw).getOrThrow()).toBeInstanceOf(Organization);
  expect(parse({ id: "nope", slug: "" }).isErr()).toBe(true);
});

test("the standard-schema property is not enumerable", () => {
  expect(Object.keys(Organization)).not.toContain("~standard");
});

test("instance and ~standard are built once and reused", () => {
  expect(Organization.instance).toBe(Organization.instance);
  expect(Organization["~standard"]).toBe(Organization["~standard"]);
});

test("a bare subclass decodes to itself when the parent was read first", () => {
  class Parent extends Entity("ParentReadFirst")({ id: OrgId, slug: Slug }) {}
  class Sub extends Parent {}

  expect(Parent.instance.parse(raw)).toBeInstanceOf(Parent);
  expect(Sub.instance.parse(raw)).toBeInstanceOf(Sub);
});

test("a bare subclass decodes to itself when the subclass was read first", () => {
  class Parent extends Entity("SubclassReadFirst")({ id: OrgId, slug: Slug }) {}
  class Sub extends Parent {}

  expect(Sub.instance.parse(raw)).toBeInstanceOf(Sub);
  const built = Parent.instance.parse(raw);
  expect(built).toBeInstanceOf(Parent);
  expect(built).not.toBeInstanceOf(Sub);
});

test("a bare subclass gets its own instance and ~standard, each still stable", () => {
  class Parent extends Entity("DistinctFromParent")({ id: OrgId, slug: Slug }) {}
  class Sub extends Parent {}

  expect(Sub.instance).not.toBe(Parent.instance);
  expect(Parent.instance).toBe(Parent.instance);
  expect(Sub.instance).toBe(Sub.instance);
  expect(Sub["~standard"]).not.toBe(Parent["~standard"]);
  expect(Parent["~standard"]).toBe(Parent["~standard"]);
  expect(Sub["~standard"]).toBe(Sub["~standard"]);
});

test("instance follows a two-level subclass chain", () => {
  class Root extends Entity("SubclassChainRoot")({ id: OrgId, slug: Slug }) {}
  class Mid extends Root {}
  class Leaf extends Mid {}

  expect(Root.instance.parse(raw)).toBeInstanceOf(Root);
  expect(Mid.instance.parse(raw)).toBeInstanceOf(Mid);
  const leaf = Leaf.instance.parse(raw);
  expect(leaf).toBeInstanceOf(Leaf);
  expect(leaf).toBeInstanceOf(Root);
  expect(new Set([Root.instance, Mid.instance, Leaf.instance]).size).toBe(3);
});

test("neither instance nor ~standard becomes an own enumerable key", () => {
  class Parent extends Entity("NotEnumerable")({ id: OrgId, slug: Slug }) {}
  class Sub extends Parent {}

  // read both on both classes: nothing may be materialised as a plain key
  void Parent.instance;
  void Parent["~standard"];
  void Sub.instance;
  void Sub["~standard"];

  for (const C of [Parent, Sub]) {
    expect(Object.keys(C)).not.toContain("instance");
    expect(Object.keys(C)).not.toContain("~standard");
  }
  // the accessor lives on the `Entity(...)` base and stays there: reading it
  // must not stamp a value onto `Parent` (which would then reach `Sub`)
  expect(Object.hasOwn(Parent, "instance")).toBe(false);
  expect(Object.hasOwn(Sub, "instance")).toBe(false);
  const base = Object.getPrototypeOf(Parent) as object;
  expect(Object.getOwnPropertyDescriptor(base, "instance")?.get).toBeTypeOf("function");
});

test("a defect during decode propagates instead of becoming a validation issue", () => {
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
