---
"@btravstack/entity": minor
---

**BREAKING**: `InvalidEntity.issues` is now `SchemaIssues` (Standard Schema
issues) instead of `readonly string[]`.

Schema failures keep the `path` of the field that failed, so a caller can key a
field-level error response off it instead of parsing a rendered string. An
`invariants` violation has no `path` — the absence distinguishes a whole-entity
rule from a field complaint. Through `instance`, paths now compose with the
nested entity's position (`["owner", "slug"]`).

Migration: `e.issues` yields objects, not strings — use `i.message`, and
`i.path` where you want the field.
