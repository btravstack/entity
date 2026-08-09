---
title: HTTP contract example
description: Composing an entity's four plain ZodObjects into an oRPC contract and JSON Schema, with no hand-written omit lists.
---

# HTTP contract

[`examples/billing-api`](https://github.com/btravstack/entity/tree/main/examples/billing-api)
— turning an entity into request and response schemas for routes.

```sh
pnpm --filter @btravstack/entity-example-billing-api test
```

## The rule the package turns on

> **Contracts compose the four plain `ZodObject`s; domain code composes the
> class.**

```ts
export const CreateOrganizationBody = Organization.createInput;
export const UpdateOrganizationBody = Organization.updateInput;
export const OrganizationResponse = Organization.output;
```

There is nothing to maintain here. `createInput` is the field map minus every
field flagged `generated`; `updateInput` is it minus the ones flagged
`immutable` and minus the computed fields, every remaining key optional. Add a generated field to the
entity and the create body follows on its own — that is the omit list nobody had
to write, and the spec asserts it by checking the generated JSON Schema has
exactly `name` and `slug`.

They are ordinary `ZodObject`s, so the usual combinators work:

```ts
export const OrganizationSummary = Organization.output.pick({
  id: true,
  slug: true,
});
export const OrganizationListing = z.object({
  items: z.array(Organization.output),
  total: z.number().int(),
});
```

## Both directions

```ts
const converter = new ZodToJsonSchemaConverter();
converter.convert(Organization.createInput, "input");
converter.convert(Organization.output, "output");
```

Or through zod directly, with `z.toJSONSchema(…, { io: "input" | "output" })`.

## And the class, deliberately, does not

```ts
z.toJSONSchema(Organization, { io: "output" }); // throws, by design
```

The class carries a `.transform()` — it parses to an _instance_, not to plain
data — and a transforming schema has no output representation. That is the whole
reason the four plain `ZodObject`s exist separately, and the example's spec pins
it in both directions: the four convert, the class throws.

## One detail worth copying

The JSON Schema exports carry an explicit `JsonSchema` annotation:

```ts
export const createOrganizationSchema: JsonSchema = jsonSchemaOf(
  CreateOrganizationBody,
  "input",
);
```

Without it TypeScript infers a type it cannot **name** from outside the package,
and any consumer emitting declarations fails with `TS2883` — _"cannot be named
without a reference to 'JsonSchema' … this is likely not portable"_. It is the
same class of problem as [#31](https://github.com/btravstack/entity/issues/31)
and [#32](https://github.com/btravstack/entity/issues/32), met from the other
side of the boundary, and the cure is the same: give the type a name.

Related how-to: [Expose an HTTP contract](/how-to/http-contract).
