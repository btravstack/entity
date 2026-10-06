import {
  DisplayName,
  Organization,
  Slug,
  createOrganization,
} from "@btravstack/entity-example-billing-domain";
import { expect, test } from "vitest";
import { z } from "zod";

import {
  CreateOrganizationBody,
  RenameOrganizationBody,
  createOrganizationSchema,
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
  createOrganization({ slug: Slug.parse("acme"), name: DisplayName.parse("Acme SA") })
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
