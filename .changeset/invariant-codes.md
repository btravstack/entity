---
"@btravstack/entity": minor
---

**Breaking:** `Entity.invariant` now takes one object with a required stable
`code`:

```ts
Entity.invariant({
  code: "NAME_TOO_LONG",
  ensure: (d) => d.name.length <= 80,
  message: "name must be at most 80 characters",
});
```

The code is the rule's identity, which a caller keys behaviour off (an error
code in a response, a field to highlight, a localised string), while the
message may vary with the data. A failing rule's issue is now
`{ message, params: { code } }`; the code survives nested entities, arrays and
unions with the path prefixed, and the new `Entity.codeOf(issue)` reads it back.

To migrate, wrap each `Entity.invariant(ensure, message)` as
`Entity.invariant({ code, ensure, message })`. A missing code is a compile
error.
