import { test } from "vitest";
import { z } from "zod";

import { Entity, add, type CreateInput, type Decoded, type Encoded, type Patch } from "./index.js";

const OrgId = z.uuid().brand("OrgId");
const Slug = z.string().min(1).brand("Slug");

class Organization extends Entity("Organization")({ id: OrgId, slug: Slug }) {}

test("construction outside decode/make is sealed", () => {
  // @ts-expect-error the construction key cannot be named outside the module
  // oxlint-disable-next-line no-new
  new Organization({ id: "x", slug: "y" });
});

test("data fields are readonly at compile time", () => {
  const org = Organization.decode({}).getOrThrow();
  // @ts-expect-error data is immutable
  org.slug = "other";
});

const Tag = z.string().min(1).brand("Tag");
const Address = z.object({ city: z.string(), lines: z.array(z.string()) }).brand("Address");
class Bag extends Entity("Bag")({ id: OrgId, tags: z.array(Tag), address: Address }) {}

test("data is readonly all the way down, not just at the top level", () => {
  const bag = Bag.decode({}).getOrThrow();

  // @ts-expect-error an array field is `readonly Tag[]`, so it has no `push`
  bag.tags.push("x" as z.infer<typeof Tag>);
  // @ts-expect-error nor an index it can be assigned through
  bag.tags[0] = "x" as z.infer<typeof Tag>;
  // @ts-expect-error a nested object's properties are readonly too
  bag.address.city = "Paris";
  // @ts-expect-error including an array nested inside that object
  bag.address.lines.push("floor 2");

  // reading is untouched
  const first: z.infer<typeof Tag> | undefined = bag.tags[0];
  const city: string = bag.address.city;
  void first;
  void city;
});

test("a branded field survives DeepReadonly with its brand intact", () => {
  const org = Organization.decode({}).getOrThrow();
  // a naive DeepReadonly maps over `string & $brand<…>` and loses the
  // primitive, so this assignment is the regression guard for that
  const slug: z.infer<typeof Slug> = org.slug;
  // @ts-expect-error and it is still nominal — a bare string is not a Slug
  const wrong: z.infer<typeof Slug> = "acme";
  void slug;
  void wrong;
});

test("toJSON() returns the plain, mutable decoded shape", () => {
  const bag = Bag.decode({}).getOrThrow();
  // toJSON() builds a fresh object, so its own keys stay assignable —
  // DeepReadonly applies to the instance's fields, not to this projection
  const state: Decoded<typeof Bag> = bag.toJSON();
  state.tags = [];
});

test("toJSON() is the only projection — there is no second public spelling", () => {
  const bag = Bag.decode({}).getOrThrow();
  // @ts-expect-error `encode()` was removed; `toJSON()` is the one projection
  bag.encode();
});

test("updateInput.shape is a precise mapped type, not an index signature", () => {
  // under this repo's `noPropertyAccessFromIndexSignature`, this would be a
  // compile error (TS4111) if `updateInput`'s shape were the generic
  // `Fields` index signature rather than a named-key mapped type
  const slugSchema = Organization.updateInput.shape.slug;
  void slugSchema;
});

test("unbranded fields are rejected", () => {
  // @ts-expect-error a bare string is not a domain field
  Entity("Bad")({ id: OrgId, plain: z.string() });
});

test("the tag is a literal, not a wide string", () => {
  const tag: "Organization" = Organization.decode({}).getOrThrow()._tag;
  void tag;
});

test("the invariants parameter is contextually typed and branded", () => {
  Entity("Probe")(
    { id: OrgId, slug: Slug },
    {
      invariants: (d) => {
        // @ts-expect-error `nope` is not a field, so `d` is not `any`
        void d.nope;
        const slug: z.infer<typeof Slug> = d.slug;
        void slug;
        return [];
      },
    },
  );
});

test("add's function is contextually typed and must return brands", () => {
  const Secret = z.string().brand("Secret");
  const Fingerprint = z.string().brand("Fingerprint");
  Entity("Probe2")(
    { id: OrgId, secret: Secret },
    {
      decoded: {
        omit: ["secret"],
        add: add({ fingerprint: Fingerprint })((e) => {
          // @ts-expect-error `nope` is not a field, so `e` is not `any`
          void e.nope;
          // an omitted field is still visible here — it is input-only, not absent
          const s: z.infer<typeof Secret> = e.secret;
          void s;
          // @ts-expect-error a plain string is not Fingerprint
          const bad: { fingerprint: z.infer<typeof Fingerprint> } = { fingerprint: "x" };
          void bad;
          return { fingerprint: "x" as z.infer<typeof Fingerprint> };
        }),
      },
    },
  );
});

test("add rejects an unbranded computed field", () => {
  // @ts-expect-error a bare string is not a domain field
  add({ label: z.string() })(() => ({ label: "x" }));
});

test("create rejects a generated field and update rejects an immutable one", () => {
  const Instant = z.iso.datetime().brand("Instant");
  class Org extends Entity("Org")(
    { id: OrgId, slug: Slug, createdAt: Instant },
    { generated: ["id", "createdAt"], immutable: ["id", "createdAt"] },
  ) {}

  const generatedFields = { id: "x" as never, createdAt: "t" as never };
  // @ts-expect-error `id` is generated by the domain, not supplied by the caller
  Org.create({ slug: "s" as never, id: "x" as never }, generatedFields);

  const org = Org.make({}).getOrThrow();
  // @ts-expect-error `id` is immutable
  org.update({ id: "x" as never });
  org.update({ slug: "ok" as never });
});

test("a misspelled immutable key is a compile error, not a silently-mutable field", () => {
  // @ts-expect-error "slugg" is not a key of the decoded shape — a typo here
  // must not compile, or the misspelled field is mutable by accident
  Entity("Probe3")({ id: OrgId, slug: Slug }, { immutable: ["slugg"] });
});

test("update() preserves the subclass type and its methods", () => {
  class UpdateTestOrg extends Entity("UpdateTestOrg")({ id: OrgId, slug: Slug }) {
    shout() {
      return this.slug.toUpperCase();
    }
  }
  const org = UpdateTestOrg.decode({}).getOrThrow();
  const updated = org.update({ slug: "new" as z.infer<typeof Slug> }).getOrThrow();
  // Both class-body method and _tag must be accessible on the result,
  // proving update() preserves the subclass type and not just the base shape
  const method: string = updated.shout();
  const tag: "UpdateTestOrg" = updated._tag;
  void method;
  void tag;
});

test("the helper types name each shape", () => {
  const Instant = z.iso.datetime().brand("Instant");
  class Org extends Entity("Org")(
    { id: OrgId, slug: Slug, createdAt: Instant },
    { generated: ["id", "createdAt"], immutable: ["id", "createdAt"] },
  ) {}

  const wire: Encoded<typeof Org> = {
    id: "x" as z.infer<typeof OrgId>,
    slug: "s" as z.infer<typeof Slug>,
    createdAt: "t" as z.infer<typeof Instant>,
  };
  const state: Decoded<typeof Org> = wire;
  const created: CreateInput<typeof Org> = { slug: "s" as z.infer<typeof Slug> };
  const patch: Patch<typeof Org> = { slug: "s" as z.infer<typeof Slug> };
  void wire;
  void state;
  void created;
  void patch;
});
