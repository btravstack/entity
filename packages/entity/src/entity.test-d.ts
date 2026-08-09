import { test } from "vitest";
import { z } from "zod";

import { Entity } from "./index.js";

const OrgId = z.uuid().brand("OrgId");
const Slug = z.string().min(1).brand("Slug");

class Organization extends Entity("Organization")({ id: OrgId, slug: Slug }) {}

test("construction outside decode/make is sealed", () => {
  // @ts-expect-error the construction key cannot be named outside the module
  // oxlint-disable-next-line no-new
  new Organization({ id: "x", slug: "y" });
});

test("data fields are readonly at compile time", () => {
  const org = Organization.make({}).getOrThrow();
  // @ts-expect-error data is immutable
  org.slug = "other";
});

const Tag = z.string().min(1).brand("Tag");
const Address = z.object({ city: z.string(), lines: z.array(z.string()) }).brand("Address");
class Bag extends Entity("Bag")({ id: OrgId, tags: z.array(Tag), address: Address }) {}

test("data is readonly all the way down, not just at the top level", () => {
  const bag = Bag.make({}).getOrThrow();

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
  const org = Organization.make({}).getOrThrow();
  // a naive DeepReadonly maps over `string & $brand<…>` and loses the
  // primitive, so this assignment is the regression guard for that
  const slug: z.infer<typeof Slug> = org.slug;
  // @ts-expect-error and it is still nominal — a bare string is not a Slug
  const wrong: z.infer<typeof Slug> = "acme";
  void slug;
  void wrong;
});

test("toJSON() is typed readonly all the way down — the projection is shallow", () => {
  const bag = Bag.make({}).getOrThrow();
  const state = bag.toJSON();
  // Only the top-level object is fresh: nested containers are the instance's
  // own frozen references, so `push` on one throws at runtime. Typing the
  // return as the plain mutable shape let that compile — measured, an ORM
  // mutating its argument hit `object is not extensible` where the types said
  // it could not happen.
  // @ts-expect-error a nested array is the frozen original
  state.tags.push("x" as z.infer<typeof Tag>);
  // @ts-expect-error a nested object's property is the frozen original's
  state.address.city = "Paris";
  // reading is untouched
  const city: string = state.address.city;
  void city;
});

test("toJSON() is the only projection — there is no second public spelling", () => {
  const bag = Bag.make({}).getOrThrow();
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
  const tag: "Organization" = Organization.make({}).getOrThrow()._tag;
  void tag;
});

test("the invariants parameter is contextually typed and branded", () => {
  Entity("Probe")(
    { id: OrgId, slug: Slug },
    {
      invariants: [
        Entity.invariant((d) => {
          // @ts-expect-error `nope` is not a field, so `d` is not `any`
          void d.nope;
          const slug: z.infer<typeof Slug> = d.slug;
          void slug;
          return true;
        }, "probe"),
        // the message function is contextually typed the same way
        Entity.invariant(
          () => true,
          (d) => {
            // @ts-expect-error `nope` is not a field, so `d` is not `any`
            void d.nope;
            return d.slug;
          },
        ),
      ],
    },
  );
});

test("an invariant sees the declared fields, never a computed one", () => {
  const Upper = z.string().brand("Upper");
  Entity("Derived")(
    { id: OrgId, slug: Slug },
    {
      computed: {
        shout: Entity.computed(Upper, (d) => d.slug.toUpperCase() as z.infer<typeof Upper>),
      },
      invariants: [
        Entity.invariant((d) => {
          // the declared fields are there, fully branded
          const slug: z.infer<typeof Slug> = d.slug;
          void slug;
          // @ts-expect-error a computed field is not visible to an invariant
          void d.shout;
          return true;
        }, "probe"),
      ],
    },
  );
});

test("computed's function is contextually typed and must return brands", () => {
  const Upper = z.string().brand("Upper");
  Entity("Probe2")(
    { id: OrgId, slug: Slug },
    {
      computed: {
        slugUpper: Entity.computed(Upper, (d) => {
          // @ts-expect-error `nope` is not a field, so `d` is not `any`
          void d.nope;
          // the declared fields are what a computed value derives from
          const s: z.infer<typeof Slug> = d.slug;
          void s;
          // @ts-expect-error a plain string is not Upper
          const bad: { slugUpper: z.infer<typeof Upper> } = { slugUpper: "x" };
          void bad;
          return "X" as z.infer<typeof Upper>;
        }),
      },
    },
  );
});

test("computed rejects an unbranded field", () => {
  // @ts-expect-error a bare string is not a domain field
  Entity.computed(z.string(), () => "x");
});

test("create rejects a generated field and update rejects an immutable one", () => {
  const Instant = z.iso.datetime().brand("Instant");
  class Org extends Entity("Org")(
    { id: OrgId, slug: Slug, createdAt: Instant },
    { generated: ["id", "createdAt"], immutable: ["id", "createdAt"] },
  ) {}

  const createOrg = Org.factory({ id: () => "x" as never, createdAt: () => "t" as never });
  // @ts-expect-error `id` is generated by the domain, not supplied by the caller
  createOrg({ slug: "s" as never, id: "x" as never });
  createOrg({ slug: "s" as never });

  const org = Org.make({}).getOrThrow();
  // @ts-expect-error `id` is immutable
  org.update({ id: "x" as never });
  org.update({ slug: "ok" as never });
});

