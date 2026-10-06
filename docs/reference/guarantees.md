---
title: Guarantees and compatibility
description: What the library enforces at compile time, what it enforces at runtime, what it deliberately leaves to you, and the Node, TypeScript and zod versions it is checked against.
---

# Guarantees and compatibility

The package is for validated, immutable domain models in zod-based TypeScript
backends running on Node. This page is the whole contract in one place: what
the compiler enforces, what the runtime enforces, and what is deliberately
left to your application design. Each row comes from the source and its tests,
not from the explanation pages that argue for it.

## Enforced, and where

**Compile time** is checked by `tsc` and disappears with a cast. **Runtime** is
checked in the running code, whatever the types say. **Not covered** lists
deliberate exclusions, not bugs.

| Area               | Compile time                                                                                                                      | Runtime                                                                                                                                          | Not covered                                                                                                                                                                                    |
| ------------------ | --------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Construction       | `new SomeEntity(...)` does not compile: the constructor takes a `Sealed<D>` no outside code can produce                           | none. The constructor validates nothing and runs no invariant                                                                                    | Code that casts past the seal gets an **unvalidated instance**. The seal is a type-system guard, not a runtime trust boundary                                                                  |
| Field values       | every field must be branded, a narrow literal union or another entity; `_tag`, `equals`, `toJSON` and `update` are reserved names | `make`, `factory`, `factoryAsync`, `update` and the class used as a schema all parse against `input`                                             | `make` ignores unknown keys, as `z.object` does                                                                                                                                                |
| Invariants         | none                                                                                                                              | every rule runs on every construction path, `update` included; all failing rules report                                                          | rules spanning several entities or a database (uniqueness, counts) are yours                                                                                                                   |
| Data immutability  | the instance and `toJSON()` are `DeepReadonly`                                                                                    | data fields are non-writable; arrays and plain objects are deep-frozen; a `Date` is frozen against added properties only                         | a `Date`'s timestamp (`setTime` works), `Map`, `Set`, typed arrays, and any value a `z.custom`/`z.instanceof` field hands through, at any depth. No blanket deep-immutability claim is made    |
| Class-body state   | none                                                                                                                              | none: fields you declare in the class body are ordinary, writable properties                                                                     | they are outside `toJSON()`, `equals` and `update`, and are re-initialised on every new instance                                                                                               |
| `generated` flag   | the factory's input type omits the field                                                                                          | the factory spreads generated values last, so a caller cannot override them                                                                      | `make` accepts the field from data: it is the rehydrate path                                                                                                                                   |
| `immutable` flag   | `update`'s patch type omits the field                                                                                             | `update` rejects an immutable, computed or unknown key with an `InvalidEntity` at that key's path                                                | `make` accepts any valid value for it. Nothing compares a row against an earlier one                                                                                                           |
| Computed fields    | `from` is typed against the declared fields                                                                                       | re-derived on every construction; a stored computed value is ignored rather than trusted                                                         |                                                                                                                                                                                                |
| Finality           | none: TypeScript has no `final`                                                                                                   | constructing through a subclass of an entity is a defect                                                                                         |                                                                                                                                                                                                |
| Roots and variants | redeclaring a root's field is a compile error naming `FieldAlreadyDeclaredByTheRoot`                                              | the same redeclaration throws at declaration time                                                                                                | a root's `static` members are not inherited, and a root's class-body field is typed but never initialised; see [`Entity.abstract`](/reference/declaration#entity-abstract-name-fields-options) |
| Errors             | entry points return `Result<T, InvalidEntity>`                                                                                    | bad input is an `InvalidEntity`; a bug in domain code (a throwing `computed`, a rejecting async generator) is a defect, never an `InvalidEntity` | zod's own methods on the four schema members throw as zod documents, and `getOrThrow()` throws by name. See [Failure channels](#failure-channels)                                              |
| Equality           | none                                                                                                                              | `equals` is `node:util`'s `isDeepStrictEqual` over the stored data, between instances of the same entity                                         | it is value equality of the whole stored state, not identity by id. Class-body state is not compared                                                                                           |
| No I/O             | generators are typed per generated field                                                                                          | the package reads no clock and generates no id; it calls the generators you bind                                                                 | where those generators get their values                                                                                                                                                        |

The construction row and the immutability exclusions are pinned through a real
entity in `examples/billing-domain/src/comparison.spec.ts`; the rest by the
package's own specs and `*.test-d.ts` files.

## Supported versions

