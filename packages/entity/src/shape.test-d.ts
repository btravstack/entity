import { assertType, describe, test } from "vitest";
import { z } from "zod";

import { Entity } from "./index.js";
import { shape } from "./shape.js";

describe("shape() rejects unbranded scalars", () => {
  const Id = z.uuid().brand("Id");
  const Name = z.string().min(1).brand("Name");
  const Slug = z
    .string()
    .regex(/^[a-z0-9-]{3,40}$/u)
    .brand("Slug");
  const DisplayName = z.string().min(1).max(80).brand("DisplayName");

  test("a fully branded shape compiles", () => {
    const ok = shape({ id: Id, slug: Slug, name: DisplayName, active: z.boolean() });
    assertType<z.ZodObject<{ id: typeof Id }>>(ok as never);
  });

  test("z.boolean() compiles", () => {
    shape({ id: Id, active: z.boolean() });
  });

  test("z.enum(...) compiles", () => {
    shape({ id: Id, status: z.enum(["active", "inactive"]) });
  });

  test("an optional branded scalar compiles", () => {
    shape({ id: Id, slug: Slug.optional() });
  });

  test("an optional z.enum(...) compiles", () => {
    shape({ id: Id, status: z.enum(["active", "inactive"]).optional() });
  });

  test("an array of branded scalars compiles", () => {
    shape({ id: Id, tags: z.array(Slug) });
  });

  test("bare z.string() does not compile", () => {
    // @ts-expect-error bare z.string() is not branded
    shape({ id: Id, name: z.string() });
  });

  test("bare z.number() does not compile", () => {
    // @ts-expect-error bare z.number() is not branded
    shape({ id: Id, seats: z.number() });
  });

  test("z.uuid() is still a string and does not compile", () => {
    // @ts-expect-error a UUID is not branded
    shape({ id: z.uuid() });
  });

  test("an array of bare strings does not compile", () => {
    // @ts-expect-error array elements must be nominal too
    shape({ id: Id, tags: z.array(z.string()) });
  });

  test("a nested z.object(...) does not compile", () => {
    // @ts-expect-error nested objects are not a nominal scalar
    shape({ id: Id, address: z.object({ city: z.string() }) });
  });

  test("branded ids are not interchangeable", () => {
    const UserId = z.uuid().brand("UserId");
    type OrgId = z.infer<typeof Id>;
    // @ts-expect-error UserId is not an Id
    const wrong: OrgId = null as unknown as z.infer<typeof UserId>;
    void wrong;
  });

  test("another entity class is a valid field", () => {
    class Customer extends Entity("Customer")({ id: Id, name: Name }) {}
    shape({ id: Id, customer: Customer });
    shape({ id: Id, watchers: z.array(Customer) });
  });

  test("a nested entity keeps its behaviour and tag through the field", () => {
    class Customer extends Entity("Customer")({ id: Id, name: Name }) {}
    class Order extends Entity("Order")({ id: Id, customer: Customer }) {}
    const order = Order.make({}).getOrThrow();
    const tag: "Customer" = order.customer._tag;
    const name: z.infer<typeof Name> = order.customer.name;
    void tag;
    void name;
    // @ts-expect-error a nested entity's data is still read-only
    order.customer.name = name;
  });

  test("a field may not take a name the entity installs on every instance", () => {
    // @ts-expect-error `update` would shadow the prototype method
    shape({ id: Id, update: Name });
    // @ts-expect-error `equals` would shadow the prototype method
    shape({ id: Id, equals: Name });
    // @ts-expect-error `toJSON` would shadow the projection
    shape({ id: Id, toJSON: Name });
    // @ts-expect-error `_tag` is the runtime tag
    shape({ id: Id, _tag: Name });
  });

  test("names that merely resemble reserved ones are fine", () => {
    shape({ id: Id, updatedAt: Name, equality: Name, tag: Name, json: Name });
  });
});

describe("an unbranded leaf opts out of the rule, one field at a time (#73)", () => {
  const Id = z.uuid().brand("Id");
  const Plain = z.string().min(1);

  test("a plain descriptive leaf compiles without a cast", () => {
    shape({ id: Id, label: Entity.field(Plain, { unbranded: true }) });
    shape({ id: Id, note: Entity.field(Plain.optional(), { unbranded: true }) });
    shape({ id: Id, tags: Entity.field(z.array(Plain), { unbranded: true }) });
    shape({ id: Id, label: Entity.field(Plain, { unbranded: true, immutable: true }) });
  });

  test("its output is the plain type, so a consumer constructs it with no brand", () => {
    class Mission extends Entity("Mission")({
      id: Id,
      label: Entity.field(Plain, { unbranded: true }),
    }) {}
    const label: Entity.Output<typeof Mission>["label"] = "any string at all";
    void label;
    // the opted-out leaf takes a plain string; the id beside it still does not
    // @ts-expect-error a meaningful id keeps its brand
    const id: Entity.Output<typeof Mission>["id"] = "0199b1f4-1b1e-7000-8000-000000000000";
    void id;
  });

  test("the opt-out is per field: a sibling is still checked", () => {
    shape({
      id: Id,
      label: Entity.field(Plain, { unbranded: true }),
      // @ts-expect-error the flag on `label` does not relax `name`
      name: Plain,
    });
  });

  test("only `true` opts out", () => {
    // @ts-expect-error `unbranded: false` is the default, not an opt-out
    shape({ id: Id, label: Entity.field(Plain, { unbranded: false }) });
    const flag: boolean = true as boolean;
    // @ts-expect-error a widened boolean could be either, so it is rejected like the other flags
    Entity.field(Plain, { unbranded: flag });
  });

  test("a misspelled flag is still a compile error", () => {
    // @ts-expect-error `unbraned` is not a flag
    Entity.field(Plain, { unbraned: true });
  });
});
