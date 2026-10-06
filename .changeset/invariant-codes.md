---
"@btravstack/entity": minor
---

`Entity.invariant` takes an optional third argument, `{ code }`, giving a rule
a stable identity a caller can key behaviour off — an error code in a response,
a field to highlight, a localised string — where the message may vary with the
data. The code rides on the issue as `params.code`, survives nested entities,
arrays and unions with the path prefixed, and is read back with the new
`Entity.codeOf(issue)`. A rule without a code produces the same `{ message }`
issue as before.
