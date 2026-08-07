---
title: Why entity?
description: What an entity actually is, why the four jobs belong in one declaration, and the rule the whole design turns on.
---

# Why entity?

Why the package is built the way it is. Several pages in this section record
behaviour that was **measured**, not assumed — the diagnostic codes are quoted
so a future change can re-check rather than re-litigate.

> Snippets in this section assume these imports:
>
> ```ts
> import { z } from "zod";
> import { match, P } from "unthrown";
> import { Entity } from "@btravstack/entity";
> ```

## What an entity is, and why this exists

An entity is simultaneously four things: a **type** your domain code programs
against, a **validator** for data crossing a trust boundary, a **value with
behaviour** (methods, invariants), and something that **nests inside other
entities**. Most tools give you two or three at once — a validation library
gives a type and a validator; a plain class gives a type and behaviour — and
stitching the rest together by hand is exactly the repetitive, error-prone work
a library should absorb.

[Effect's `Schema.Class`](https://www.effect.website/docs/v3/schema/classes)
gets all four right at once and is the closest prior art. This package targets
the same shape on top of **zod v4** and
**[Standard Schema](https://standardschema.dev)**, with entry points named for
the use case they serve rather than one generic `parse`.

## The rule the design turns on

**Contracts compose the four `ZodObject`s; domain code composes the class.**

It comes from a real constraint in zod's schema-to-JSON-Schema conversion: a
schema carrying a `.transform()` — which is what turns parsed data into a class
instance — has no output representation. The class does exactly that, so
`z.toJSONSchema(Organization, { io: "output" })` throws by design, while the
four plain `ZodObject`s convert in both directions with no hand-written omit
lists.

[Expose an HTTP contract](/how-to/http-contract) is that rule applied end to
end; [Schema members](/reference/schemas) is what each of the four is for.
