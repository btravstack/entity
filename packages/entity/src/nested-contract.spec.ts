/**
 * The four derived schemas stay plain all the way down (#72).
 *
 * An entity field embeds the nested entity's own plain schema in each member —
 * its `input` where the parent member is input-like, its `output` (computed
 * fields included) in `output` — so `z.toJSONSchema` converts every member in
 * both directions at any depth. Construction still builds nested instances,
 * because `make` parses through an internal schema that keeps the classes.
 */
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { expect, test } from "vitest";
import { z } from "zod";

import { Entity } from "./index.js";

const LineId = z.uuid().brand("LineId");
const OrderId = z.uuid().brand("OrderId");
const ShipmentId = z.uuid().brand("ShipmentId");
const CustomerId = z.uuid().brand("CustomerId");
const Label = z.string().min(1).brand("Label");
const Quantity = z.number().int().positive().brand("Quantity");
const Email = z.email().brand("Email");
const Note = z.string().min(1).brand("Note");

class Line extends Entity("Line")(
  {
    id: Entity.field(LineId, { generated: true, immutable: true }),
    label: Label,
    quantity: Quantity,
  },
  { computed: { shout: Entity.computed(Label, (d) => d.label.toUpperCase()) } },
) {}

class Customer extends Entity("Customer")({ id: CustomerId, name: Label }) {}

class Personal extends Entity("Personal")({ kind: z.literal("personal"), email: Email }) {}
class Business extends Entity("Business")({ kind: z.literal("business"), vat: Label }) {}
const Payer = Entity.union("kind", [Personal, Business]);

/**
 * One of each nesting form: bare, flagged, array, optional, nullable, union.
 * `null` is not nominal, so the nullable field needs the brand rule's per-field
 * opt-out — the package models absence as `undefined`, and a nullable entity
 * field is the exception it has to be told about.
 */
class Order extends Entity("Order")({
  id: Entity.field(OrderId, { generated: true, immutable: true }),
  customer: Entity.field(Customer, { immutable: true }),
  lines: z.array(Line),
  backup: z.optional(Customer),
  previous: Entity.field(z.nullable(Customer), { unbranded: true }),
  payer: Payer,
  note: Note,
}) {}

/** A second level: an entity holding an entity holding entities. */
class Shipment extends Entity("Shipment")({ id: ShipmentId, order: Order }) {}

const uuid = (n: number) => `0199b1f4-1b1e-7000-8000-${String(n).padStart(12, "0")}`;

const orderRow = {
  id: uuid(1),
  customer: { id: uuid(2), name: "ada" },
  lines: [{ id: uuid(3), label: "pen", quantity: 2 }],
  previous: null,
  payer: { kind: "business", vat: "FR123" },
  note: "rush",
};

const members = (E: typeof Order | typeof Shipment) =>
  [
    ["input", E.input],
    ["output", E.output],
    ["createInput", E.createInput],
    ["updateInput", E.updateInput],
  ] as const;

type Json = {
  readonly type?: string;
  readonly properties?: Record<string, Json>;
  readonly items?: Json;
  readonly anyOf?: readonly Json[];
  readonly oneOf?: readonly Json[];
};

/** Follows `.optional()`/`.nullable()`'s `anyOf` to the object branch. */
const objectOf = (json: Json | undefined): Json | undefined =>
  json?.type === "object" ? json : json?.anyOf?.map(objectOf).find((j) => j !== undefined);

const keys = (json: Json | undefined) => Object.keys(objectOf(json)?.properties ?? {}).toSorted();

test("every member converts in both directions, one and two levels deep", () => {
  for (const E of [Order, Shipment]) {
    for (const [name, schema] of members(E)) {
      for (const io of ["input", "output"] as const) {
        expect(() => z.toJSONSchema(schema, { io }), `${E.entityName}.${name} ${io}`).not.toThrow();
      }
    }
  }
});

test("the oRPC converter accepts them too", () => {
  const converter = new ZodToJsonSchemaConverter();
  for (const [, schema] of members(Shipment)) {
    for (const io of ["input", "output"] as const) {
      expect(() => converter.convert(schema, io)).not.toThrow();
    }
  }
});

test("input-like members embed the nested input, output embeds the nested output", () => {
  const props = (s: z.ZodType) =>
    (z.toJSONSchema(s, { io: "input" }) as Json).properties as Record<string, Json>;

  // a nested computed field is stored state: in output, never in input
  expect(keys(props(Order.output)["lines"]?.items)).toEqual(["id", "label", "quantity", "shout"]);
  for (const s of [Order.input, Order.createInput, Order.updateInput]) {
    expect(keys(props(s)["lines"]?.items)).toEqual(["id", "label", "quantity"]);
  }
  expect(keys(props(Order.output)["customer"])).toEqual(["id", "name"]);
  expect(keys(props(Order.input)["backup"])).toEqual(["id", "name"]);
  expect(keys(props(Order.input)["previous"])).toEqual(["id", "name"]);
  // and at depth two, through the nested `Order`'s own plain output
  const order = props(Shipment.output)["order"];
  expect(keys(order?.properties?.["lines"]?.items)).toEqual(["id", "label", "quantity", "shout"]);
});

