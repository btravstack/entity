---
title: Errors
description: Entity.InvalidEntity, its structured issues and rendered message, the Entity.keysOf / Entity.renderIssue helpers, and the table of which failure goes down which channel.
---

# Errors

Every fallible entry point returns `Result<T, InvalidEntity>`. Bad input is
modelled as a value; a bug in domain code goes down the separate defect channel.

> Snippets on this page assume these imports:
>
> ```ts
> import { P } from "unthrown";
> import { Entity } from "@btravstack/entity";
> ```

## `Entity.InvalidEntity`

```ts
class InvalidEntity extends TaggedError("InvalidEntity")<{
  readonly entity: string;
  readonly issues: SchemaIssues; // readonly StandardSchemaV1.Issue[]
}> {
  override message: string; // "<entity>: <path>: <msg>; …" — rendered eagerly
}
```

Reachable as both a value and a type — `e instanceof Entity.InvalidEntity` and
`const e: Entity.InvalidEntity`. The signatures throughout this reference write
it unqualified, the way `SomeEntity` is also a stand-in; `Entity.InvalidEntity`
is how you spell it. Matching by tag needs no import at all:
`P.tag("InvalidEntity")`.

Schema failures carry the failing field's `path`; an `invariants` violation has
none — that absence distinguishes a whole-entity rule from a field complaint.

### `message`

`issues` stays the structured API; `message` is only its human spelling —
rendered eagerly, so a log line, a thrown `getOrThrow()` or a failed test
assertion names the entity and the failing fields instead of printing a blank
`Error`:

```ts
Organization.make({ id: "not-a-uuid", slug: "" }).getOrThrow();
// throws: Organization: id: Invalid UUID; slug: Too small: expected string to have >=1 characters
```

Each issue renders as `path: message`, path segments joined with `.`; an
issue with no path — an invariant — renders as its message alone.

## `Entity.keysOf(issue)` / `Entity.renderIssue(issue)`

The two helpers an adapter needs to turn an `InvalidEntity` into a response
body, working on one element of `issues`:

```ts
Entity.keysOf(issue); // PropertyKey[] — ["customer", "name"]
Entity.renderIssue(issue); // string — "customer.name: Too small: …"
```

`keysOf` normalises the issue's path to plain keys. Standard Schema permits a
path segment to be a bare `PropertyKey` **or** a `{ key }` wrapper — zod emits
the bare form, but code written against `issue.path` directly breaks on the
wrapped one, which is why the helper exists. `renderIssue` is the spelling
`message` is built from, so a hand-assembled error list and a logged message
never disagree. [Expose an HTTP contract](/how-to/http-contract#handle-failures-at-the-edge)
uses both.

## Which channel a failure takes

| Failure                                           | Channel                                        |
| ------------------------------------------------- | ---------------------------------------------- |
| a field fails its own schema                      | `InvalidEntity`, issue has a `path`            |
| a broken `invariants` rule                        | `InvalidEntity`, issue has no `path`           |
| a union payload's discriminant matches nobody     | `InvalidEntity`, one issue at `[discriminant]` |
| `computed` output failing its own schema          | **defect**                                     |
| a `computed` function throwing                    | **defect**                                     |
| an async generator rejecting                      | **defect**                                     |
| subclassing an entity                             | **defect**                                     |
| two union members claiming one discriminant value | **defect**, thrown at declaration time         |

The union's "Invalid discriminant" issue lists the values it knows —
`Invalid discriminant "robot"; expected one of "user", "service_account"` —
and sits at the discriminant's own path, so it keys a field-level response
like any schema failure. The duplicate-value defect is different in kind: it
is a bug in the _declaration_, so `Entity.union` throws while the declaration
is on the stack, naming both members, instead of letting the last one silently
win the dispatch table.

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
