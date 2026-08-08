---
title: Billing domain example
description: Declaring entities — branded fields, generated/immutable/computed, invariants, nesting, abstract roots, unions and factories — in a runnable package.
---

# Billing domain

[`examples/billing-domain`](https://github.com/btravstack/entity/tree/main/examples/billing-domain)
— the modelling half: one standalone entity, a root with two variants under a
union, and the vocabulary they are all built from.

```sh
pnpm --filter @btravstack/entity-example-billing-domain test
```

## The vocabulary comes first

```ts
export const OrganizationId = z.uuid().brand("OrganizationId");
export const Slug = z.string().min(1).max(40).brand("Slug");
export const Instant = z.iso.datetime().brand("Instant");
```

Every data field is branded, and a bare `z.string()` is a **compile error**.
That is the guard, not an inconvenience: an `OrganizationId` and a `Slug` are
both strings at runtime, and nothing except a brand stops you passing one where
the other belongs.

`Money` is branded too, but it is an _object_:

```ts
export const Money = z
  .object({ amount: z.number().int(), currency: Currency })
  .brand("Money");
```

A value object — no identity, so it is branded rather than made an entity.
Amounts are integer minor units because binary floats are the wrong tool for
money. Minting one takes `Money.parse({ … })`; a plain object literal does not
satisfy the branded type, which is exactly the point.

## The entity

```ts
export class Organization extends Entity("Organization")(
  { id: OrganizationId, slug: Slug, name: DisplayName, createdAt: Instant },
  {
    generated: ["id", "createdAt"],
    immutable: ["id", "createdAt", "slug"],
    computed: {
      displayLabel: Entity.computed(
        DisplayLabel,
        (d) => `${d.name} (${d.slug})` as z.infer<typeof DisplayLabel>,
      ),
    },
    invariants: [
      Entity.invariant(
        (d) => d.name.length <= 80,
        "name must be at most 80 characters",
      ),
    ],
  },
) {
  get isSelfTitled(): boolean {
    return this.name.toLowerCase().startsWith(this.slug.toLowerCase());
  }
}
```

`generated` names what the domain produces rather than the caller, so those
fields drop out of `createInput`. `immutable` names what `update` refuses.
`computed` is re-derived on **every** construction path, so it cannot drift from
its sources — the spec checks that by renaming an organization and asserting the
label followed.

Behaviour lives in the class body. This is a real class, not a record with
functions bolted beside it.

## What both documents share is a root

An invoice and a credit note are siblings, not subtypes of one another: same
counterparty and money, opposite direction, their own identities. What they
share goes on an `Entity.abstract` root — tagless, with no `make` of its own,
extended rather than instantiated:

```ts
abstract class BillingDocumentBase extends Entity.abstract("BillingDocument")(
  { issuedTo: Organization, total: Money, issuedAt: Instant },
  {
    generated: ["issuedAt"],
    immutable: ["issuedAt", "issuedTo"],
    invariants: [
      Entity.invariant(
        (d) => d.total.amount >= 0,
        "total must not be negative",
      ),
    ],
  },
) {
  /** the rule both variants owe the ledger */
  abstract signedAmount(): number;

  get counterpartySlug(): string {
    return this.issuedTo.slug;
  }
}

export class Invoice extends BillingDocumentBase.extend("Invoice")(
  { id: InvoiceId, kind: z.literal("INVOICE") /* … */ },
  {
    generated: ["id", "issuedAt", "kind"],
    immutable: ["id", "issuedAt", "issuedTo", "kind"],
  },
) {
  override signedAmount(): number {
    return this.total.amount;
  }
}
```

`abstract signedAmount()` is the point of the root: a variant that forgets it
does not compile (`TS2515`). `counterpartySlug` is the other half — behaviour
written once and inherited, which is what a rebuilt-from-the-declaration
extension could not carry. An entity itself is final; `extend` lives only here.

Note what the variants re-state. `generated` and `immutable` **replace** the
root's list for that key rather than adding to it, so `Invoice` names `issuedAt`
and `issuedTo` again alongside its own. Only `invariants` concatenate — the
root's "total must not be negative" applies to both variants whether or not they
declare rules of their own.

## Nesting, and the factory

`issuedTo` is declared on the root, so every variant has one — and it is an
`Organization`, an entity used directly as a field. The class is itself a zod
schema, so it parses back to a real instance:

```ts
const rehydrated = Invoice.make(invoice.toJSON()).getOrThrow();
rehydrated.issuedTo instanceof Organization; // true
```

The package reads no clock and generates no id, so a factory is where those come
in — bound once, at the composition root:

```ts
export const createOrganization = Organization.factory({
  id: () => crypto.randomUUID() as z.infer<typeof OrganizationId>,
  createdAt: () => new Date().toISOString() as z.infer<typeof Instant>,
});
```

That is what leaves the entities trivially testable: nothing inside them reaches
for ambient state.

## Two things in this package that look odd on purpose

**`DunningReason` has thirty members.** Vocabularies that wide are ordinary in
billing, and this one is held at full width because it pins
[#31](https://github.com/btravstack/entity/issues/31). `TS7056` is a threshold
on serialised _characters_, so trimming the enum puts the example back under the
ceiling, where it compiles and guards nothing.

**`src/emit-guards.ts` is not example code.** It carries the assertions that
have no runtime moment — construction staying sealed, a construction key that
cannot be forged structurally, every `Entity.*` namespace member named so
declaration emit walks it. An **unused** `@ts-expect-error` in that file is a
failure rather than noise, because a namespace member emitted as a circular
self-alias still compiles and simply degenerates.

## The union discriminates data, not instances

```ts
export class BillingDocument extends Entity.union("kind", [
  Invoice,
  CreditNote,
]) {}
```

A class, not a value: `BillingDocument` is a type as well as a namespace for
statics, and as a type it is `BillingDocumentBase` — the root both members
share. `BillingDocument.make(row)` still returns the exact
`Result<Invoice | CreditNote, InvalidEntity>` — the spec asserts which class
comes back — and `Entity.Instance<typeof BillingDocument>` names that union,
which `emit-guards.ts` pins. The body holds statics only; the union has no
instances of its own.

`kind` is a **declared domain field** — `z.literal("INVOICE")` on one member and
`z.literal("CREDIT_NOTE")` on the other, both `generated` so no caller can supply
the wrong one.

It is tempting to reach for `_tag` here, since every entity has one. That does
not work, and fails quietly rather than loudly: `_tag` is non-enumerable, so it
is absent from `toJSON()` and from anything that has been through JSON. A union
built on it registers no members and rejects every payload with

```
Invalid discriminant undefined; expected one of
```

— an empty set. This example shipped that exact bug for one commit, because the
spec never called `make()` through the union. The specs now do, which is the
only reason it is not still there.

The two mechanisms are complementary, not alternatives:

|                  | Discriminates                          | Use                       |
| ---------------- | -------------------------------------- | ------------------------- |
| A declared field | **data** arriving from a wire or a row | `Entity.union("kind", …)` |
| `_tag`           | an **instance** you already hold       | `P.tag("Invoice")`        |

Related reference: [Declaring an entity](/reference/declaration).
