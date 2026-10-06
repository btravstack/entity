---
title: Expose an HTTP contract
description: Select a route's request and response schemas from an entity's four derived ZodObjects by allowlist, map the domain to the response, and share the contract with a client that cannot import the entity.
---

# Expose an HTTP contract

**Problem:** you have an entity and need request and response schemas for its
routes, converted to JSON Schema, without exposing internal state or letting a
caller set a field just because the domain lets it change.

> Snippets below assume these imports:
>
> ```ts
> import { z } from "zod";
> import { P } from "unthrown";
> import { Entity } from "@btravstack/entity";
> ```
>
> Domain vocabulary (entities, brands, factories) is whatever your own domain
> declares. The snippets use an `Organization` whose `riskTier` field is set by
> the credit team and must never reach a customer.

## Start from the four schemas, not as the contract

`input`, `output`, `createInput` and `updateInput` describe what the **domain**
accepts and holds. None of them knows who is calling:

- `output` is the stored state, `riskTier` included.
- `updateInput` is every field the domain lets change, `riskTier` included.
  Mutable is not the same as settable by any caller.

Use them as building blocks: every schema below is selected from them, so no
field's type is written twice. [Schema members](/reference/schemas) lists what
each one holds.

## Allowlist the response

Pick the public fields by name:

```ts
const publicFields = {
  id: true,
  slug: true,
  name: true,
  displayLabel: true,
  createdAt: true,
} as const;

const OrganizationResponse = Organization.output.pick(publicFields);
```

Use `.pick`, not `.omit({ riskTier: true })`. An omit list exposes every field
it was not told about, so the next internal field the entity grows ships to
callers silently. An allowlist leaves it out until someone adds it on purpose.

## Map the domain to the response

When the public representation differs from the stored one, give the response
its own shape and a mapping function. Here the response drops `riskTier` and
adds `selfTitled`, which is class behaviour rather than stored state:

```ts
const OrganizationResponse = Organization.output
  .pick(publicFields)
  .extend({ selfTitled: z.boolean() });
type OrganizationResponse = z.output<typeof OrganizationResponse>;

const toOrganizationResponse = (org: Organization): OrganizationResponse => ({
  id: org.id,
  slug: org.slug,
  name: org.name,
  displayLabel: org.displayLabel,
  createdAt: org.createdAt,
  selfTitled: org.isSelfTitled,
});
```

Send `toOrganizationResponse(org)`, never `org.toJSON()`. `toJSON()` is the
stored shape, and it is right for a database, not for a caller. The return
annotation makes a public field added to the schema but not to the mapping a
compile error.

## Give each command its own input

A command takes the keys its operation needs and nothing else:

```ts
const CreateOrganizationBody = Organization.createInput
  .pick({ slug: true, name: true })
  .strict();

const RenameOrganizationBody = Organization.output
  .pick({ id: true, name: true })
  .strict();

const renameOrganization = (
  org: Organization,
  command: z.output<typeof RenameOrganizationBody>,
) => org.update({ name: command.name }).map(toOrganizationResponse);
```

`.strict()` rejects any other key instead of stripping it, so a caller sending
`riskTier` gets a validation error rather than a silent no-op. Building the
patch field by field means the command can only change what it names, even if
its schema is later widened by mistake.

Authorization stays in your application boundary. Whether this caller may
rename this organization is a check the handler makes before calling
`update`; the entity has no notion of who is asking, and does not need one.

## Share the full shape only across a coupled boundary

The full derived shape is the right contract when both sides deliberately
change together and both may see everything:

- persistence: `toJSON()` to write, `make()` to read back. See
  [Persist and rehydrate](/how-to/persist-and-rehydrate).
- an internal service or back-office tool owned and deployed with the domain,
  where `riskTier` is exactly what the caller came for.

```ts
const AdminOrganizationResponse = Organization.output;
```

Anything a third party, a customer or a separately released client reads gets
an allowlisted contract, because its evolution is not yours to decide.

## Convert to JSON Schema

The four `ZodObject`s, and anything picked or extended from them, convert in
**both** directions:

```ts
import { ZodToJsonSchemaConverter } from "@orpc/zod";

const converter = new ZodToJsonSchemaConverter();
const [createSchema] = converter.convert(CreateOrganizationBody, "input");
const [responseSchema] = converter.convert(OrganizationResponse, "output");
```

Or with zod directly:

```ts
z.toJSONSchema(OrganizationResponse, { io: "output" }); // ✓
z.toJSONSchema(CreateOrganizationBody, { io: "input" }); // ✓ additionalProperties: false
```

## Share the contract with a browser

The package is Node-only: `equals` imports `node:util`. A module that imports
an entity class, even only to `.pick` its schemas, carries that import with it.
Bundling such a module for the browser fails; measured with esbuild:

```text
✘ [ERROR] Could not resolve "node:util"
```

A client gets the contract another way. Pick one:

- **JSON Schema, as data.** Write the converted schemas to `.json` files at
  build time and ship those. They are plain JSON, so any client can validate
  against them or generate types from them, and none of it imports your
  domain.
- **A zod-only module.** Declare the public shapes in a module that imports
  `zod` and nothing else, and let the server's mapping function hold it to the
  domain:

  ```ts
  // contract.ts: imports zod only, so a browser can import it
  export const OrganizationView = z.object({
    id: z.uuid(),
    slug: z.string(),
    name: z.string(),
  });

  // server.ts: Node-only, imports the entity
  const toView = (org: Organization): z.input<typeof OrganizationView> => ({
    id: org.id,
    slug: org.slug,
    name: org.name,
  });
  ```

  The shapes are written twice here, on purpose: the public contract evolves
  on its own schedule. The return annotation is what stops the two drifting
  apart.

## Do not hand the class to a converter

```ts
z.toJSONSchema(Organization, { io: "output" }); // ✗ throws
```

The class carries a `.transform()`: it parses to an _instance_, not to plain
data, and a transforming schema has no output representation. That is
deliberate, and it is the reason the four plain `ZodObject`s exist separately.

Rule of thumb: **contracts compose the four `ZodObject`s; domain code composes
the class.**

## Handle failures at the edge

Issues are structured, so a field-keyed error response is a lookup rather than
a string parse. `Entity.keysOf` normalises an issue's path to plain keys
(Standard Schema permits a segment to be a bare key or a `{ key }` wrapper, and
the helper absorbs both), and `Entity.renderIssue` is the human spelling of one
issue, the same one
[`InvalidEntity.message`](/reference/errors#entity-invalidentity) is built from.

Here `org` is the organization the handler has already loaded and checked the
caller may rename:

```ts
const command = RenameOrganizationBody.safeParse(await request.json());
if (!command.success) return json(400, z.flattenError(command.error));

return renameOrganization(org, command.data).match({
  ok: (response) => json(200, response),
  errCases: (m) =>
    m.with(P.tag("InvalidEntity"), (e) =>
      json(422, {
        errors: e.issues.map((i) => ({
          field: Entity.keysOf(i).join("."), // "" for a whole-entity rule
          code: Entity.codeOf(i), // the rule's declared code, if it has one
          message: i.message,
        })),
      }),
    ),
  defect: (cause) => {
    report(cause);
    return json(500, { error: "internal" });
  },
});
```

When the response is a flat list of strings rather than field-keyed objects,
`e.issues.map(Entity.renderIssue)` is the whole mapping (`"name: …"` per issue,
path prefix included).

An issue with an empty `path` came from `invariants`, a rule spanning the whole
entity rather than one field. That distinction is what lets you decide whether
to attach the message to a form field or to the form. Its declared code also
tells the client _which_ rule failed, so it can render its own
copy or offer a recovery without matching on message text; see
[`Entity.codeOf`](/reference/errors#entity-codeof-issue).

## A union as a request body

`Entity.union` gives a discriminated union with one branch per member, so a
polymorphic endpoint keeps its contract:

```ts
export const Member = Entity.union("kind", [User, ServiceAccount]);
export type Member = Entity.Instance<typeof Member>;

const Body = Member.input; // z.discriminatedUnion("kind", [...])
z.toJSONSchema(Body, { io: "input" }); // one branch per member
```

`Member.input` is each member's full `input`, so it suits a coupled boundary.
For a public endpoint, build the union from each member's picked command
schema with `z.discriminatedUnion`.