test("a union field becomes a discriminated union of its members' plain schemas", () => {
  const payer = (z.toJSONSchema(Order.output, { io: "output" }) as Json).properties?.["payer"];
  const branches = payer?.oneOf ?? payer?.anyOf ?? [];
  expect(branches.map((b) => keys(b))).toEqual([
    ["email", "kind"],
    ["kind", "vat"],
  ]);
});

test("the public members parse to plain data, never to instances", () => {
  const parsed = Order.output.parse(Order.make(orderRow).getOrThrow().toJSON());
  expect(parsed.lines[0]).not.toBeInstanceOf(Line);
  expect(parsed.customer).not.toBeInstanceOf(Customer);
  expect(parsed.payer).not.toBeInstanceOf(Business);
  expect(Object.getPrototypeOf(parsed.lines[0])).toBe(Object.prototype);
});

test("make still builds nested instances, through the internal schema", () => {
  const order = Order.make(orderRow).getOrThrow();
  expect(order.lines[0]).toBeInstanceOf(Line);
  expect(order.customer).toBeInstanceOf(Customer);
  expect(order.payer).toBeInstanceOf(Business);
  expect(order.previous).toBeNull();
  const shipment = Shipment.make({ id: uuid(9), order: orderRow }).getOrThrow();
  expect(shipment.order).toBeInstanceOf(Order);
  expect(shipment.order.lines[0]).toBeInstanceOf(Line);
});

test("update keeps nested instances too", () => {
  const order = Order.make(orderRow).getOrThrow();
  const updated = order.update({ note: "later" as z.output<typeof Note> }).getOrThrow();
  expect(updated.lines[0]).toBeInstanceOf(Line);
  expect(updated.payer).toBeInstanceOf(Business);
});

test("projection and encoding agree: output parses the serialised entity, and make round-trips it", () => {
  const shipment = Shipment.make({ id: uuid(9), order: orderRow }).getOrThrow();
  const wire: unknown = JSON.parse(JSON.stringify(shipment));

  const decoded = Shipment.output.parse(wire);
  expect(decoded).toEqual(wire);
  expect(decoded.order.lines[0]?.shout).toBe("PEN");

  const again = Shipment.make(decoded).getOrThrow();
  expect(again.order.lines[0]).toBeInstanceOf(Line);
  expect(JSON.parse(JSON.stringify(again))).toEqual(wire);
});

test("createInput and updateInput keep their own key rules over a nested field", () => {
  expect(Object.keys(Order.createInput.shape)).not.toContain("id");
  // `customer` is immutable, so a patch cannot carry it
  expect(Object.keys(Order.updateInput.shape).toSorted()).toEqual([
    "backup",
    "lines",
    "note",
    "payer",
    "previous",
  ]);
});

test("a schema with no nested entity is left as the very same object", () => {
  class Flat extends Entity("Flat")({ id: OrderId, labels: z.array(Label) }) {}
  expect(Flat.input.shape.labels).toBe(Flat.output.shape.labels);
});

/*
 * What a plain schema cannot say in JSON Schema. These are zod's own outcomes,
 * pinned so the reference page's table cannot drift from them: the package
 * invents no encoder, and a field holding one of these needs either a JSON-safe
 * spelling (an ISO string, a decimal string) or `unrepresentable: "any"`.
 */
test("Date, bigint and custom fields have no JSON Schema, in either direction", () => {
  const Stamp = z.date().brand("Stamp");
  const Cents = z.bigint().brand("Cents");
  const Blob = z.custom<Uint8Array>((v) => v instanceof Uint8Array).brand("Blob");
  for (const [name, schema] of [
    ["Date", Stamp],
    ["BigInt", Cents],
    ["Custom", Blob],
  ] as const) {
    class Holder extends Entity("Holder")({ id: OrderId, value: schema }) {}
    for (const io of ["input", "output"] as const) {
      expect(() => z.toJSONSchema(Holder.output, { io })).toThrow(name);
    }
    // the documented substitute: an unconstrained `{}` for that one property
    const json = z.toJSONSchema(Holder.output, { unrepresentable: "any" }) as Json;
    expect(json.properties?.["value"]).toEqual({});
  }
});

test("a transform converts for input and throws for output; a codec's output is its decoded side", () => {
  const Trimmed = z
    .string()
    .transform((s) => s.trim())
    .brand("Trimmed");
  const At = z
    .codec(z.iso.datetime(), z.date(), {
      decode: (s) => new Date(s),
      encode: (d) => d.toISOString(),
    })
    .brand("At");
  class Transformed extends Entity("Transformed")({ id: OrderId, name: Trimmed, at: At }) {}

  const input = z.toJSONSchema(Transformed.input, { io: "input" }) as Json;
  expect(input.properties?.["name"]?.type).toBe("string");
  expect(input.properties?.["at"]?.type).toBe("string");
  expect(() => z.toJSONSchema(Transformed.output, { io: "output" })).toThrow();
});

test("the class itself stays non-convertible, nested or not", () => {
  expect(() => z.toJSONSchema(Order as never, { io: "output" })).toThrow();
});
