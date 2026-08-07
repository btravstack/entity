import { Organization } from "@btravstack/entity-example-billing-domain";
import { expect, test } from "vitest";
import { z } from "zod";

import {
  createOrganizationSchema,
  organizationContract,
  organizationResponseSchema,
} from "./index.js";

const propertiesOf = (schema: unknown) =>
  Object.keys((schema as { properties: Record<string, unknown> }).properties).sort();

test("the create body drops whatever the domain generates", () => {
  // `id` and `createdAt` are `generated`, so no caller ever supplies them —
  // and nobody had to write an omit list saying so.
  expect(propertiesOf(createOrganizationSchema)).toEqual(["name", "slug"]);
});

test("the response body is the stored shape, computed field included", () => {
  expect(propertiesOf(organizationResponseSchema)).toEqual([
    "createdAt",
    "displayLabel",
    "id",
    "name",
    "slug",
  ]);
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

test("the contract exposes one procedure per route", () => {
  expect(Object.keys(organizationContract).sort()).toEqual(["create", "list", "update"]);
});
