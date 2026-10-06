/**
 * One small model, three ways: plain zod plus functions, this package, and
 * Effect's `Schema.Class` (effect 3.x). The docs page
 * `docs/explanation/compared.md` quotes these declarations, and every row of
 * its comparison table is a test below, so the page states measured behaviour.
 *
 * The model: a customer with a generated, immutable id, an email, a plan and a
 * seat count, under one cross-field rule (a free plan allows at most 3 seats).
 *
 * Nothing here is a benchmark, and nothing here claims a capability the other
 * two lack: each version is written the way its library documents it, and
 * where one needs a hand-written function the test says so.
 */
import { isDeepStrictEqual } from "node:util";

import { Entity } from "@btravstack/entity";
import { Either, Equal, JSONSchema, Schema } from "effect";
import { expect, test } from "vitest";
import { z } from "zod";

const raw = {
  id: "0199b1f4-1b1e-7000-8000-000000000000",
  email: "ada@example.com",
  plan: "free",
  seats: 2,
};
const tooManySeats = { ...raw, seats: 9 };
const nextId = () => "0199b1f4-1b1e-7000-8000-000000000001";

const FREE_SEAT_CAP = "a free plan allows at most 3 seats";

// ---------------------------------------------------------------------------
// 1. Plain zod plus functions
// ---------------------------------------------------------------------------

const CustomerId = z.uuid().brand("CustomerId");
const Email = z.email().brand("Email");
const Plan = z.enum(["free", "pro"]);
const Seats = z.number().int().positive().brand("Seats");

const withinFreeCap = (d: { plan: "free" | "pro"; seats: number }) =>
  d.plan !== "free" || d.seats <= 3;

// The shape stays separate from the refined schema: the request schemas below
// are derived from the shape, so the rule is attached once, here.
const PlainShape = z.object({ id: CustomerId, email: Email, plan: Plan, seats: Seats });
const PlainCustomer = PlainShape.refine(withinFreeCap, FREE_SEAT_CAP);
type PlainCustomer = Readonly<z.infer<typeof PlainShape>>;

const PlainCreateInput = PlainShape.omit({ id: true });
const PlainUpdateInput = PlainShape.omit({ id: true }).partial().strict();

const parsePlain = (data: unknown) => {
  const parsed = PlainCustomer.safeParse(data);
  if (parsed.success) Object.freeze(parsed.data);
  return parsed;
};
const createPlain = (input: unknown) => {
  const parsed = PlainCreateInput.safeParse(input);
  return parsed.success ? parsePlain({ ...parsed.data, id: nextId() }) : parsed;
};
const updatePlain = (customer: PlainCustomer, patch: unknown) => {
  const parsed = PlainUpdateInput.safeParse(patch);
  return parsed.success ? parsePlain({ ...customer, ...parsed.data }) : parsed;
};

// test fixture only: zod's throwing `parse` is fine where the input is known good
const plainFixture = (): PlainCustomer => Object.freeze(PlainCustomer.parse(raw));

// ---------------------------------------------------------------------------
// 2. @btravstack/entity
// ---------------------------------------------------------------------------

class Customer extends Entity("Customer")(
  {
    id: Entity.field(CustomerId, { generated: true, immutable: true }),
    email: Email,
    plan: Plan,
    seats: Seats,
  },
  {
    invariants: [
      Entity.invariant({
        code: "OVER_FREE_SEAT_CAP",
        ensure: withinFreeCap,
        message: FREE_SEAT_CAP,
      }),
    ],
  },
) {}

const createCustomer = Customer.factory({ id: () => CustomerId.parse(nextId()) });

// ---------------------------------------------------------------------------
// 3. Effect Schema.Class
// ---------------------------------------------------------------------------

class EffectCustomer extends Schema.Class<EffectCustomer>("Customer")(
  Schema.Struct({
    id: Schema.UUID.pipe(Schema.brand("CustomerId")),
    email: Schema.String.pipe(Schema.pattern(/^[^@\s]+@[^@\s]+$/), Schema.brand("Email")),
    plan: Schema.Literal("free", "pro"),
    seats: Schema.Int.pipe(Schema.positive(), Schema.brand("Seats")),
  }).pipe(Schema.filter((d) => withinFreeCap(d) || FREE_SEAT_CAP)),
) {}

const EffectCreateInput = Schema.Struct(EffectCustomer.fields).pipe(Schema.omit("id"));
const EffectUpdateInput = Schema.partial(EffectCreateInput);

const decodeEffect = Schema.decodeUnknownEither(EffectCustomer);
const createEffect = (input: unknown) =>
  Schema.decodeUnknownEither(EffectCreateInput)(input).pipe(
    Either.flatMap((fields) => decodeEffect({ ...fields, id: nextId() })),
  );
const updateEffect = (customer: EffectCustomer, patch: unknown) =>
  Schema.decodeUnknownEither(EffectUpdateInput, { onExcessProperty: "error" })(patch).pipe(
    Either.flatMap((fields) => decodeEffect({ ...customer, ...fields })),
  );

// ---------------------------------------------------------------------------
// Behaviour the three share
// ---------------------------------------------------------------------------

test("all three accept the same payload and reject the same invariant breach", () => {
  expect(parsePlain(raw).success).toBe(true);
  expect(parsePlain(tooManySeats).success).toBe(false);

  expect(Customer.make(raw).isOk()).toBe(true);
  expect(Customer.make(tooManySeats).isErr()).toBe(true);

  expect(Either.isRight(decodeEffect(raw))).toBe(true);
  expect(Either.isLeft(decodeEffect(tooManySeats))).toBe(true);
});

