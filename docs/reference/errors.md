---
title: Errors
description: Entity.InvalidEntity, its structured issues, and the table of which failure goes down which channel.
---

# Errors

Every fallible entry point returns `Result<T, InvalidEntity>`. Bad input is
modelled as a value; a bug in domain code goes down the separate defect channel.

> Snippets on this page assume these imports:
>
> ```ts
> import { match, P } from "unthrown";
> import { Entity } from "@btravstack/entity";
> ```

## `Entity.InvalidEntity`

```ts
class InvalidEntity extends TaggedError("InvalidEntity")<{
  readonly entity: string;
  readonly issues: SchemaIssues; // readonly StandardSchemaV1.Issue[]
}> {}
```

Reachable as both a value and a type — `e instanceof Entity.InvalidEntity` and
`const e: Entity.InvalidEntity`. The signatures throughout this reference write
it unqualified, the way `SomeEntity` is also a stand-in; `Entity.InvalidEntity`
is how you spell it. Matching by tag needs no import at all:
`P.tag("InvalidEntity")`.

Schema failures carry the failing field's `path`; an `invariants` violation has
none — that absence distinguishes a whole-entity rule from a field complaint.

## Which channel a failure takes

| Failure                                  | Channel                              |
| ---------------------------------------- | ------------------------------------ |
| a field fails its own schema             | `InvalidEntity`, issue has a `path`  |
| a broken `invariants` rule               | `InvalidEntity`, issue has no `path` |
| `computed` output failing its own schema | **defect**                           |
| a `computed` function throwing           | **defect**                           |
| an async generator rejecting             | **defect**                           |
| subclassing an entity                    | **defect**                           |

The line between the two columns is argued in
[Errors are values, and defects are separate](/explanation/errors-are-values).

## Handling both at the edge

```ts
Organization.make(row).match({
  ok: (org) => respond(200, org.toJSON()),
  errCases: (m) =>
    m.with(P.tag("InvalidEntity"), (e) => respond(422, e.issues)),
  defect: (cause) => {
    report(cause);
    return respond(500);
  },
});
```

Issues are carried **structured**, exactly as the validator produced them, so
keying a field-level error response is a `path` lookup rather than a string
parse. [Expose an HTTP contract](/how-to/http-contract#handle-failures-at-the-edge)
works this through end to end.
