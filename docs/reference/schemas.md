---
title: Schema members
description: input, output, createInput, updateInput, entityName — and the class itself as a zod schema.
---

# Schema members

Every entity carries four plain `ZodObject`s as statics, plus the class itself.

> Snippets on this page assume these imports:
>
> ```ts
> import { z } from "zod";
> import { Entity } from "@btravstack/entity";
> ```

```ts
Organization.input; // ZodObject — everything make() accepts
Organization.output; // ZodObject — stored state, internal fields included
Organization.createInput; // ZodObject — input minus the generated fields
Organization.updateInput; // ZodObject — input minus the immutable fields, partial
Organization.entityName; // the tag, as a literal type
Organization; // …is itself a zod schema, parsing to an instance
```

`output` is `input` plus the computed fields. All four `ZodObject`s are plain
all the way down, so they generate JSON Schema in **both** `"input"` and
`"output"` directions, nested entities included. A field whose own type JSON
Schema cannot express is the exception; see
[What JSON Schema can express](#what-json-schema-can-express).

Each describes what the **domain** accepts or holds, whoever is asking:

| Member        | Describes                              | Is not                                                     |
| ------------- | -------------------------------------- | ---------------------------------------------------------- |
| `input`       | every field `make()` reads             | a request body: it includes the `generated` fields         |
| `output`      | the stored state, every field included | a response body: an internal field is in it too            |
| `createInput` | every field a create may set           | a public command: internal fields are in it too            |
| `updateInput` | every field the domain lets change     | authorization: mutable does not mean any caller may set it |

They are building blocks for a contract. A public route selects from them
with `.pick`, an allowlist, so a field the entity gains later is not exposed
by default. [Expose an HTTP contract](/how-to/http-contract) has the recipe.
Converting a member to JSON Schema selects nothing: it describes every field
the domain holds, internal ones included.

## Nested entities

When a field holds another entity, each member embeds that entity's own plain
schema, never its class. Which one depends on the member:

| Member        | A nested entity becomes                |
| ------------- | -------------------------------------- |
| `input`       | its `input`                            |
| `output`      | its `output`, computed fields included |
| `createInput` | its `input`                            |
| `updateInput` | its `input`, as an optional key        |

The substitution goes through `z.array(...)`, `z.optional(...)`,
`z.nullable(...)` and `Entity.field(...)`, and it repeats at every level,
because the nested entity's own members are already plain. An
[`Entity.union(...)`](/reference/declaration) field becomes the union's
`input` or `output`: a `z.discriminatedUnion` of its members' plain schemas.

```ts
class Order extends Entity("Order")({
  id: OrderId,
  lines: z.array(OrderLine), // OrderLine declares a computed `subtotal`
}) {}

z.toJSONSchema(Order.output, { io: "output" }); // ✓ lines[] carry `subtotal`
z.toJSONSchema(Order.createInput, { io: "input" }); // ✓ lines[] do not
Order.output.parse(order.toJSON()).lines[0]; // plain data, not an OrderLine
Order.make(row).getOrThrow().lines[0]; // an OrderLine instance
```

Parsing with a member gives plain data at every depth. Construction is
unchanged: `make`, `update` and a factory parse through a module-private schema
that keeps the classes, so a nested field still holds a real instance.

What is not walked: an entity inside `z.record(...)`, `z.tuple(...)`,
`.default(...)`, `.readonly()` or an inline `z.object(...)` stays the class, and
the member that holds it does not convert. `.describe()` or `.meta()` written on
an array or optional wrapper around an entity is not carried over; put it on the
entity's own schemas or on the contract you derive.

A serialised entity parses with its own `output`, and `make` takes the result
back:

```ts
const wire = JSON.parse(JSON.stringify(order));
const decoded = Order.output.parse(wire); // equals `wire`
Order.make(decoded); // Ok(Order), nested lines rebuilt as instances
```

That holds as long as every field survives `JSON.stringify`, which the next
section qualifies.

## What JSON Schema can express

The package invents no encoder. Each member holds your field schemas as you
wrote them, so what converts is what zod converts:

| A field declared as                  | Parsing a member                | `z.toJSONSchema`, `io: "input"` | `z.toJSONSchema`, `io: "output"` |
| ------------------------------------ | ------------------------------- | ------------------------------- | -------------------------------- |
| `z.iso.datetime()` (branded)         | a string                        | ✓ `format: "date-time"`         | ✓ `format: "date-time"`          |
| `z.date()`                           | a `Date`                        | ✗ throws                        | ✗ throws                         |
| `z.bigint()`                         | a `bigint`                      | ✗ throws                        | ✗ throws                         |
| `z.custom(...)`, `z.instanceof(...)` | the value you passed, untouched | ✗ throws                        | ✗ throws                         |
| a `.transform(...)`                  | the transformed value           | ✓ the source schema             | ✗ throws                         |
| a `z.codec(wire, domain, ...)`       | the decoded (domain) value      | ✓ the wire schema               | the domain schema; ✗ if a `Date` |

Two of those rows also break the round trip above, before JSON Schema is
involved: `JSON.stringify` writes a `Date` as a string, which `z.date()` then
rejects, and throws on a `bigint` outright. For a value that crosses a JSON
boundary, declare the JSON-safe form as the field: an ISO string through
`z.iso.datetime().brand(...)`, an amount in integer minor units, a decimal as a
string.

Where a field must stay unrepresentable, convert with
`{ unrepresentable: "any" }`. zod then writes `{}` (any value) for that
property instead of throwing, and documents nothing about it:

```ts
z.toJSONSchema(Ledger.output, { unrepresentable: "any" }); // ✓ the bigint field is {}
```

## The class as a schema

The class carries zod's internal slots (`_zod`, `~standard`) but **not** its
methods, so it composes anywhere zod takes a schema while `.parse()` — which
throws — does not exist on it:

```ts
z.object({ owner: Organization }); // ✓
z.array(Organization); // ✓
z.optional(Organization); // ✓ the function form
Organization.optional(); // ✗ does not exist
Organization.parse(raw); // ✗ does not exist — use make()
z.toJSONSchema(Organization, { io: "output" }); // ✗ throws — the class carries a transform
```

That last line holds whether or not the entity nests anything. It is the
design rule made concrete: **contracts compose the four
plain `ZodObject`s; domain code composes the class itself.** See
[Why entity?](/explanation/why-entity#the-rule-the-design-turns-on) for the
constraint it comes from, and
[Expose an HTTP contract](/how-to/http-contract) for the recipe.
