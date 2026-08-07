# Examples

Three small packages modelling one billing domain, each showing a different job
`@btravstack/entity` does.

📖 **[Annotated walkthroughs →](https://btravstack.github.io/entity/examples/)**

| Package                                        | Shows                                                                                                               |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| [`billing-domain`](./billing-domain)           | Declaring entities: branded fields, `generated` / `immutable` / `computed`, invariants, nesting, unions, factories. |
| [`billing-api`](./billing-api)                 | Composing the four plain `ZodObject`s into an HTTP contract and JSON Schema.                                        |
| [`billing-persistence`](./billing-persistence) | Storing and rehydrating: `toJSON()` out, `make()` back.                                                             |

Unlike the snippets in the guide, **this code compiles and is covered by
tests**. There is no broker, no database and no server to start:

```sh
pnpm install
pnpm test        # every example's specs
pnpm typecheck   # includes the declaration-emit passes
```

## Why `billing-domain` compiles its own declarations

It is not only an example. It is also the fixture proving a **downstream library
can build against this package** — the case where a consumer sets
`declaration: true` and TypeScript has to write entity's types into its own
`.d.ts`.

That pass runs twice, on two TypeScript versions, and the second one is the
point: the repo builds with the 7.x native port, which does not enforce the 5.x
ceiling on serialised type length. Two declaration-emit bugs shipped through
that blind spot ([#31], [#32]) while every other check stayed green.

`billing-domain/src/emit-guards.ts` carries the assertions that have no runtime
moment — the construction seal, a forged construction key, every namespace
member. It is a test, not a pattern to copy, and it says so.

[#31]: https://github.com/btravstack/entity/issues/31
[#32]: https://github.com/btravstack/entity/issues/32
