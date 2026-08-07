# Expose an HTTP contract

**Problem:** you have an entity and need request and response schemas for a
route, converted to JSON Schema, without hand-writing omit lists that drift
from the model.

## Use the four `ZodObject` members directly

```ts
const CreateBody = Organization.createInput; // input minus generated
const UpdateBody = Organization.updateInput; // output minus immutable, partial
const ResponseBody = Organization.output; // stored state
```

Nothing to maintain: `createInput` drops whatever `generated` names, and
`updateInput` drops whatever `immutable` names plus the computed fields. Add a
generated field to the entity and the create body follows.

## Convert to JSON Schema

All four convert in **both** directions:

```ts
import { ZodToJsonSchemaConverter } from "@orpc/zod";

const converter = new ZodToJsonSchemaConverter();
converter.convert(Organization.createInput, { strategy: "input" });
converter.convert(Organization.output, { strategy: "output" });
```

Or with zod directly:

```ts
z.toJSONSchema(Organization.output, { io: "output" }); // ✓
z.toJSONSchema(Organization.createInput, { io: "input" }); // ✓
```

## Do not hand the class to a converter

```ts
z.toJSONSchema(Organization, { io: "output" }); // ✗ throws
```

The class carries a `.transform()` — it parses to an _instance_, not to plain
data — and a transforming schema has no output representation. That is
deliberate, and it is the reason the four plain `ZodObject`s exist separately.

Rule of thumb: **contracts compose the four `ZodObject`s; domain code composes
the class.**

## Derive further views

They are ordinary `ZodObject`s, so the usual combinators work:

```ts
const Summary = Organization.output.pick({ id: true, slug: true });
const Listing = z.object({
  items: z.array(Organization.output),
  total: z.number(),
});
```

## Handle failures at the edge

Issues are structured, so a field-keyed error response is a lookup rather than
a string parse:

```ts
const result = Organization.make(await request.json());

return result.match({
  ok: (org) => json(200, org.toJSON()),
  errCases: (m) =>
    m.with(P.tag("InvalidEntity"), (e) =>
      json(422, {
        errors: e.issues.map((i) => ({
          field: (i.path ?? []).join("."), // "" for a whole-entity rule
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

An issue with an empty `path` came from `invariants` — a rule spanning the whole
entity rather than one field. That distinction is what lets you decide whether
to attach the message to a form field or to the form.

## A union as a request body

`Entity.union` gives a discriminated union with one branch per member, so a
polymorphic endpoint keeps its contract:

```ts
const Member = Entity.union("kind", [User, ServiceAccount]);

const Body = Member.input; // z.discriminatedUnion("kind", [...])
z.toJSONSchema(Body, { io: "input" }); // one branch per member
```
