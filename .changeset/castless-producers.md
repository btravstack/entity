---
"@btravstack/entity": minor
---

Producer callbacks are now typed as their schema's **input**, so the cast they
all carried is gone:

```ts
// before
shout: Entity.computed(Upper, (d) => d.name.toUpperCase() as z.infer<typeof Upper>),
id: () => crypto.randomUUID() as z.infer<typeof OrgId>,

// after
shout: Entity.computed(Upper, (d) => d.name.toUpperCase()),
id: () => crypto.randomUUID(),
```

Nothing changes at runtime: a computed value was always parsed by its own schema
on every construction path, and generated values always went through `make`'s
validation. The types now say so. Existing code compiles unchanged — a branded
return still assigns to its schema's input.

One narrowing: a generator for a field that is both `.optional()` and
`generated` was an optional key and is now required (it may return `undefined`).
Declaring that combination is not known to occur anywhere.
