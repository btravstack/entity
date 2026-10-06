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

## Contract a nested aggregate

An aggregate's members embed each child entity's own plain schema, so its
contract is selected the same way. Here `Order` owns `lines: z.array(OrderLine)`
and keeps `billTo`, a snapshot of the customer's name and address, for
billing's own use:

```ts
const OrderResponse = Order.output.pick({
  id: true,
  status: true,
  currency: true,
  lines: true, // each line's output, its computed `subtotal` included
  total: true,
});

const OpenOrderBody = Order.createInput
  .pick({ customerId: true, currency: true, lines: true }) // each line's input
  .strict();
```

The allowlist applies at the level you write it. `billTo` stays out because it
is not picked, but picking `lines` takes every field a line has. To narrow a
child too, replace the field with a pick of the child's own member:

```ts
const OrderSummary = Order.output.pick({ id: true, total: true }).extend({
  lines: z.array(OrderLine.output.pick({ label: true, subtotal: true })),
});
```

`.strict()` closes the top-level object only. A nested line in a request body
keeps zod's default and strips unknown keys; extend the field with a
`.strict()` child schema when it should reject them instead.

A response built this way parses the serialised entity directly, since
`JSON.stringify` walks nested entities down to the same plain data:

```ts
OrderResponse.parse(JSON.parse(JSON.stringify(order))); // billTo dropped
```

Prefer a mapping function, as for `Organization`, once the response stops
being a plain selection of stored fields.

## Accept null where the domain has undefined

An entity models an absent value as `undefined`, through `.optional()`. Many
wires carry `null` instead, and `.optional()` rejects `null`. Nothing in the
package converts between the two, because the right policy depends on the
boundary, so state it in the contract with zod. Here `Customer` declares
`phone: Phone.optional()`:

```ts
// out: absent becomes null
const CustomerResponse = Customer.output
  .pick({ id: true, name: true })
  .extend({ phone: Phone.nullable() });

const toCustomerResponse = (
  customer: Customer,
): z.input<typeof CustomerResponse> => ({
  id: customer.id,
  name: customer.name,
  phone: customer.phone ?? null,
});

// in: null becomes absent, before the domain sees it
const CreateCustomerBody = Customer.createInput
  .pick({ name: true })
  .extend({ phone: Phone.nullish() })
  .strict();

const createFromBody = (body: z.output<typeof CreateCustomerBody>) =>
  createCustomer({ name: body.name, phone: body.phone ?? undefined });
```

A PATCH has two kinds of absence, and they must stay apart. An omitted key
leaves the field unchanged. `null`, if the API chooses to support clearing,
removes the value, which the domain spells `undefined`:

```ts
const EditCustomerBody = Customer.updateInput
  .pick({ name: true })
  .extend({ phone: Phone.nullish() })
  .strict();

const editCustomer = (
  customer: Customer,
  body: z.output<typeof EditCustomerBody>,
) =>
  customer.update({
    ...(body.name === undefined ? {} : { name: body.name }),
    // omitted: unchanged; null: cleared
    ...(body.phone === undefined ? {} : { phone: body.phone ?? undefined }),
  });
```

`body.phone === undefined` is true only when the key was omitted: `.nullish()`
keeps an explicit `null` as `null`. An API that does not let callers clear a
field declares it `.optional()` in the body and never maps `null` at all.

The same pattern serves a database whose columns are nullable: map
`undefined` to `null` on the way to the row, and `null` to `undefined` before
`make`. See [Persist and rehydrate](/how-to/persist-and-rehydrate).

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
**both** directions, nested entities included. A field typed as a `Date`, a
`bigint` or a `z.custom` value does not convert; [Schema
members](/reference/schemas#what-json-schema-can-express) lists what each kind
of field does.

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

The package imports no Node built-in, so a browser bundle can import the
module that holds your contract, entity classes included. Whether it should is
a design question, not a technical one: importing the domain module couples
the client to every change in it, and ships its behaviour to a place that
only needs shapes.

To keep the client independent of the domain, pick one:

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

  // server.ts: imports the entity
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
