import {
  LineLabel,
  Money,
  Organization,
  Slug,
  createOrganization,
} from "@btravstack/entity-example-billing-domain";
import {
  BillingParty,
  Order,
  OrderLine,
  Quantity,
  createCustomer,
  createOrderLine,
  openOrder,
} from "@btravstack/entity-example-billing-domain/order";
import { expect, test } from "vitest";
import { z } from "zod";

import {
  CreateOrganizationBody,
  OrganizationResponse,
  RenameOrganizationBody,
  OpenOrderBody,
  OrderResponse,
  createOrganizationSchema,
  openOrderSchema,
  orderContract,
  orderResponseSchema,
  organizationContract,
  organizationPublicFields,
  organizationResponseSchema,
  renameOrganization,
  renameOrganizationSchema,
  toOrganizationResponse,
} from "./index.js";

const propertiesOf = (schema: unknown) =>
  Object.keys((schema as { properties: Record<string, unknown> }).properties).sort();

const keysOf = (schema: z.ZodObject) => Object.keys(schema.shape).sort();

/** An organization the credit team has already assessed: the internal field is set. */
const watchlisted = () =>
  createOrganization({ slug: Slug.parse("acme"), name: "Acme SA" })
    .flatMap((org) => org.update({ riskTier: "WATCHLIST" }))
    .getOrThrow();

const publicKeys = ["createdAt", "displayLabel", "id", "name", "selfTitled", "slug"];

/* ── The response is an allowlist ─────────────────────────────────────── */

test("the internal field is stored, and absent from the public response", () => {
  const org = watchlisted();

  // It is real stored state: the persistence boundary keeps it.
  expect(org.toJSON().riskTier).toBe("WATCHLIST");

  const response = toOrganizationResponse(org);
  expect(Object.keys(response).sort()).toEqual(publicKeys);
  expect(JSON.stringify(response)).not.toContain("WATCHLIST");
  expect(propertiesOf(organizationResponseSchema)).toEqual(publicKeys);
});

test("another internal field does not widen the response", () => {
  // The entity grows a second internal field, the way models do.
  const grown = Organization.output.extend({ fraudNotes: z.string() });

  // An omit list has to be told about it, and nobody did:
  expect(keysOf(grown.omit({ riskTier: true }))).toContain("fraudNotes");
  // The allowlist does not need telling:
  expect(keysOf(grown.pick(organizationPublicFields))).toEqual(
    keysOf(Organization.output.pick(organizationPublicFields)),
  );
});

/* ── A command accepts only its own keys ──────────────────────────────── */

test("the domain may change riskTier; a public command may not set it", () => {
  // General mutability: the domain accepts it on create and on update…
  expect(
    Organization.createInput.safeParse({ slug: "acme", name: "Acme SA", riskTier: "STANDARD" })
      .success,
  ).toBe(true);
  expect(Organization.updateInput.safeParse({ riskTier: "BLOCKED" }).success).toBe(true);

  // …and that is not authorization. Each command rejects any key it did not pick.
  expect(
    CreateOrganizationBody.safeParse({ slug: "acme", name: "Acme SA", riskTier: "STANDARD" })
      .success,
  ).toBe(false);
  expect(
    RenameOrganizationBody.safeParse({
      id: "11111111-1111-4111-8111-111111111111",
      name: "Acme SAS",
      riskTier: "STANDARD",
    }).success,
  ).toBe(false);
});

test("each command's JSON Schema names exactly its keys and closes the object", () => {
  expect(propertiesOf(createOrganizationSchema)).toEqual(["name", "slug"]);
  expect(propertiesOf(renameOrganizationSchema)).toEqual(["id", "name"]);
  expect(createOrganizationSchema).toMatchObject({ additionalProperties: false });
  expect(renameOrganizationSchema).toMatchObject({ additionalProperties: false });
});

test("a rename changes the name and answers with the public response", () => {
  const org = watchlisted();
  const command = RenameOrganizationBody.parse({ id: org.id, name: "Acme SAS" });

  const response = renameOrganization(org, command).getOrThrow();
  expect(response.name).toBe("Acme SAS");
  expect(Object.keys(response).sort()).toEqual(publicKeys);
});

/* ── JSON Schema, and what does not convert ───────────────────────────── */

test("the JSON Schemas are plain data a client can take without this module", () => {
  for (const schema of [
    createOrganizationSchema,
    renameOrganizationSchema,
    organizationResponseSchema,
  ]) {
    expect(JSON.parse(JSON.stringify(schema))).toEqual(schema);
  }
});

