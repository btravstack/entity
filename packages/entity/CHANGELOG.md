# @btravstack/entity

## 0.1.0

Initial release.

A domain-entity builder on zod v4. One declaration —
`class X extends Entity("X")(fields, options)` — yields a type, four plain
`ZodObject` validators, behaviour, and a class that is itself a zod schema.
Every fallible operation returns an `unthrown` `Result<T, InvalidEntity>`
instead of throwing.

### The surface

- **`Entity(tag)(fields, options?)`** derives `input`, `output`, `createInput`
  and `updateInput` from one field map plus `generated`, `immutable`,
  `computed` and `invariants`. Fields must be nominal — a branded schema, a
  narrow literal union, a boolean, or another entity — enforced at compile time.
- **`Entity.computed(schema, from)`** declares a derived field. It is re-derived
  on every construction path, so it cannot drift from its sources, and a stored
  row carrying a stale value is corrected on read rather than trusted.
- **`Entity.invariant(ensure, message)`** declares a rule spanning the whole
  entity. Every failing rule reports, and its issue carries no `path` — that
  absence is what distinguishes a whole-entity rule from a field complaint.
- **`Entity.union(discriminant, members)`** dispatches on a declared field
  rather than trying each branch, so a failing member reports its own issues.
- **`SomeEntity.make`, `.factory`, `.factoryAsync`, `.extend`**, and instance
  `update`, `toJSON`, `equals`. `make` is the only way in: a database row, a
  folded event stream and an untrusted payload all take the same path.

Everything you write against hangs off `Entity`. `BaseInstance`,
`ConstructionKey` and `Sealed` are also exported, but only so a downstream
library compiling with `declaration: true` can name them.

### What it guarantees

- **Sealed construction.** `new SomeEntity(...)` does not compile, so every
  instance has passed its invariants. The seal is a type, not a runtime check —
  a runtime guard would mean throwing.
- **Deep immutability.** Fields are installed non-writable _and_ their values
  deep-frozen, so `org.tags.push(…)` cannot push an entity into a state its own
  invariants rejected. A `z.custom`/`z.instanceof` value is left alone at any
  depth: it is the caller's own reference, and freezing it in place would break
  code that still owns it.
- **Errors are values.** Bad input is `InvalidEntity`, carrying structured
  Standard Schema issues. A bug in domain code — a `computed` function throwing,
  a rejecting async generator, subclassing an entity — is a separate defect
  channel.
- **No I/O.** The package reads no clock and generates no id. Generators are
  bound at your composition root, which is also what lets a test supply fixed
  ones without stubbing globals.

### Composition

An entity class is a zod schema, so entities nest inside each other and inside
ordinary `z.object`/`z.array` without losing their identity, behaviour or
issue paths. Contracts compose the four plain `ZodObject`s; domain code composes
the class. `z.toJSONSchema(SomeEntity, { io: "output" })` throws by design — the
class carries a transform, which is why the four plain objects exist separately.
