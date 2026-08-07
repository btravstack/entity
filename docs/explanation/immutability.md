---
title: Immutability
description: Why both halves matter — non-writable bindings and a deep freeze — and exactly what the freeze does and does not cover.
---

# Immutability

Data is immutable in both halves. Each field is installed non-writable, and its
value is **deep-frozen** — a shallow guard would leave `org.tags.push(…)` legal,
which could push an entity into a state its own invariants had already
rejected. The instance type is `DeepReadonly<…>`, not a shallow `Readonly<…>`,
so mutation is a compile error first and a `TypeError` only if a consumer casts
around the type system:

```ts
org.slug = otherSlug; // ✗ compile error — read-only property
(org as never as Record<string, unknown>).slug = "hacked"; // TypeError

// on a `Team` declared with `tags: z.array(Tag)` and `address: Address`
team.tags.push(tag); // ✗ compile error — tags is `readonly Tag[]`
(team.tags as never as string[]).push("hacked"); // TypeError — the array is frozen
team.address.city = "Paris"; // ✗ compile error — nested objects are readonly too
```

Locking the binding alone would not be enough: `writable: false` stops
`team.tags = [...]` but not `team.tags.push(...)`, and a shallow `Readonly<D>`
types an array field as a mutable `Tag[]`, because `z.infer` of `z.array(Tag)`
is `Tag[]`. Both halves matter — the second is what lets `invariants` mean
anything after construction.

## What the freeze covers

What the freeze covers is deliberately narrow: arrays and plain objects are
frozen and recursed into; `Date` is frozen as a leaf; `Map`, `Set` and typed
arrays are left alone, because freezing those is either theatre (a frozen `Map`
still accepts `.set`) or destructive. A field whose schema yields a live mutable
object is outside the guarantee.

A `z.custom(...)`/`z.instanceof(...)` field is skipped **by its schema**, not by
what the value turns out to look like at runtime. That distinction is the whole
point: `z.custom` hands back the caller's own reference, and a plain-object one
is indistinguishable at runtime from decoded data. Deciding by runtime shape
froze objects the caller still owned, so their next write threw. Only the
declaration knows which values were passed through, so that is where the
decision is made.

`Object.freeze(this)` is **not** used and cannot be: a class body's field
initialisers run after `super()` returns, so the instance itself must stay
extensible.