test("the four ZodObjects convert in both directions", () => {
  expect(() => z.toJSONSchema(Organization.createInput, { io: "input" })).not.toThrow();
  expect(() => z.toJSONSchema(Organization.updateInput, { io: "input" })).not.toThrow();
  expect(() => z.toJSONSchema(Organization.input, { io: "input" })).not.toThrow();
  expect(() => z.toJSONSchema(Organization.output, { io: "output" })).not.toThrow();
});

test("the class itself does not convert — and that is the design", () => {
  // It carries a .transform(): it parses to an *instance*, not to plain data,
  // and a transforming schema has no output representation. That is exactly
  // why the four plain ZodObjects exist separately.
  expect(() => z.toJSONSchema(Organization, { io: "output" })).toThrow();
});

test("the contract exposes one procedure per operation", () => {
  expect(Object.keys(organizationContract).sort()).toEqual(["create", "list", "rename"]);
});

/* ── A consumer builds a response without minting meaningless brands ──── */

test("a consumer builds a response with a plain name, parsing only the real identifiers", () => {
  // The identifiers come through the contract's own schema, the way any client
  // parses at its boundary. `name` opted out of branding, so it is just a string.
  const identity = OrganizationResponse.pick({
    id: true,
    slug: true,
    createdAt: true,
    displayLabel: true,
  }).parse({
    id: "0199b1f4-1b1e-7000-8000-000000000000",
    slug: "acme",
    createdAt: "2026-08-06T09:00:00.000Z",
    displayLabel: "Acme SA (acme)",
  });
  const response: OrganizationResponse = { ...identity, name: "Acme SA", selfTitled: true };

  expect(OrganizationResponse.parse(response)).toEqual(response);
});

/* ── A nested aggregate converts too (#72) ────────────────────────────── */

type Json = { properties: Record<string, Json & { items: Json }> };

const placedOrder = () => {
  const buyer = createCustomer({
    billing: BillingParty.parse({ name: "Acme SA", address: "1 rue de la Paix, Paris" }),
  }).getOrThrow();
  return createOrderLine({
    label: LineLabel.parse("Widget"),
    unitPrice: Money.parse({ amount: 10_00, currency: "EUR" }),
    quantity: Quantity.parse(2),
  })
    .flatMap((line) => openOrder(buyer.id, "EUR").flatMap((draft) => draft.addLine(line)))
    .flatMap((draft) => draft.place(buyer))
    .getOrThrow();
};

test("every member of a nested aggregate converts in both directions", () => {
  for (const schema of [Order.input, Order.output, Order.createInput, Order.updateInput]) {
    for (const io of ["input", "output"] as const) {
      expect(() => z.toJSONSchema(schema, { io })).not.toThrow();
    }
  }
});

test("a request carries a line's input, a response its output", () => {
  const request = openOrderSchema as unknown as Json;
  const response = orderResponseSchema as unknown as Json;
  expect(propertiesOf(request.properties["lines"]?.items)).toEqual([
    "id",
    "label",
    "quantity",
    "unitPrice",
  ]);
  expect(propertiesOf(response.properties["lines"]?.items)).toEqual([
    "id",
    "label",
    "quantity",
    "subtotal",
    "unitPrice",
  ]);
  expect(propertiesOf(response)).toEqual(["currency", "id", "lines", "status", "total"]);
});

test("the serialised order parses as the response, minus what was not picked", () => {
  const placed = placedOrder();
  // the snapshot is internal: stored on the order, absent from the response
  expect(placed.billTo).toBeDefined();

  const response = OrderResponse.parse(JSON.parse(JSON.stringify(placed)));
  expect(response).not.toHaveProperty("billTo");
  expect(response.lines[0]).not.toBeInstanceOf(OrderLine);
  expect(response.lines[0]?.subtotal).toEqual({ amount: 20_00, currency: "EUR" });
});

test("a request body opens an order through make, nesting real lines", () => {
  const body = OpenOrderBody.parse({
    customerId: "0199b1f4-1b1e-7000-8000-000000000001",
    currency: "EUR",
    lines: [
      {
        id: "0199b1f4-1b1e-7000-8000-000000000002",
        label: "Widget",
        unitPrice: { amount: 10_00, currency: "EUR" },
        quantity: 1,
      },
    ],
  });
  const order = Order.make({ ...body, id: crypto.randomUUID(), status: "DRAFT" }).getOrThrow();
  expect(order.lines[0]).toBeInstanceOf(OrderLine);
  expect(Object.keys(orderContract)).toEqual(["open"]);
});
