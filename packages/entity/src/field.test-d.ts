import { test } from "vitest";
import { z } from "zod";

import { Entity } from "./index.js";

const Id = z.uuid().brand("Id");
const Slug = z.string().min(1).brand("Slug");

test("flags are extracted precisely", () => {
  class Org extends Entity("Org")({
    id: Entity.field(Id, { generated: true, immutable: true }),
    slug: Entity.field(Slug, { immutable: true }),
    name: z.string().min(1).brand("Name"),
  }) {}
  const org = Org.make({}).getOrThrow();
  // instance data type unwraps to the schema's output — bare or flagged alike
  const s: z.infer<typeof Slug> = org.slug;
  void s;
  // @ts-expect-error `slug` is immutable-flagged — not patchable
  org.update({ slug: org.slug });
  org.update({ name: org.name });
  const create = Org.factory({ id: () => crypto.randomUUID() });
  void create;
  // @ts-expect-error `slug` is not generated — the factory must not accept a generator for it
  Org.factory({ id: () => "", slug: () => "" });
});

test("an unbranded schema is rejected inside Entity.field too", () => {
  // @ts-expect-error same named rejection as a bare unbranded field
  Entity.field(z.string(), { immutable: true });
});

test("the removed options are gone", () => {
  // @ts-expect-error `generated` is no longer an option — flag the field instead
  Entity("Gone")({ id: Id }, { generated: ["id"] });
  // @ts-expect-error `immutable` is no longer an option — flag the field instead
  Entity("Gone2")({ id: Id }, { immutable: ["id"] });
});
