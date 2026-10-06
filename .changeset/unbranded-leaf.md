---
"@btravstack/entity": minor
---

`Entity.field(schema, { unbranded: true })` exempts one field from the rule
that every field be branded, an entity or a narrow literal. It is meant for a
descriptive leaf (a label, a display name) with no second value it could be
confused with, whose brand would otherwise leak into every consumer of the
derived schemas. The field is still validated and still honours `immutable`;
only the branding rule is relaxed, and only for that field. Existing
declarations are unchanged, and their emitted declarations do not grow.
