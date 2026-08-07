---
"@btravstack/entity": minor
---

New `extend` static on every entity: build a new entity from an existing
one's declaration. It is `SomeEntity.extend(tag)(fields)`, a static on the
class — not a property of the `Entity` builder.

```ts
class PersonWithAge extends Person.extend("PersonWithAge")({ age: Age }) {
  get isAdult(): boolean {
    return this.age >= 18;
  }
}
```

The result is its own entity — own tag, own schemas, own `equals` identity —
rather than a variant of the parent, which is what distinguishes it from the
bare subclassing that remains refused.

The parent's options are inherited and merged per key, child winning, so an
extension is never quietly laxer than what it extends. Extensions can
themselves be extended.

`extend` rebuilds from the declaration, so class-body members (a getter, a
method) are not carried over; re-declare them or use a plain function.
