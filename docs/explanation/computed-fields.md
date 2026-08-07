---
title: Why computed re-derives
description: Why a derived field is recomputed on every construction instead of stored, why make validates against input, and when to use a getter instead.
---

# Why `computed` re-derives

A computed field reads the declared fields and is re-derived on `make` and
`update` alike, rather than computed once and stored.

The alternative was tried and is quietly wrong. Deriving `fullName` from
`first` + `last` once, then renaming the person, leaves `fullName` frozen at the
old value — and since a derived field is not patchable, unrepairable. Every
plausible use (`totalCents`, `tier`, `wordCount`, `durationDays`) has that shape.

Re-deriving also makes `make` self-healing: a row written before a derivation
changed, or before the field existed at all, is corrected on read rather than
trusted. That is why `make` validates against `input` and not `output` —
validating stored computed values would reject exactly the rows it is meant to
repair.

## Why not a getter?

Because a getter carries no schema. It cannot appear in `output`, cannot
generate JSON Schema, and is skipped by `toJSON()` — it lives on the prototype,
not in the data. The rule:

|                                                    | use        |
| -------------------------------------------------- | ---------- |
| derived, needed in the response body / JSON Schema | `computed` |
| derived, domain-only behaviour                     | a getter   |

[Persist and rehydrate](/how-to/persist-and-rehydrate#computed-columns-heal-themselves)
shows the self-healing read against a real table.
