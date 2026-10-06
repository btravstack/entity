/**
 * The rule this package exists to show:
 * **contracts compose the four plain `ZodObject`s; domain code composes the class.**
 *
 * `Organization.createInput` / `.updateInput` / `.input` / `.output` are
 * building blocks, not contracts. `output` is the *stored* shape, internal
 * fields included, and `updateInput` is everything the *domain* lets change,
 * whoever is asking. A public contract is narrower than both, so every schema
 * below is selected from them by an explicit allowlist (`.pick`), never by an
 * omit list. An omit list goes stale the day the entity grows a field.
 */
import { Organization } from "@btravstack/entity-example-billing-domain";
import { oc } from "@orpc/contract";
import type { JsonSchema } from "@orpc/json-schema";
import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { z } from "zod";

/* ── The response: an allowlist, plus a mapping ────────────────────────
   `riskTier` is internal. It is in `Organization.output`, and it is not in
   this mask, so it never reaches a caller. A field the entity grows later
   is absent too, until someone adds it here on purpose.                   */

export const organizationPublicFields = {
  id: true,
  slug: true,
  name: true,
  displayLabel: true,
  createdAt: true,
} as const;

/**
 * The public representation is not the stored one: it drops `riskTier` and
 * adds `selfTitled`, which is class behaviour rather than stored state.
 * `.pick` cannot produce that, so the response has its own mapping.
 */
export const OrganizationResponse = Organization.output
  .pick(organizationPublicFields)
  .extend({ selfTitled: z.boolean() });
export type OrganizationResponse = z.output<typeof OrganizationResponse>;

/** Domain to response, field by field. Never `org.toJSON()`: that is the stored shape. */
export const toOrganizationResponse = (org: Organization): OrganizationResponse => ({
  id: org.id,
  slug: org.slug,
  name: org.name,
  displayLabel: org.displayLabel,
  createdAt: org.createdAt,
  selfTitled: org.isSelfTitled,
});

export const OrganizationListing = z.object({
  items: z.array(OrganizationResponse),
  total: z.number().int(),
});

/* ── Commands: one per operation, accepting only their own keys ────────
   `Organization.updateInput` accepts `riskTier`, because the domain lets the
   credit team change it. That is mutability, not authorization: a customer
   renaming their organization must not be able to set it in passing. So
   each command picks its keys and is `.strict()`, which rejects any other
   key rather than silently stripping it.                                  */

export const CreateOrganizationBody = Organization.createInput
  .pick({ slug: true, name: true })
  .strict();

export const RenameOrganizationBody = Organization.output.pick({ id: true, name: true }).strict();

/** The command becomes a patch explicitly, so it can only ever change `name`. */
export const renameOrganization = (
  org: Organization,
  command: z.output<typeof RenameOrganizationBody>,
) => org.update({ name: command.name }).map(toOrganizationResponse);

/* ── JSON Schema, in both directions ───────────────────────────────────
   `convert` returns `[jsonSchema, optional]`. The explicit `JsonSchema`
   annotation is load bearing rather than decorative: without it TypeScript
   infers a type it cannot *name* from outside this package, and any consumer
   emitting declarations fails with `TS2883` — "cannot be named without a
   reference to 'JsonSchema' … this is likely not portable". Exactly the class
   of problem behind issues #31 and #32, met from the other side; the cure
   here is simply to name the type.

   These are plain JSON. Written to a file at build time, they are how a
   browser or a non-TypeScript client gets the contract without importing
   this module, which imports the entity and so `node:util`.               */

const converter = new ZodToJsonSchemaConverter();

const jsonSchemaOf = (
  schema: Parameters<typeof converter.convert>[0],
  direction: "input" | "output",
): JsonSchema => converter.convert(schema, direction)[0];

export const createOrganizationSchema: JsonSchema = jsonSchemaOf(CreateOrganizationBody, "input");
export const renameOrganizationSchema: JsonSchema = jsonSchemaOf(RenameOrganizationBody, "input");
export const organizationResponseSchema: JsonSchema = jsonSchemaOf(OrganizationResponse, "output");

/* ── The contract ──────────────────────────────────────────────────────
   An oRPC procedure per route, each taking the selected schemas above.
   Nothing here restates a field's type: every one comes from the entity. */

export const organizationContract = {
  create: oc.input(CreateOrganizationBody).output(OrganizationResponse),
  rename: oc.input(RenameOrganizationBody).output(OrganizationResponse),
  list: oc.output(OrganizationListing),
};
