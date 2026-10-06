---
title: HTTP contract example
description: Selecting an oRPC contract and JSON Schema from an entity's four plain ZodObjects by allowlist, with an internal field that never reaches the response.
---

# HTTP contract

[`examples/billing-api`](https://github.com/btravstack/entity/tree/main/examples/billing-api)
turns an entity into request and response schemas for routes, without exposing
what the domain keeps to itself.

```sh
pnpm --filter @btravstack/entity-example-billing-api test
```

## The rule the package turns on

> **Contracts compose the four plain `ZodObject`s; domain code composes the
> class.**

The four are building blocks, not the contract. `Organization` carries
`riskTier`, which the credit team sets and no customer may see. It is in
`Organization.output`, the stored shape, and in `Organization.updateInput`,
because the domain lets it change. A public route therefore uses neither as
is.

## The response is an allowlist

```ts
export const organizationPublicFields = {
  id: true,
  slug: true,
  name: true,
  displayLabel: true,
  createdAt: true,
} as const;

export const OrganizationResponse = Organization.output
  .pick(organizationPublicFields)
  .extend({ selfTitled: z.boolean() });
```

`riskTier` is not in the mask, so it is not in the response. The spec proves it
on an organization whose `riskTier` is set: the stored row carries it, the
response and its JSON Schema do not.

It also proves the property that makes this an allowlist rather than an omit
list. It grows `Organization.output` by a second internal field: the omit-list
version picks the new field up, the allowlist's keys do not change.

## The stored and public shapes differ, so there is a mapping

`selfTitled` is class behaviour, not stored state, so `.pick` alone cannot
produce the response. A mapping does, field by field:

```ts
export const toOrganizationResponse = (
  org: Organization,
): OrganizationResponse => ({
  id: org.id,
  slug: org.slug,
  name: org.name,
  displayLabel: org.displayLabel,
  createdAt: org.createdAt,
  selfTitled: org.isSelfTitled,
});
```

Never `org.toJSON()`: that is the stored shape, and the right thing to hand
[the persistence example](/examples/billing-persistence), a boundary coupled to
the domain on purpose.

## Each command accepts only its own keys

```ts
export const CreateOrganizationBody = Organization.createInput
  .pick({ slug: true, name: true })
  .strict();

export const RenameOrganizationBody = Organization.output
  .pick({ id: true, name: true })
  .strict();

export const renameOrganization = (
  org: Organization,
  command: z.output<typeof RenameOrganizationBody>,
) => org.update({ name: command.name }).map(toOrganizationResponse);
```

The spec shows the difference between mutability and authorization:
`Organization.createInput` and `Organization.updateInput` accept `riskTier`,
while both commands reject it. `.strict()` turns a smuggled key into a
validation error rather than a silent strip, and the JSON Schemas say so with
`additionalProperties: false`. Whether a caller may rename _this_ organization
is the handler's check, not the entity's.

## Both directions

```ts
const converter = new ZodToJsonSchemaConverter();
converter.convert(CreateOrganizationBody, "input");
converter.convert(OrganizationResponse, "output");
```

Or through zod directly, with `z.toJSONSchema(…, { io: "input" | "output" })`.

The converted schemas are plain JSON, and the spec checks they survive a
`JSON.stringify` round trip. That is how a client gets this contract without
depending on the domain module: it takes the JSON Schema files, or a zod-only
module, instead. The how-to's section on
[sharing the contract with a browser](/how-to/http-contract#share-the-contract-with-a-browser)
covers both.

## And the class, deliberately, does not

```ts
z.toJSONSchema(Organization, { io: "output" }); // throws, by design
```

The class carries a `.transform()`: it parses to an _instance_, not to plain
data, and a transforming schema has no output representation. That is the
whole reason the four plain `ZodObject`s exist separately, and the example's
spec pins it in both directions: the four convert, the class throws.

## A client builds a response without the domain's vocabulary

The response's `name` is a plain string, because the entity declares it
`unbranded`. A client, or a test building a fixture, parses the identifiers
through the contract's own schema, which is the boundary parse that mints
`id` and `slug`, and writes `name` as a literal. The spec does exactly that,
without importing `DisplayName` or any entity behaviour.

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