test("factory generators are functions, and must cover exactly the generated fields", () => {
  const Instant = z.iso.datetime().brand("Instant");
  class Org extends Entity("Org")(
    { id: OrgId, slug: Slug, createdAt: Instant },
    { generated: ["id", "createdAt"], immutable: ["id"] },
  ) {}

  // `as never` would defeat every assertion below — it is assignable to any
  // type, including a function — so these use real branded values.
  const id = "0199b1f4-1b1e-7000-8000-000000000000" as z.infer<typeof OrgId>;
  const at = "2026-08-06T09:00:00Z" as z.infer<typeof Instant>;
  const slug = "s" as z.infer<typeof Slug>;

  Org.factory({ id: () => id, createdAt: () => at });

  // @ts-expect-error a plain value is not a generator — it would be shared by every create
  Org.factory({ id, createdAt: () => at });

  // @ts-expect-error `slug` is not a generated field
  Org.factory({ id: () => id, createdAt: () => at, slug: () => slug });

  // @ts-expect-error every generated field needs a generator
  Org.factory({ id: () => id });

  // @ts-expect-error a sync generator is not a promise-returning one
  Org.factoryAsync({ id: () => id, createdAt: () => at });

  Org.factoryAsync({ id: () => Promise.resolve(id), createdAt: () => Promise.resolve(at) });
});

test("a computed field is immutable without being declared immutable", () => {
  const Upper = z.string().brand("Upper");
  class Org extends Entity("Org")(
    { id: OrgId, slug: Slug },
    {
      computed: {
        slugUpper: Entity.computed(Upper, (d) => d.slug.toUpperCase() as z.infer<typeof Upper>),
      },
    },
  ) {}

  const org = Org.make({}).getOrThrow();
  // @ts-expect-error `slugUpper` is computed, so it is implicitly
  // immutable — patching it would let a caller contradict its own source
  org.update({ slugUpper: "LIES" as never });
  org.update({ slug: "ok" as never });

  // and it is gone from `updateInput` too, so the request schema agrees with
  // the patch type; reading the key back is a compile error (TS2339)
  // @ts-expect-error `slugUpper` is not part of the update request schema
  void Org.updateInput.shape.slugUpper;
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
  const org = UpdateTestOrg.make({}).getOrThrow();
  const updated = org.update({ slug: "new" as z.infer<typeof Slug> }).getOrThrow();
  // Both class-body method and _tag must be accessible on the result,
  // proving update() preserves the subclass type and not just the base shape
  const method: string = updated.shout();
  const tag: "UpdateTestOrg" = updated._tag;
  void method;
  void tag;
});

test("an entity is final: extend lives on an abstract root", () => {
  class Final extends Entity("Final")({ id: z.uuid().brand("FinalId") }) {}
  // A concrete entity cannot carry behaviour into an extension at the type
  // level — `"Final" & "Extended"` reduces to `never` (TS2509) — and a runtime
  // that carried what the type did not would be worse than not carrying it.
  // @ts-expect-error
  Final.extend("Extended")({});
});

test("producers are castless: from and generators take the schema's input", () => {
  const Upper = z.string().min(1).brand("Upper");
  const StampId = z.uuid().brand("StampId");

  // a computed derivation needs no cast — its value is parsed on every
  // construction path, so the type asks for the schema's input
  class Shouty extends Entity("Shouty")(
    { id: StampId, name: Slug },
    {
      computed: {
        shout: Entity.computed(Upper, (d) => d.name.toUpperCase()),
      },
    },
  ) {}

  // a generator needs no cast either — its value goes through make
  const createShouty = Shouty.factory({});
  void createShouty;
  class Stamped extends Entity("Stamped")({ id: StampId, name: Slug }, { generated: ["id"] }) {}
  const createStamped = Stamped.factory({
    id: () => crypto.randomUUID(),
  });
  void createStamped;

  // the tie to the field's own schema survives the loosening
  class Wrong extends Entity("Wrong")(
    { id: StampId, name: Slug },
    {
      computed: {
        // @ts-expect-error a number is not the input of a string schema
        shout: Entity.computed(Upper, (d) => d.name.length),
      },
    },
  ) {}
  void Wrong;

  // back-compat: a branded (cast) return still assigns — brand ⊂ input
  class Legacy extends Entity("Legacy")(
    { id: StampId, name: Slug },
    {
      computed: {
        shout: Entity.computed(Upper, (d) => d.name.toUpperCase() as z.infer<typeof Upper>),
      },
    },
  ) {}
  void Legacy;
});

test("the helper types name each shape", () => {
  const Instant = z.iso.datetime().brand("Instant");
  class Org extends Entity("Org")(
    { id: OrgId, slug: Slug, createdAt: Instant },
    { generated: ["id", "createdAt"], immutable: ["id", "createdAt"] },
  ) {}

  const wire: Entity.Input<typeof Org> = {
    id: "x" as z.infer<typeof OrgId>,
    slug: "s" as z.infer<typeof Slug>,
    createdAt: "t" as z.infer<typeof Instant>,
  };
  const state: Entity.Output<typeof Org> = wire;
  const created: Entity.CreateInput<typeof Org> = { slug: "s" as z.infer<typeof Slug> };
  const patch: Entity.Patch<typeof Org> = { slug: "s" as z.infer<typeof Slug> };
  void wire;
  void state;
  void created;
  void patch;
});
