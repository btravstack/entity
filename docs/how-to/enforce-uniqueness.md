---
title: Enforce a uniqueness rule
description: Place a rule like "this slug is not taken" where it can actually hold, with a preflight lookup for feedback, a unique constraint for the guarantee, and a typed conflict error between them.
---

# Enforce a uniqueness rule

**Problem:** a rule needs to look at data the entity does not hold. "No other
organization has this slug" is the usual one; "the customer referenced here
exists" and "this account is under its quota" are the same shape. Invariants
cannot express it, and you need to know where it goes instead.

> Snippets below assume these imports:
>
> ```ts
> import { Entity } from "@btravstack/entity";
> import {
>   ErrAsync,
>   OkAsync,
>   P,
>   TaggedError,
>   fromPromise,
>   type AsyncResult,
> } from "unthrown";
> ```
>
> The runnable version is
> [`examples/billing-persistence/src/uniqueness.ts`](https://github.com/btravstack/entity/blob/main/examples/billing-persistence/src/uniqueness.ts),
> with its spec beside it.

## Sort the rule into the right layer

Three kinds of rule are easy to blur together. Each lives in a different place,
and only one of them survives two requests arriving at once.

| Rule                     | Example                         | Lives in                                     | Holds under concurrency       |
| ------------------------ | ------------------------------- | -------------------------------------------- | ----------------------------- |
| **State invariant**      | a name is at most 80 characters | the entity's `invariants`                    | yes, it reads only the entity |
| **Command precondition** | no organization has this slug   | the use case, before it writes               | no                            |
| **Database constraint**  | `unique (slug)`                 | the store, enforced atomically at write time | yes                           |

The test is whether the entity's own fields are enough to decide the rule. If
they are, it is a state invariant: synchronous, local, and checked on every
construction path. If the answer depends on what else is stored, it is
open-world, and it belongs to the use case and the store.

Ecto draws the same line between a changeset's
[validations and constraints](https://hexdocs.pm/ecto/Ecto.Changeset.html#module-validations-and-constraints):
validations run before the database is touched, constraints are reported by the
database and mapped back after the write fails.

## Keep the invariant closed-world

Leave the entity's declaration exactly as it would be without the uniqueness
rule:

```ts
export class Organization extends Entity("Organization")(
  {
    id: Entity.field(OrganizationId, { identity: true, generated: true }),
    slug: Entity.field(Slug, { immutable: true }),
    name: DisplayName,
    createdAt: Entity.field(Instant, { generated: true, immutable: true }),
  },
  {
    invariants: [
      Entity.invariant({
        code: "NAME_TOO_LONG",
        ensure: (d) => d.name.length <= 80,
        message: "name must be at most 80 characters",
      }),
    ],
  },
) {}
```

There is no async predicate to reach for, and no repository to pass in. That is
deliberate: `make` would stop being a pure function of its input, and a row
read back from storage would re-run a lookup that has nothing to do with
whether the row is well-formed. See [No I/O, by design](/explanation/no-io).

## Add the unique constraint first

The constraint is the rule. Everything else on this page is about reporting it
well:

```sql
alter table organization add constraint organization_slug_key unique (slug);
```

A unique index checks and writes in one atomic step, so no second writer can
slip in between.

## Give the store a Result-returning port

A driver reports a violation by rejecting. Triage that rejection once, at the
adapter's boundary, so the use case never sees a raw promise. The violation is
a modeled error carrying the constraint's name; everything else is a defect:

```ts
export class UniqueViolation extends TaggedError("UniqueViolation")<{
  constraint: string;
}> {
  override message = `duplicate key value violates unique constraint "${this.constraint}"`;
}

export type OrganizationStore = {
  slugIsTaken(slug: Organization["slug"]): AsyncResult<boolean, never>;
  insert(organization: Organization): AsyncResult<void, UniqueViolation>;
};
```

A Postgres adapter's `insert` qualifies SQLSTATE `23505` and nothing else:

```ts
insert: (organization) =>
  fromPromise(db.insert(organizations).values(toRow(organization)), (cause, defect) =>
    isUniqueViolation(cause) ? new UniqueViolation({ constraint: cause.constraint }) : defect(cause),
  ).map(() => undefined),
```

The example has no database, so its in-memory store plays the index's part the
same way: the check and the write share one synchronous block, and a duplicate
returns the error a real adapter would have qualified.

```ts
insert(organization: Organization): AsyncResult<void, UniqueViolation> {
  if (this.#bySlug.has(organization.slug)) {
    return ErrAsync(new UniqueViolation({ constraint: "organization_slug_key" }));
  }
  this.#bySlug.set(organization.slug, organization.toJSON());
  return OkAsync();
}
```

Swap in the real adapter and nothing above the port changes.

## Model the conflict as its own error

A taken slug is an expected outcome with a stable meaning, so give it a stable
type:

```ts
export class SlugTaken extends TaggedError("SlugTaken")<{
  slug: Organization["slug"];
}> {
  override message = `slug "${this.slug}" is already taken`;
}
```

It is not an `InvalidEntity`. The organization is valid; it lost a race for a
name. Folding the two together would hand the caller one error for "your input
is malformed" and "your input is fine but someone got there first", which are a
422 and a 409, and are fixed in different ways.

## Check, then create

The use case runs the three layers in order:

```ts
export const registerOrganization =
  (store: OrganizationStore) =>
  (input: Entity.CreateInput<typeof Organization>) =>
    createOrganization(input) // 1. state invariants, synchronous
      .toAsync()
      .flatMap((organization) =>
        store
          .slugIsTaken(organization.slug) // 2. preflight
          .ensure(
            (taken) => !taken,
            () => new SlugTaken({ slug: organization.slug }),
          )
          .map(() => organization),
      )
      .flatMap((organization) =>
        store
          .insert(organization) // 3. the authority
          .mapErrCases((m, defect) =>
            m.with(P.tag("UniqueViolation"), (violation) =>
              violation.constraint === "organization_slug_key"
                ? new SlugTaken({ slug: organization.slug })
                : defect(violation),
            ),
          )
          .map(() => organization),
      );
```

The result is `AsyncResult<Organization, InvalidEntity | SlugTaken>`.

The preflight lookup is there for feedback. It catches the common case before
any write, and it is the place to put a friendlier message or a suggested
alternative. It cannot establish uniqueness, so never let it be the only check.
Dropping it is a valid choice; dropping the constraint is not.

The lookup's error channel is `never`: its adapter already turned a store that
cannot answer into a defect, because that is not a conflict.

## Qualify the violation, and only that

Triage happens twice, each time at the layer that knows enough. The adapter's
`qualify` knows the driver: it turns SQLSTATE `23505` into `UniqueViolation`
and every other rejection into a defect. The use case's `mapErrCases` knows the
domain: it turns exactly one violation into `SlugTaken`, the one **on this
index**. Match on the constraint's name, or a violation of some other unique
index on the same table becomes a misleading "slug taken"; that one goes to
`defect`.

Every other failure is a defect too. A refused connection, a timeout, or a
violation you did not anticipate is infrastructure failing, and it should page
someone rather than render as a 409. If you use Prisma,
[`@unthrown/prisma`](https://btravstack.github.io/unthrown/) already separates
`UniqueConstraintViolation` from `DriverError`; the same rule applies to which
one you map.

## Watch the race lose

Two requests for the same slug, arriving together:

1. Both build a valid `Organization`.
2. Both look up the slug, and both see it free.
3. Both insert. The store accepts the first and rejects the second with a
   unique violation.
4. The second request's `mapErrCases` maps that violation to `SlugTaken`.

The loser gets the same error the preflight would have given it, so the caller
never needs to know which layer caught the conflict. The example's spec
reproduces this deterministically by holding both inserts until both lookups
have answered, then asserting that both lookups saw a free slug and exactly one
write succeeded.

## Answer each channel at the edge

The three outcomes stay distinguishable all the way out:

```ts
registerOrganization(store)(input).match({
  ok: () => 201,
  errCases: (m) =>
    m
      .with(P.tag("InvalidEntity"), () => 422)
      .with(P.tag("SlugTaken"), () => 409),
  defect: () => 503,
});
```

If your API renders every failure in one response shape, do that here, at the
edge, by mapping `SlugTaken` into it. Converting it into an `InvalidEntity`
first to borrow its `issues` would erase the distinction the matcher depends on.
An invariant failure carries its own stable code, read with
[`Entity.codeOf`](/reference/errors#entity-codeof-issue), so both kinds of
failure can still end up in one response shape.

Related: [Persist and rehydrate](/how-to/persist-and-rehydrate) for the
repository this store sits beside, and
[Expose an HTTP contract](/how-to/http-contract) for the edge.
