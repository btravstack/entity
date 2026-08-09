import { P } from "unthrown";
import { expect, test } from "vitest";
import { z } from "zod";

import { Entity } from "./index.js";

const Id = z.uuid().brand("Id");
const Slug = z.string().min(1).brand("Slug");
const Name = z.string().min(1).brand("Name");

class Organization extends Entity("Organization")({
  id: Entity.field(Id, { generated: true, immutable: true }),
  slug: Entity.field(Slug, { immutable: true }),
  name: Name,
}) {}

const id = "0199b1f4-1b1e-7000-8000-000000000000";

test("flags derive createInput and updateInput", () => {
  expect(Object.keys(Organization.createInput.shape).toSorted()).toEqual(["name", "slug"]);
  expect(Object.keys(Organization.updateInput.shape).toSorted()).toEqual(["name"]);
});

test("a flagged field still parses and freezes like a bare one", () => {
  const org = Organization.make({ id, slug: "acme", name: "Acme" }).getOrThrow();
  expect(org.slug).toBe("acme");
  expect(Object.isFrozen(org)).toBe(false); // instance stays extensible, as pinned in entity.spec
});

test("update refuses an immutable-flagged key with the same message as before", () => {
  const org = Organization.make({ id, slug: "acme", name: "Acme" }).getOrThrow();
  const message = org.update({ slug: "other" } as never).match({
    ok: () => "WRONGLY ACCEPTED",
    errCases: (m) => m.with(P.tag("InvalidEntity"), (e) => e.issues[0]?.message ?? ""),
    defect: () => "defect",
  });
  expect(message).toBe("Immutable field — cannot be patched");
});

test("a factory demands exactly the generated-flagged keys", () => {
  const create = Organization.factory({ id: () => crypto.randomUUID() });
  const org = create({ slug: Slug.parse("acme"), name: Name.parse("Acme") }).getOrThrow();
  expect(org.id).toMatch(/^[0-9a-f-]{36}$/);
});

test("an entity class is still a legal flagged field, yielding real instances", () => {
  class Wrapper extends Entity("Wrapper")({
    id: Entity.field(Id, { generated: true }),
    owner: Entity.field(Organization, { immutable: true }),
  }) {}
  const w = Wrapper.make({ id, owner: { id, slug: "acme", name: "Acme" } }).getOrThrow();
  expect(w.owner).toBeInstanceOf(Organization);
});