| Dependency                  | Declared          | Checked in CI                                                                                                                                          |
| --------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Node                        | `engines: ">=20"` | 22.19, 24 and 26. **Node 20 is declared, not proven**: the dev toolchain cannot start on 20, and no consumer-side check installs the tarball there yet |
| TypeScript                  | no peer range     | 7.0.2 builds and type-checks everything; 5.9.3 compiles a downstream library's declarations against the built package and type-checks what it emits    |
| `zod`                       | peer `^4.3.0`     | 4.6.5. The 4.3.0 floor was measured once, when the range was widened, and is not re-run per change                                                     |
| `unthrown`                  | peer `^5.0.0`     | 5.11.0                                                                                                                                                 |
| `@unthrown/standard-schema` | peer `^5.0.0`     | 5.11.0                                                                                                                                                 |

TypeScript older than 5.9.3 is untested. The package ships both ESM and CJS
builds. The three peers are peers so your copies are the ones in use; see
[Peer dependencies](/explanation/peer-dependencies). Adopting the package means
adopting their conventions too: zod schemas for fields, `unthrown` `Result`s
for every fallible call.

## Runtimes and the browser

The package is **Node-only**. Its equality imports `isDeepStrictEqual` from
`node:util`, and the built `dist/index.mjs` and `dist/index.cjs` both import it
at the top level, so importing the package at all needs `node:util`. Other
runtimes are untested, and browser support is not planned ahead of demand.

To share a contract with a browser client, share data, not the entity:

- **JSON Schema.** Convert `createInput`, `updateInput` and `output` on the
  server or at build time, and ship the JSON. All four schema members convert
  in both directions; [Expose an HTTP contract](/how-to/http-contract) has the
  recipe.
- **A zod-only module.** Keep the field vocabulary (the branded schemas) in a
  module that imports `zod` and nothing from `@btravstack/entity`. The client
  imports that module; the server builds entities from it.

## Schema composition

| Use                                                                            | Supported | Why                                                                                  |
| ------------------------------------------------------------------------------ | --------- | ------------------------------------------------------------------------------------ |
| the class as a field of another entity                                         | yes       | the class is a zod schema through its `_zod` and `~standard` slots                   |
| `z.object({ owner: SomeEntity })`, `z.array(SomeEntity)`, `z.optional(...)`    | yes       | the same slots; a nested failure keeps its full path                                 |
| the class wherever a Standard Schema is accepted                               | yes       | `~standard` is delegated                                                             |
| `input`, `output`, `createInput`, `updateInput` anywhere zod is accepted       | yes       | they are plain `ZodObject`s, including `.pick`, `.extend` and JSON Schema conversion |
| `z.toJSONSchema(SomeEntity, { io: "output" })`                                 | **no**    | throws: the class carries a `.transform()`, which has no output representation       |
| `SomeEntity.parse(...)`, `SomeEntity.optional()` or any other `ZodType` method | **no**    | only the two slots are delegated, so no throwing `.parse()` sits beside `make`       |

The rule behind the table: **contracts compose the four plain `ZodObject`s;
domain code composes the class.** See [Schema members](/reference/schemas).

## Failure channels

Three kinds of failure, and they never share a channel:

| Kind                   | What it means                   | How it reaches you                                                                                                            |
| ---------------------- | ------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| validation error       | the data is wrong               | `InvalidEntity` in the `Result`'s error channel, with structured `issues`                                                     |
| defect                 | the domain code has a bug       | the `Result`'s defect channel, kept apart from `InvalidEntity`                                                                |
| declaration-time throw | the declaration itself is wrong | a plain throw while the module loads: two union members claiming one discriminant value, a variant redeclaring a root's field |

[Errors](/reference/errors#which-channel-a-failure-takes) lists which failure
takes which channel. Two boundaries are worth knowing:

- When the class is nested in a schema that **zod** parses, zod's semantics
  apply: an `InvalidEntity` becomes ordinary zod issues, so `.parse()` throws a
  `ZodError` as it would for any field, and a defect is rethrown rather than
  folded into an issue.
- An abstract root has no instances. Reaching its constructor through a cast
  throws.

## What stays with your application

The package builds one entity at a time. It is compatible with domain-driven
design, and it does not do the design for you. It does **not**:

- **own aggregates.** Nesting an entity in another validates the tree; it does
  not stop other code from loading and changing the child on its own. Which
  entity is the root and who may change what is yours.
- **draw bounded contexts.** Two contexts that need different views of one
  concept declare two entities; nothing here detects one context reaching into
  another.
- **enforce valid transitions.** `update` checks that the _resulting_ state is
  valid, not that the move to it was allowed. "A paid invoice cannot go back to
  draft" needs the previous state, so it belongs in a method or a use case, or
  in a separate entity per state; see
  [Number without gaps](/how-to/number-without-gaps).
- **give identity semantics.** `equals` compares stored data. Two snapshots of
  one customer differ after an update; compare `a.id === b.id` for identity.
- **check anything across entities or storage**: uniqueness, optimistic
  concurrency, authorisation.

For how the same model looks in plain zod and in Effect, see
[Compared with zod and Effect](/explanation/compared).
