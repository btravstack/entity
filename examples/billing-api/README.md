# billing-api

The contract half: turning an entity into request and response schemas for
routes, without hand-writing omit lists that drift from the model.

```sh
pnpm --filter @btravstack/entity-example-billing-api test
```

## The rule

> **Contracts compose the four plain `ZodObject`s; domain code composes the
> class.**

`Organization.createInput`, `.updateInput`, `.input` and `.output` are ordinary
`ZodObject`s derived from one field map, so:

- they convert to JSON Schema in **both** directions,
- the usual combinators work on them (`.pick`, nesting in `z.object`, arrays),
- nothing restates the shape of an `Organization` anywhere in this package.

`createInput` is the field map minus whatever the entity declares `generated`;
`updateInput` is it minus `immutable` and minus the computed fields, with every
remaining key optional. Add a generated field to the entity and the create body
follows on its own — that is the omit list you did not have to write.

The class itself deliberately **does not** convert:

```ts
z.toJSONSchema(Organization, { io: "output" }); // throws, by design
```

It carries a `.transform()` — it parses to an _instance_, not to plain data —
and a transforming schema has no output representation. That is the reason the
four plain `ZodObject`s exist separately, and the spec pins it both ways.

See also the how-to: [Expose an HTTP
contract](https://btravstack.github.io/entity/how-to/http-contract).

## One thing worth copying

The JSON Schema exports carry an explicit `JsonSchema` annotation. That is not
style. Without it TypeScript infers a type it cannot _name_ from outside the
package, and any consumer emitting declarations fails with `TS2883` — "cannot
be named without a reference to 'JsonSchema' … this is likely not portable".
It is the same class of problem as [#31] and [#32], met from the other side,
and the cure is the same: give the type a name.

[#31]: https://github.com/btravstack/entity/issues/31
[#32]: https://github.com/btravstack/entity/issues/32
