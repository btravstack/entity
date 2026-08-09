---
"@btravstack/entity": minor
---

`Entity.union(...)` returns a value, not a class.

## Breaking: the class form is gone

```ts
// before
class Payment extends Entity.union("method", [Card, BankTransfer]) {}

// after
export const Payment = Entity.union("method", [Card, BankTransfer]);
export type Payment = Entity.Instance<typeof Payment>;
```

The class form typed as the members' shared _root_, not as the member union, so
it could not narrow — and it failed late, at the first call site that touched a
member-only field. A class's instance type cannot be a union (`TS2509`), so no
version of it could have narrowed; and its type was always redundant with the
root the author had already named. `class X extends Entity.union(...) {}` is now
`TS2507` at the declaration.

Statics that lived in the class body become plain functions:

```ts
export const parsePayment = (row: unknown) => Payment.make(row);
```

## Breaking: `__base` is removed

The phantom `__base` carrier is gone from `EntityStatic` and `UnionMember`. It
existed only to compute the class form's root type. Nothing writes it by hand;
it is listed because it is part of the emitted public surface.
