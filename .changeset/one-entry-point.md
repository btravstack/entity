---
"@btravstack/entity": minor
---

**BREAKING**: `decode` is removed and the schema members are renamed.

`decode` and `make` had become the same function — both parse against the input
schema, re-derive the computed fields, check the invariants and construct. Two
public names for one operation, so there is now one: `make`.

`encoded`/`decoded` were named after those operations, so they are renamed for
what they are _for_, matching the `createInput`/`updateInput` vocabulary they
sit beside:

| before             | after            |
| ------------------ | ---------------- |
| `Entity.decode(x)` | `Entity.make(x)` |
| `Entity.encoded`   | `Entity.input`   |
| `Entity.decoded`   | `Entity.output`  |
| `Encoded<T>`       | `Input<T>`       |
| `Decoded<T>`       | `Output<T>`      |

`createInput` and `updateInput` are unchanged.
