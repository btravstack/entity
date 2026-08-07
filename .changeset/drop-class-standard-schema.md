---
"@btravstack/entity": minor
---

**BREAKING**: the entity class no longer carries `~standard`.

It bought one thing — `fromSchema(Organization)` in place of
`fromSchema(Organization.instance)` — while making the class a validator in
some contexts and not others: `z.object({ owner: Organization })` never
worked, because zod needs a real `ZodType`. Two spellings of one concept that
were not interchangeable.

`instance` is a zod schema and zod implements Standard Schema, so it already
carries `~standard` and is accepted by anything that takes one.

Migration: `fromSchema(Organization)` → `fromSchema(Organization.instance)`,
which is the spelling that works everywhere rather than most places.
