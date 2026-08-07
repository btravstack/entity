---
"@btravstack/entity": minor
---

New `union(discriminant, members)`: a union of entities that is itself
entity-like.

```ts
const Member = union("kind", [User, ServiceAccount]);

Member.make(row).getOrThrow(); // User | ServiceAccount
Member.input; // discriminated union, one branch per member
Member.output; // ditto — JSON Schema in both directions
Member.instance; // parses to the member class, and nests as a field
Member.members; // the tuple, for registries and exhaustiveness
```

Previously a union of entities was a plain zod schema and you had to choose
which half to lose: `z.discriminatedUnion` over the `output` schemas gave a
contract but plain data, while `z.union` over the `instance` schemas gave
instances but no output JSON Schema. Neither had `make`.

It dispatches on the discriminant rather than trying each branch, so a member
whose own validation fails reports its own issues rather than every branch's.
