---
title: Persist and rehydrate
description: Write an entity to a database with toJSON() and read it back with make(), without the storage layer knowing about entity internals.
---

# Persist and rehydrate

**Problem:** you need to write an entity to a database and read it back,
without the storage layer knowing about entity internals.

> Snippets below assume these imports:
>
> ```ts
> import { z } from "zod";
> import { P } from "unthrown";
> import { Entity } from "@btravstack/entity";
> ```

## Write with `toJSON()`

```ts
await db.insert("organizations", org.toJSON());
```

`toJSON()` projects exactly `output`'s keys. It never includes `_tag`, and never
includes fields your class body declares:

```ts
class Organization extends Entity("Organization")({ id: OrgId, slug: Slug }) {
  cachedSummary = "";
}

const org = Organization.make(row).getOrThrow();
org.cachedSummary = "computed"; // fine — not declared data
org.toJSON(); // { id, slug } — cachedSummary is not there
```

Do **not** use spread. `{ ...org }` copies own enumerable properties, which
includes class-body fields — so it leaks exactly what `toJSON()` excludes.

The projection is typed `DeepReadonly`, and that is honest rather than
cautious: the top-level object is fresh, but nested containers are the
instance's own frozen references, so mutating one would throw. A driver that
insists on mutating its argument gets a structural clone
(`structuredClone(org.toJSON())`), not a cast.

## Read with `make()`

```ts
const org = Organization.make(row).getOrThrow();
```

`make` is the only way in, and it is the same entry point for a database row, a
folded event stream, an untrusted import, or a replayed integration event. They
differ in where the data came from, not in what has to happen to it: validate,
re-derive the computed fields, check the invariants, construct.

Extra keys are ignored, so a row carrying computed columns round-trips
unchanged:

```ts
Organization.make(org.toJSON()); // ✓ round-trips
```

## Check a hand-built row at the call site

`make` takes `unknown`, so a row you assemble yourself gets no compile-time
check. `satisfies Entity.Input<…>` restores it:

```ts
const orgId = (value: string) => OrgId.parse(value);
const slug = (value: string) => Slug.parse(value);

const seedRow = {
  id: orgId("0199b1f4-1b1e-7000-8000-000000000000"),
  slug: slug("acme"),
} satisfies Entity.Input<typeof Organization>;

const seeded = Organization.make(seedRow).getOrThrow();
```

A key the entity does not declare is now a compile error rather than a value
`make` quietly ignores.

Use it where you write the row — a seed, a migration, a fixture. A driver
handing you `unknown` needs nothing: there is no literal to check, and `make`
validates it either way. The values have to be branded, which is what the mint
helpers are for
([Branded fields](/explanation/branded-fields#everywhere-else-parse-through-a-mint-helper)).

## Computed columns heal themselves

Store computed fields if you need to index or query them — `toJSON()` includes
them. On read they are **re-derived**, not trusted:

```ts
// a row written before the derivation changed, or before the field existed
Person.make({ id, first: "Ada", last: "Lovelace", fullName: "stale value" });
//                                                 ^ ignored and recomputed
```

That means a derivation change does not need a backfill migration to be
_correct_ — only to make stored values match, for queries that read the column
directly. For every other kind of model change against stored rows — adding,
defaulting, renaming, retiring a field — see
[Evolve an entity](/how-to/evolve-an-entity).

## Map a repository

The type helpers name each shape, so a repository signature never restates the
model:

```ts
type OrganizationRow = Entity.Output<typeof Organization>;

interface OrganizationRepository {
  save(org: Organization): Promise<void>;
  findById(id: z.infer<typeof OrgId>): Promise<Organization | undefined>;
}

const repository: OrganizationRepository = {
  async save(org) {
    await db.upsert("organizations", org.toJSON());
  },
  async findById(id) {
    const row: OrganizationRow | undefined = await db.findOne("organizations", {
      id,
    });
    return row && Organization.make(row).getOrThrow();
  },
};
```

## Decide what a read failure means

A row that fails validation is a real signal — the database holds data the
domain considers impossible. `getOrThrow()` is fine when that should page
someone; handle the `Result` when it should not:

```ts
const loaded = Organization.make(row).match({
  ok: (org) => org,
  errCases: (m) =>
    m.with(P.tag("InvalidEntity"), (e) => {
      logger.error(
        { id: row.id, issues: e.issues },
        "corrupt organization row",
      );
      return undefined;
    }),
  defect: (cause) => {
    throw cause;
  },
});
```
