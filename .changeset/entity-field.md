---
"@btravstack/entity": minor
---

Add `Entity.field(schema, flags)` and move `generated` / `immutable` off the
options object onto the fields themselves.

```ts
// before
class Organization extends Entity("Organization")(
  { id: OrgId, slug: Slug, name: DisplayName, createdAt: Instant },
  {
    generated: ["id", "createdAt"],
    immutable: ["id", "createdAt", "slug"],
  },
) {}

// after
class Organization extends Entity("Organization")({
  id: Entity.field(OrgId, { generated: true, immutable: true }),
  slug: Entity.field(Slug, { immutable: true }),
  name: DisplayName,
  createdAt: Entity.field(Instant, { generated: true, immutable: true }),
}) {}
```

A field that carries no flag stays a bare schema. The flags argument is
required — the function exists to flag — and a misspelled flag name is now a
compile error: a constraint is not an excess-property check, so
`{ generated: true, imutable: true }` used to compile clean and leave the field
silently mutable.

Nothing changes at runtime for a declaration that migrates one-for-one:
`createInput`, `updateInput`, the factory's generator map and `update`'s
rejection all derive from the same key sets, now read off the field map instead
of two lists beside it.

**Cost, measured.** A consumer's emitted declarations grow ~90 bytes per
_appearance_ of a flagged field — the billing-domain fixture's 10 flagged
fields appear 21 times across its `.d.ts` set, for +1,894 B / +8.0% in total.
The appearance count is a property of a domain's shape (a root shared by two
variants, an entity held as another entity's field), not a constant. The naive
design measured +57.8%; see the third item below for why this one does not.

## Breaking: the `generated` and `immutable` options are gone

Both keys are rejected on the options object of `Entity(tag)(…)`,
`Entity.abstract(name)(…)` and `Root.extend(tag)(…)`. `computed` and
`invariants` are what remains, and an entity declaring neither passes no options
object at all. The migration is mechanical:

| Before                                     | After                                                        |
| ------------------------------------------ | ------------------------------------------------------------ |
| `{ generated: ["id"] }`                    | `id: Entity.field(Id, { generated: true })`                  |
| `{ immutable: ["id"] }`                    | `id: Entity.field(Id, { immutable: true })`                  |
| `{ generated: ["id"], immutable: ["id"] }` | `id: Entity.field(Id, { generated: true, immutable: true })` |
| a key in neither list                      | the bare schema, unchanged                                   |

A key that appeared in a list but not in the field map was already a compile
error and has no migration.

## Breaking: `Entity.Static`, `Entity.Abstract` and `Entity.BaseInstance` lost type parameters

| Type                  | Now               | Was                  |
| --------------------- | ----------------- | -------------------- |
| `Entity.Static`       | `<Tag, S, A, B?>` | `<Tag, S, A, G, I>`  |
| `Entity.Abstract`     | `<Name, S, A>`    | `<Name, S, A, G, I>` |
| `Entity.BaseInstance` | `<S, A>`          | `<S, A, I>`          |

Their top-level spellings moved with them: `EntityStatic<Tag, S, A, B?>` (six
parameters to four — it was the one place `B` was already exposed),
`AbstractEntity<Name, S, A>` and `BaseInstance<S, A>`. The dropped parameters were the generated-
and immutable-key unions; they are computed inside each body from the flags `S`
carries. Hand-written annotations drop the extra arguments —
`Entity.Static<"Org", S, A, never, never>` becomes
`Entity.Static<"Org", S, A>`. Declarations infer them and need no change.

This is the reason the size cost above is +8.0% rather than +57.8%. A key union
in **type-argument** position cannot be de-aliased: the printer re-carries the
whole field map at every appearance, and an alias annotation, a defaulted
parameter plus `infer`, and a mapped-object indirection were each measured to
reconstitute the alias on both TypeScript 7.0.2 and 5.9.3. Computed inside a
body, `S` prints by name and the map appears once — with zero `GeneratedKeys<`
or `ImmutableKeys<` anywhere in the emitted output.

## Breaking: a variant may not redeclare a field its root declares

```ts
abstract class AccountBase extends Entity.abstract("Account")({
  id: AccountId,
  label: Label,
}) {}

AccountBase.extend("Clash")({ label: Label }); // ✗ FieldAlreadyDeclaredByTheRoot
```

This breaks a variant that restates an inherited field **even with no flags on
either side**, which previously compiled and simply re-declared the same schema.
The migration is to declare the field once, on the root, and delete it from the
variant. A variant that redeclared a key with a _different_ schema was already
reporting that key inconsistently (the instance property kept both brands
intersected, `TS2425`); it now has to pick one and put it on the root.

The compile error is backed by a **declaration-time defect**, thrown while the
declaration is on the stack, so a declaration reaching `extend` from JavaScript
or through a cast fails the same way:

```
Clash: field(s) "label" already declared by the root — a variant adds fields,
it does not redeclare them.
```

`computed` is unaffected: it still merges per key, and a variant may still
replace one of the root's derivations.

## Breaking: a variant can no longer flag a root-declared field

Under the old options accumulation, a variant could add `immutable: ["rootKey"]`
and tighten a field the root declared. There is no spelling for that now, and
the previous item is why: the only place a flag can be written is a field's
declaration, and the field is declared on the root.

Move the flag to the root, where every variant inherits it — flags ride the
field-map spread, so a variant gets them with the fields. If two variants
genuinely need different flags on the same key, they are not sharing that field:
declare it separately on each variant and leave it off the root.

Relaxing was never expressible and still is not: `immutable: []` did not widen
`updateInput` before, and there is no flag that reopens an inherited field now.
