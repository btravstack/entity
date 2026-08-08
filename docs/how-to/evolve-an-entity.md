---
title: Evolve an entity
description: Add, default, rename and retire fields against stored rows — every read goes through make(), so evolution is about what old rows still validate.
---

# Evolve an entity

**Problem:** the model needs a new field, a better name, or one field fewer —
and the database already holds rows in the old shape. Every read goes through
`make()`, which validates against `input`, so the question for each change is
the same: do the old rows still validate?

> Snippets below assume these imports:
>
> ```ts
> import { z } from "zod";
> import { Entity } from "@btravstack/entity";
> ```

## Add an optional field

The safe default. Old rows lack the key, `.optional()` accepts its absence,
and nothing else moves:

```ts
class Organization extends Entity("Organization")({
  id: OrgId,
  slug: Slug,
  note: Note.optional(), // new — old rows simply don't have it
}) {}
```

The nominal-field check looks through `.optional()`, so the wrapper needs no
ceremony. ([Field rules](/reference/declaration#fields).)

## Add a required field

A required field rejects every old row, so something has to supply the value.
Two options, in order of preference:

**Backfill, then require.** Migrate the stored rows first, then tighten the
declaration. The declaration stays honest — the field is required because
every row really has it — and a row that somehow escaped the backfill fails
loudly at `make` instead of silently carrying a filler value.

**Default at the schema.** When there is one correct value for every old row,
put it on the field and skip the migration:

```ts
class Organization extends Entity("Organization")({
  id: OrgId,
  slug: Slug,
  tier: z.enum(["free", "pro"]).default("free"), // old rows read as "free"
}) {}
```

`.default()` substitutes its value when the key is absent, **without** running
it through the schema; `.prefault()` parses the value like any other input —
prefer it when the field transforms or the default should face the same
validation. Either way the value is filled on read and present in `toJSON()`,
so rows heal as they are next written. The trade-off against backfilling: the
database keeps holding rows without the column, so anything querying the
column directly — SQL, an index, another service — does not see the default.
The schema heals reads through `make`; only a backfill heals the rows.

## Rename a field

`make` has no alias mechanism, deliberately — the declaration describes one
shape, not every shape the table has ever had. Renaming is a mapper concern,
at the repository edge: read both, write new.

```ts
// was: shortName — now: slug
type StoredRow = Entity.Output<typeof Organization>;
type LegacyRow = Omit<StoredRow, "slug"> & { readonly shortName: string };

const fromRow = (row: StoredRow | LegacyRow) =>
  Organization.make("slug" in row ? row : { ...row, slug: row.shortName });
```

Writes go through `toJSON()` and carry only the new name, so the old column
drains as rows are rewritten. Once a backfill (or time) has emptied it, delete
`LegacyRow` and the mapper's fallback — the mapper is the whole migration
surface, which is the point of routing reads through one.

## Retire a field

Remove it from the declaration. Nothing else is required: `make` ignores
unknown keys, so old rows still carrying the column validate untouched, and
`toJSON()` — which projects exactly `output`'s keys — stops writing it. Drop
the database column whenever convenient.

Retiring is also what makes the **declaration-first** habit safe: a field the
model no longer names cannot be read, so any code still using it fails to
compile at the moment of the change, not in production.

## Split one entity into variants

When one entity has grown two shapes, move the shared half onto an
[abstract root](/reference/declaration#entity-abstract-name-fields-options) and
declare each shape as a variant of it. An entity is final, so this is the
extension point:

```ts
// before
class Document extends Entity("Document")({ id: DocId, total: Cents }) {}

// after
abstract class DocumentBase extends Entity.abstract("Document")({
  id: DocId,
  total: Cents,
}) {
  /** shared behaviour lives on the root, and each variant owes this one */
  abstract signedAmount(): number;
}

class Invoice extends DocumentBase.extend("Invoice")({
  kind: z.literal("INVOICE"),
}) {
  override signedAmount(): number {
    return this.total;
  }
}

class CreditNote extends DocumentBase.extend("CreditNote")({
  kind: z.literal("CREDIT_NOTE"),
}) {
  override signedAmount(): number {
    return -this.total;
  }
}
```

A variant's `input` is the root's fields plus its own, so the shared half of a
stored row still validates unchanged. What is new is the **discriminant**, which
is a required field like any other — backfill it, or default it on the variant
that owns the old rows. See [Add a required field](#add-a-required-field).

The old rows are otherwise untouched: `_tag` moves from `"Document"` to
`"Invoice"`, but it is non-enumerable and never stored, so nothing on disk knows
the difference. Anything reading `entityName`, or matching on `P.tag`, does.

Options declared on the root are inherited, and a variant **adds** to them: name
only the keys and rules the variant itself introduces, and the root's still
apply. Nothing a root declared can be shed — `immutable: []` on a variant does
not widen its `updateInput`.
([How each option merges](/reference/declaration#root-extend-tag-fields-options).)

## Computed fields heal themselves

A computed field needs no migration story at all: `make` validates the
declared fields and **re-derives** every computed one, so a row written before
a derivation changed — or before the computed field existed — reads back
correct. See
[Computed columns heal themselves](/how-to/persist-and-rehydrate#computed-columns-heal-themselves)
for the persistence half, and
[Why `computed` re-derives](/explanation/computed-fields) for the reasoning.

## Decide what a failed read means

Every evolution tightens or loosens what `make` accepts, and a row that stops
validating is a real signal, not noise.
[Decide what a read failure means](/how-to/persist-and-rehydrate#decide-what-a-read-failure-means)
covers handling it; while an evolution is rolling out, the
[`InvalidEntity.message`](/reference/errors#message) in the log names the
entity and the failing fields, which is usually enough to tell a missed
backfill from corruption.
