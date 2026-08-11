---
title: Why computed re-derives
description: Why a derived field is recomputed on every construction instead of stored, why make validates against input, when to use a getter instead, and how a deriver calls the entity's own statics.
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

## Self-referencing derivers

A deriver may call the entity's own statics. The return annotation on the
deriver is what makes it compile:

```ts
class Doc extends Entity("Doc")(
  { id: Entity.field(Id, { immutable: true }), tags: z.array(Tag) },
  {
    computed: {
      active: Entity.computed(z.boolean(), (d): boolean =>
        Doc.isActive(d.tags),
      ),
    },
  },
) {
  static isActive(tags: Tags): boolean {
    return !tags.includes("ARCHIVED");
  }
}
```

Leave the annotation off and TypeScript reports `TS2506: 'Doc' is referenced
directly or indirectly in its own base expression`, plus `TS7024` on the
deriver — and the failure cascades, so the error surface looks far larger than
the one line causing it. The self-reference is not the problem; the deriver's
**inferred** return type is. The options object sits inside the `extends`
clause, and inferring the arrow's return type forces the class to resolve
mid-declaration. The annotation preempts that inference, and the body is
checked later, once the class exists.

The annotation is not an escape hatch — it is checked on both faces. A static
returning the wrong type errors in the deriver body, on the offending line; an
annotation disagreeing with the schema (or widened to `unknown`) errors at the
`Entity.computed` call. And `d` stays contextually typed: an undeclared field
is still a compile error.

The same rule and the same fix apply to `Entity.invariant`.

Two edges. A variant calling its **root's** statics needs no annotation — the
root is an already-settled class. And `this` cannot work at all: a
`this: typeof Doc` parameter is a type annotation inside the class's own
declaration (`TS2502`), and the library cannot supply the type on your behalf,
because the statics live in a class body TypeScript has not formed yet.
