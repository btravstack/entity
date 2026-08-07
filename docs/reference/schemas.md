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
Organization.output; // ZodObject — stored state and response body
Organization.createInput; // ZodObject — input minus generated
Organization.updateInput; // ZodObject — output minus immutable and computed, partial
Organization.entityName; // the tag, as a literal type
Organization; // …is itself a zod schema, parsing to an instance
```

`output` is `input` plus the computed fields. All four `ZodObject`s generate
JSON Schema in **both** `"input"` and `"output"` directions.

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

That last line is the design rule made concrete: **contracts compose the four
plain `ZodObject`s; domain code composes the class itself.** See
[Why entity?](/explanation/why-entity#the-rule-the-design-turns-on) for the
constraint it comes from, and
[Expose an HTTP contract](/how-to/http-contract) for the recipe.
