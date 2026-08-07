/**
 * The rule this package exists to show:
 * **contracts compose the four plain `ZodObject`s; domain code composes the class.**
 *
 * `Organization.createInput` / `.updateInput` / `.input` / `.output` are
 * ordinary `ZodObject`s derived from one field map, so they convert to JSON
 * Schema in both directions and need no hand-written omit lists. The class
 * itself deliberately does not convert — it parses to an *instance*, and a
 * transforming schema has no output representation.
 */
import { Organization } from "@btravstack/entity-example-billing-domain";
import { oc } from "@orpc/contract";
import type { JsonSchema } from "@orpc/json-schema";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { z } from "zod";

/* ── The request and response shapes ───────────────────────────────────
   Nothing to maintain here. `createInput` is the field map minus whatever
   the entity declares `generated`; `updateInput` is it minus `immutable`
   and minus the computed fields, every remaining key optional. Add a
   generated field to the entity and the create body follows on its own. */

export const CreateOrganizationBody = Organization.createInput;
export const UpdateOrganizationBody = Organization.updateInput;
export const OrganizationResponse = Organization.output;

/** They are ordinary `ZodObject`s, so the usual combinators work. */
export const OrganizationSummary = Organization.output.pick({ id: true, slug: true });
export const OrganizationListing = z.object({
  items: z.array(Organization.output),
  total: z.number().int(),
});

/* ── JSON Schema, in both directions ───────────────────────────────────
   `convert` returns `[jsonSchema, optional]`. The explicit `JsonSchema`
   annotation is load bearing rather than decorative: without it TypeScript
   infers a type it cannot *name* from outside this package, and any consumer
   emitting declarations fails with `TS2883` — "cannot be named without a
   reference to 'JsonSchema' … this is likely not portable". Exactly the class
   of problem behind issues #31 and #32, met from the other side; the cure
   here is simply to name the type.                                        */

const converter = new ZodToJsonSchemaConverter();

const jsonSchemaOf = (
  schema: Parameters<typeof converter.convert>[0],
  direction: "input" | "output",
): JsonSchema => converter.convert(schema, direction)[0];

export const createOrganizationSchema: JsonSchema = jsonSchemaOf(CreateOrganizationBody, "input");
export const updateOrganizationSchema: JsonSchema = jsonSchemaOf(UpdateOrganizationBody, "input");
export const organizationResponseSchema: JsonSchema = jsonSchemaOf(OrganizationResponse, "output");

/* ── The contract ──────────────────────────────────────────────────────
   An oRPC procedure per route, each one taking the entity's own schemas.
   Nothing here restates the shape of an Organization.                    */

export const organizationContract = {
  create: oc.input(CreateOrganizationBody).output(OrganizationResponse),
  update: oc.input(UpdateOrganizationBody).output(OrganizationResponse),
  list: oc.output(OrganizationListing),
};
