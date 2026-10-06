---
title: Billing domain example
description: Declaring entities — branded fields, the generated/immutable flags, computed, invariants, nesting, abstract roots, unions, factories, and commands returning events — in a runnable package.
---

# Billing domain

[`examples/billing-domain`](https://github.com/btravstack/entity/tree/main/examples/billing-domain)
— the modelling half: one standalone entity, a root with three variants under a
union, the commands that move an invoice through its lifecycle, and the
vocabulary they are all built from.

```sh
pnpm --filter @btravstack/entity-example-billing-domain test
```

Five modules, in dependency order: `vocabulary.ts`, `organization.ts`,
`root.ts`, `events.ts`, and `index.ts` — the variants and their commands, the
union over them, and the factories. The root sits in a module of its own on purpose;
[why](#three-things-in-this-package-that-look-odd-on-purpose).

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
  {
    id: Entity.field(OrganizationId, { identity: true, generated: true }),
    slug: Entity.field(Slug, { immutable: true }),
    name: Entity.field(z.string().min(1), { unbranded: true }),
    createdAt: Entity.field(Instant, { generated: true, immutable: true }),
    riskTier: z.enum(["STANDARD", "WATCHLIST", "BLOCKED"]).optional(),
  },
  {
    computed: {
      displayLabel: Entity.computed(
        DisplayLabel,
        (d) => `${d.name} (${d.slug})`,
      ),
    },
    invariants: [
      Entity.invariant({
        code: "NAME_TOO_LONG",
        ensure: (d) => d.name.length <= 80,
        message: "name must be at most 80 characters",
      }),
    ],
  },
) {
  get isSelfTitled(): boolean {
    return this.name.toLowerCase().startsWith(this.slug.toLowerCase());
  }
}
```

`Entity.field(schema, flags)` is how a field says more than its shape.
`generated` marks what the domain produces rather than the caller, so those
fields drop out of `createInput`; `immutable` marks what `update` refuses.
`name` carries neither, so it stays a bare schema. `computed` is re-derived on
**every** construction path, so it cannot drift from its sources — the spec
checks that by renaming an organization and asserting the label followed.

`name` is **unbranded**: free display text, with nothing it could be confused
with, so it opts out of the branding rule rather than carrying a brand every
consumer of the public response would have to mint.
[Branded fields](/explanation/branded-fields#a-leaf-with-nothing-to-confuse-it-with)
explains when that is the right call; `id` and `slug` keep their brands.

`riskTier` is internal: the credit team sets it and no customer may see it. It
is still an ordinary mutable field, because the domain does not know who is
asking. Keeping it private is the contract's job, and
[the HTTP contract example](/examples/billing-api) does it with an allowlist.

Behaviour lives in the class body. This is a real class, not a record with
functions bolted beside it.

## What both documents share is a root

An invoice and a credit note are siblings, not subtypes of one another: same
counterparty and money, opposite direction, their own identities. What they
share goes on an `Entity.abstract` root — tagless, with no `make` of its own,
extended rather than instantiated:

```ts
// root.ts — exported, so entities in another module can extend it
export abstract class BillingDocumentBase extends Entity.abstract(
  "BillingDocument",
)(
  {
    issuedTo: Entity.field(Organization, { immutable: true }),
    total: Money,
    issuedAt: Entity.field(Instant, { generated: true, immutable: true }),
  },
  {
    computed: {
      period: Entity.computed(AccountingPeriod, (d) => d.issuedAt.slice(0, 7)),
    },
    invariants: [
      Entity.invariant({
        code: "NEGATIVE_TOTAL",
        ensure: (d) => d.total.amount >= 0,
        message: "total must not be negative",
      }),
    ],
  },
) {
  /** what the document contributes to the ledger — declared once, signed per variant */
  abstract signedAmount(): number;

  get counterpartySlug(): string {
    return this.issuedTo.slug;
  }
}

// index.ts
export class Invoice extends BillingDocumentBase.extend("Invoice")(
  {
    id: Entity.field(InvoiceId, { generated: true, immutable: true }),
    kind: Entity.field(z.literal("INVOICE"), {
      generated: true,
      immutable: true,
    }),
    number: Entity.field(InvoiceNumber, { generated: true, immutable: true }),
    lines: Entity.field(z.array(LineItem), { immutable: true }),
    /* … status, dunningReasons, level */
  },
  {
    invariants: [
      Entity.invariant({
        code: "ISSUED_WITHOUT_LINES",
        ensure: (d) => d.lines.length > 0,
        message: "an issued invoice bills at least one line",
      }),
      Entity.invariant({
        code: "VOID_IN_DUNNING",
        ensure: (d) => d.status !== "VOID" || d.dunningReasons.length === 0,
        message: "a void invoice cannot be in dunning",
      }),
    ],
  },
) {
  override signedAmount(): number {
    return this.total.amount;
  }
}
```

`abstract signedAmount()` is the point of the root: a variant that forgets it
does not compile (`TS2515`). It is _declared_ once and _implemented_ per
variant — a credit note returns `-this.total.amount`, and a draft invoice, not
on the ledger yet, returns `0`. `counterpartySlug`
is the other half: behaviour written once and inherited, which is what a
rebuilt-from-the-declaration extension could not carry. An entity itself is
final; `extend` lives only here.

Note what the variants do **not** state. `Invoice` declares only the fields it
introduces: `issuedAt` is generated and `issuedAt`/`issuedTo` immutable because
the root's fields carry those flags, and the flags travel with the fields into
every variant. Restating one is not the way to keep it — a variant that named
`issuedAt` again would not compile at all
([why](/reference/declaration#a-variant-may-not-redeclare-an-inherited-field)).
The options accumulate root-then-variant, `computed`
merging per key rather than concatenating: `period` — the accounting period,
derived from `issuedAt`, because reports work per period and a stored copy could
disagree with the date — is on every variant without any of them naming it.
`invariants` work the same way: the root's "total must not be negative" applies
to every variant whether or not it declares rules of its own, and `Invoice`
declares two of its own. The spec pins
the inheritance both ways — patching `issuedAt` on an invoice is refused, and
`invoice.period` is derived, though `Invoice` mentions neither.

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
  id: () => crypto.randomUUID(),
  createdAt: () => new Date().toISOString(),
});
```

That is what leaves the entities trivially testable: nothing inside them reaches
for ambient state.

## Commands move an invoice through its lifecycle

An invoice is two variants of the root. A `DraftInvoice` has editable lines and
no number; an `Invoice` has a `number`, frozen `lines`, and a `status` covering
the states that share that shape. There is no `createInvoice`: an issued
invoice comes from `issue`, or from `Invoice.make` when a stored one is read
back.

Three commands, each an ordinary method on the variant it applies to:

```ts
draft.addLine(line); // Result<DraftInvoice, CurrencyMismatch | InvalidEntity>
draft.issue({ number, at }); // Result<{ entity: Invoice; events: [InvoiceIssued] }, InvalidEntity>
invoice.void(); // Result<{ entity: Invoice; events: [InvoiceVoided] }, InvoiceNotVoidable | InvalidEntity>
```

`issue` takes its number and instant as arguments, because allocating one is a
transaction's job and reading the other is a clock's. `void` refuses a paid
invoice with a typed `InvoiceNotVoidable`, though PAID and VOID are both valid
states. The spec pins that refusal, and pins the other side too: the same
change spelled `paid.update({ status: "VOID" })` succeeds, which is why a
module boundary should expose commands rather than `update`.

`events.ts` holds what the commands announce, and the integration contract
published from `InvoiceIssued`. That contract is narrower than the domain
event: the lines stay internal. The spec also checks that `make` and `update`
announce nothing.

The pattern is [Write commands and events](/how-to/write-commands); the
reasoning is [Invariants and transitions](/explanation/invariants-and-transitions).

## A subscription decides in events

`Subscription` (`src/subscription.ts`) is an `Entity.aggregate`: it has no
`update()`, and its state changes only through `SubscriptionStarted`,
`SeatsChanged` and `SubscriptionCancelled`. `changeSeats` and `cancel` check
their business rules, return a typed error when one fails, and otherwise call
`this.emit(...)`, which returns the events together with the verified state.
The persistence example stores those decisions as state rows and as an event
stream without changing this file. See
[Model an event-driven aggregate](/how-to/model-an-event-driven-aggregate).

## Three things in this package that look odd on purpose

**The root is exported, and alone in `root.ts`.** A root's instance type is the
last type argument of every variant's `Entity.Static`, so it reaches the `.d.ts`
of whatever module the variants are exported from — and it reaches it two
different ways. Beside its variants, TypeScript synthesises a local
`declare abstract class`; across a module boundary it has to _name_ the export,
and `index.d.ts` opens with `import { BillingDocumentBase } from "./root.js"`.
While the root sat in `index.ts`, only the first path was ever compiled. Both
are clean on TypeScript 7.0.2 and 5.9.3 — the split is what keeps the second one
that way.

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
export const BillingDocument = Entity.union("kind", [
  DraftInvoice,
  Invoice,
  CreditNote,
]);
export type BillingDocument = Entity.Instance<typeof BillingDocument>;
```

A value, and a type of the same name beside it. `BillingDocument.make(row)`
returns `Result<DraftInvoice | Invoice | CreditNote, InvalidEntity>` — the spec
asserts which class comes back — and the type is that same union, which
`emit-guards.ts` pins. There is no class form to reach for: putting the union at
a base-class position is `TS2507` at the declaration, because a class's instance
type cannot be a union at all (`TS2509`).

`kind` is a **declared domain field** — one literal per member,
`"DRAFT_INVOICE"`, `"INVOICE"` and `"CREDIT_NOTE"`, each flagged `generated` so
no caller can supply the wrong one.

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