test("all three can generate the id rather than take it from the caller", () => {
  const { id: _ignored, ...input } = raw;

  expect(createPlain(input).data?.id).toBe(nextId());

  expect(createCustomer(input as never).getOrThrow().id).toBe(nextId());
  // the factory spreads generated fields last, so a smuggled id loses
  expect(createCustomer({ ...input, id: raw.id } as never).getOrThrow().id).toBe(nextId());

  expect(Either.getOrThrow(createEffect(input)).id).toBe(nextId());
});

test("all three refuse a patch to the id, at runtime", () => {
  const plain = plainFixture();
  expect(updatePlain(plain, { id: nextId() }).success).toBe(false);

  const entity = Customer.make(raw).getOrThrow();
  // a compile error first; the cast is how an untyped adapter would reach it
  expect(entity.update({ id: nextId() } as never).isErr()).toBe(true);

  const effect = Either.getOrThrow(decodeEffect(raw));
  expect(Either.isLeft(updateEffect(effect, { id: nextId() }))).toBe(true);
});

test("all three re-check the invariant on update", () => {
  const plain = plainFixture();
  expect(updatePlain(plain, { seats: 9 }).success).toBe(false);

  const entity = Customer.make(raw).getOrThrow();
  expect(entity.update({ seats: Seats.parse(9) }).isErr()).toBe(true);

  const effect = Either.getOrThrow(decodeEffect(raw));
  expect(Either.isLeft(updateEffect(effect, { seats: 9 }))).toBe(true);
});

test("all three yield the same create-request JSON Schema properties", () => {
  const props = (schema: unknown) =>
    Object.keys((schema as { properties: Record<string, unknown> }).properties).toSorted();
  const expected = ["email", "plan", "seats"];

  expect(props(z.toJSONSchema(PlainCreateInput, { io: "input" }))).toEqual(expected);
  expect(props(z.toJSONSchema(Customer.createInput, { io: "input" }))).toEqual(expected);
  expect(props(JSONSchema.make(EffectCreateInput))).toEqual(expected);
});

test("all three compare by value, each through its own function", () => {
  expect(isDeepStrictEqual(plainFixture(), plainFixture())).toBe(true);

  expect(Customer.make(raw).getOrThrow().equals(Customer.make(raw).getOrThrow())).toBe(true);

  const effectA = Either.getOrThrow(decodeEffect(raw));
  const effectB = Either.getOrThrow(decodeEffect(raw));
  expect(Equal.equals(effectA, effectB)).toBe(true);
});

// ---------------------------------------------------------------------------
// Where they differ, measured
// ---------------------------------------------------------------------------

test("assignment through a cast: entity and the frozen plain object throw, Effect accepts it", () => {
  const plain = plainFixture();
  expect(() => {
    (plain as unknown as Record<string, unknown>)["seats"] = 9;
  }).toThrow(TypeError);

  const entity = Customer.make(raw).getOrThrow();
  expect(() => {
    (entity as unknown as Record<string, unknown>)["seats"] = 9;
  }).toThrow(TypeError);

  // effect 3.22.2: the instance is not frozen; `readonly` is type-level there
  const effect = Either.getOrThrow(decodeEffect(raw));
  (effect as unknown as Record<string, unknown>)["seats"] = 9;
  expect(effect.seats).toBe(9);
});

test("the constructor: Effect validates at runtime, entity seals at the type level only", () => {
  // Effect's constructor is public and validates: invalid data throws
  expect(() => new EffectCustomer(tooManySeats as never)).toThrow();

  // @ts-expect-error -- `new` on an entity is a compile error (the seal)
  expect(() => new Customer(raw)).not.toThrow();

  // ...and the seal is ONLY a type: a cast reaches the constructor, which
  // validates nothing and runs no invariant. Not a runtime trust boundary.
  const Forge = Customer as unknown as new (d: unknown) => Customer;
  const forged = new Forge({ ...tooManySeats, email: "not an email" });
  expect(forged).toBeInstanceOf(Customer);
  expect(forged.seats).toBe(9);
});

test("the class as a schema: Effect's converts to JSON Schema, entity's does not", () => {
  expect(() => JSONSchema.make(EffectCustomer)).not.toThrow();
  // entity's class carries a transform; contracts use the four ZodObjects
  expect(() => z.toJSONSchema(Customer as never, { io: "output" })).toThrow();
  expect(() => z.toJSONSchema(Customer.output, { io: "output" })).not.toThrow();
});

// ---------------------------------------------------------------------------
// What entity's freeze does not cover, measured through an entity
// ---------------------------------------------------------------------------

const At = z.date().brand("At");
const Counts = z.map(z.string(), z.number()).brand("Counts");

class Snapshot extends Entity("Snapshot")({ id: CustomerId, at: At, counts: Counts }) {
  // class-body state is ordinary, writable, and outside toJSON/equals
  note = "";
}

test("a Date's timestamp, a Map's entries and class-body state stay mutable", () => {
  const snapshot = Snapshot.make({
    id: raw.id,
    at: new Date(0),
    counts: new Map([["a", 1]]),
  }).getOrThrow();

  snapshot.at.setTime(1);
  expect(snapshot.at.getTime()).toBe(1);

  snapshot.counts.set("b", 2);
  expect(snapshot.counts.size).toBe(2);

  snapshot.note = "scratch";
  expect(snapshot.toJSON()).not.toHaveProperty("note");
});
