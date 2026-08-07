---
"@btravstack/entity": minor
---

An entity can now declare another entity as a field, so an aggregate is itself
an entity rather than a bare `z.object(...)`:

```ts
class Order extends Entity("Order")({
  id: OrderId,
  customer: Customer.instance,
  watchers: z.array(Customer.instance),
}) {}
```

The nested entities keep their behaviour, computed fields and `_tag`;
invariants can span the outer entity and a nested one; a nested validation
failure reports the full path; and `JSON.stringify` walks the tree to plain
data. Previously the field map rejected `Customer.instance`, so an aggregate
had to be a plain schema and lost `make`, `update`, invariants and immutability.

`instance` also now carries `_tag` in its type, matching what it has always set
at runtime.

The rejection message for a genuinely unbranded field is readable now — it
names `DomainFieldMustBeBrandedOrAnEntity` instead of a tuple TypeScript
truncated to `& [...]`.

A field may no longer take a name the entity installs on every instance —
`_tag`, `equals`, `toJSON` or `update`. Such a field used to shadow the member
silently: a field called `update` left `entity.update` holding a string, with
the method gone and no error anywhere. It is now a compile error naming
`FieldNameIsReservedByEntity`.
