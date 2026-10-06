# billing-api

The contract half: selecting request and response schemas for routes from an
entity, without exposing what the domain keeps to itself.

```sh
pnpm --filter @btravstack/entity-example-billing-api test
```

## The rule

> **Contracts compose the four plain `ZodObject`s; domain code composes the
> class.**

`Organization.createInput`, `.updateInput`, `.input` and `.output` are
ordinary `ZodObject`s derived from one field map. They are **building blocks**,
not the contract: `output` is the stored shape, and `updateInput` is everything
the domain lets change, whoever is asking. `Organization.riskTier` is in both,
and no customer may see or set it.

So every public schema here is **selected** from them:

- **The response is an allowlist.** `Organization.output.pick(...)` names the
  public fields. A field the entity grows later stays out until someone adds it,
  which an `.omit({ riskTier: true })` would not do. The spec grows the shape and
  checks.
- **The response has a mapping.** It adds `selfTitled`, class behaviour rather
  than stored state, so `toOrganizationResponse(org)` builds it field by field.
  `org.toJSON()` is the stored shape, for persistence only.
- **Each command takes its own keys.** `CreateOrganizationBody` and
  `RenameOrganizationBody` `.pick` what their operation needs and are
  `.strict()`, so a caller sending `riskTier` is rejected. The domain letting a
  field change is not authorization.

Every field's type still comes from the entity: nothing restates a schema.

The class itself deliberately **does not** convert:

```ts
z.toJSONSchema(Organization, { io: "output" }); // throws, by design
```

It carries a `.transform()` — it parses to an _instance_, not to plain data —
and a transforming schema has no output representation. That is the reason the
four plain `ZodObject`s exist separately, and the spec pins it both ways.

## Sharing it with a browser

This module imports the entity, and the entity imports `node:util`, so a
browser bundle cannot include it. The exported JSON Schemas are plain JSON:
write them to files at build time and ship those instead.

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
