---
title: Write commands and events
description: Change an entity through named commands that refuse forbidden transitions with typed errors, move between lifecycle variants, and return explicit domain events beside the new state.
---

# Write commands and events

**Problem:** the business says what may happen to an entity — an invoice is
issued, voided, given a line — and `update()` only checks that the result is a
valid state. You want each operation to refuse the transitions the business
forbids, and to say what happened so the application can act on it.

> Snippets below assume these imports:
>
> ```ts
> import { z } from "zod";
> import { Err, Ok, P, TaggedError, type Result } from "unthrown";
> import { Entity } from "@btravstack/entity";
> ```
>
> They follow the
> [billing domain example](/examples/billing-domain), where every snippet on
> this page compiles and is covered by a test.

## Name the operation as a method

A command is an ordinary method in the class body. It reads the current
instance, decides, and builds the next one through `update` or a factory.
Neither path mutates anything, so the source is untouched whatever happens:

```ts
export class DraftInvoice extends BillingDocumentBase.extend("DraftInvoice")({
  id: Entity.field(InvoiceId, { generated: true, immutable: true }),
  kind: Entity.field(z.literal("DRAFT_INVOICE"), {
    generated: true,
    immutable: true,
  }),
  lines: z.array(LineItem),
}) {
  addLine(
    line: z.infer<typeof LineItem>,
  ): Result<DraftInvoice, CurrencyMismatch | Entity.InvalidEntity> {
    if (line.unit.currency !== this.total.currency) {
      return Err(
        new CurrencyMismatch({
          expected: this.total.currency,
          received: line.unit.currency,
        }),
      );
    }
    return Ok({
      amount: this.total.amount + line.unit.amount * line.quantity,
      currency: this.total.currency,
    })
      .map((total) => Money.parse(total))
      .flatMap((total) => this.update({ lines: [...this.lines, line], total }));
  }
}
```

The `Money.parse` sits inside the pipeline on purpose. A throw there is a bug,
not a business outcome, and a combinator turns it into a Defect instead of
letting it escape the method.

A pure function taking the entity works just as well. Pick a method when the
command belongs to one variant, since the method then exists only where the
command makes sense.

## Refuse a forbidden transition with a typed error

Declare each refusal as a `TaggedError` carrying the facts a caller needs, and
return it before building anything:

```ts
export class InvoiceNotVoidable extends TaggedError("InvoiceNotVoidable")<{
  readonly invoiceId: z.infer<typeof InvoiceId>;
  readonly status: z.infer<typeof InvoiceStatus>;
}> {
  override message = `invoice ${this.invoiceId} is ${this.status}; only an ISSUED invoice can be voided`;
}

// in the body of `Invoice`
void(): Result<
  { readonly entity: Invoice; readonly events: readonly [InvoiceVoided] },
  InvoiceNotVoidable | Entity.InvalidEntity
> {
  if (this.status !== "ISSUED") {
    return Err(new InvoiceNotVoidable({ invoiceId: this.id, status: this.status }));
  }
  return this.update({ status: "VOID", dunningReasons: [], level: 0 }).map(
    (entity) => ({
      entity,
      events: [
        { type: "InvoiceVoided", invoiceId: entity.id, number: entity.number },
      ] as const,
    }),
  );
}
```

A paid invoice and a void invoice are both valid states, and `void` still
refuses to go from one to the other. That rule is about the change, so no
invariant can hold it.

Keep `Entity.InvalidEntity` in the error channel beside the business errors.
The two answer different questions: a business error says the request was
refused, an `InvalidEntity` says the state it would produce is malformed.

Make the command establish the target state's invariants rather than trip over
them. `void` clears the dunning reasons because "a void invoice cannot be in
dunning" would otherwise reject every voided invoice that was in dunning.

## Move between variants when the fields change

When one state carries a field the other cannot, model the states as
[variants of one root](/how-to/number-without-gaps#model-the-numbered-state-as-its-own-entity)
and write the transition as a call to the target variant's factory:

```ts
// in the body of `DraftInvoice`
issue(facts: {
  readonly number: z.infer<typeof InvoiceNumber>;
  readonly at: z.infer<typeof Instant>;
}): Result<
  { readonly entity: Invoice; readonly events: readonly [InvoiceIssued] },
  Entity.InvalidEntity
> {
  return Invoice.factory({
    id: () => this.id,
    kind: () => "INVOICE" as const,
    issuedAt: () => facts.at,
    number: () => facts.number,
  })({
    issuedTo: this.issuedTo,
    total: this.total,
    lines: [...this.lines],
    status: "ISSUED",
    dunningReasons: [],
    level: 0,
  }).map((entity) => ({
    entity,
    events: [
      {
        type: "InvoiceIssued",
        invoiceId: entity.id,
        number: entity.number,
        issuedTo: entity.issuedTo.id,
        issuedAt: entity.issuedAt,
        total: entity.total,
        lines: entity.lines,
      },
    ] as const,
  }));
}
```

The `id` generator returns the draft's own id: issuing changes which variant
the invoice is, not which invoice it is. The issued variant's invariants, such
as "an issued invoice bills at least one line", run on the way in, so `issue`
does not check them again.

The variants also remove transitions outright. `issue` exists only on a draft
and `void` only on an issued invoice, so issuing an issued invoice is a compile
error rather than a refusal.

## Take external facts as arguments

A command decides from the entity and its arguments, and from nothing else.
Whatever needs I/O is settled by the caller first and passed in. `issue` takes
the invoice number and the instant: the number comes from a transaction (see
[Number without gaps](/how-to/number-without-gaps)) and the instant from the
caller's clock, since the package reads [no clock](/explanation/no-io).

A precondition that depends on other aggregates, such as "the customer is not
on credit hold", is checked by the application before it calls the command. If
the entity has to know, pass the fact in as an argument.

## Return events beside the new entity

A command that announces something returns
`Result<{ entity, events }, …>`. Each event is a plain value with a
deliberate name and a typed payload:

```ts
export type InvoiceIssued = {
  readonly type: "InvoiceIssued";
  readonly invoiceId: z.infer<typeof InvoiceId>;
  readonly number: z.infer<typeof InvoiceNumber>;
  readonly issuedTo: z.infer<typeof OrganizationId>;
  readonly issuedAt: z.infer<typeof Instant>;
  readonly total: z.infer<typeof Money>;
  readonly lines: readonly z.infer<typeof LineItem>[];
};
```

Build the event inside the command, from the new instance. `InvoiceIssued`
exists because `issue` ran, not because `status` differs between two
instances. An import, a correction and an issuance can all end in the same
state, and only one of them is an issuance.

Typing `events` as a tuple, `readonly [InvoiceIssued]`, tells the caller
exactly what the command announces. A refused command returns an `Err`, so
there is no event to dispatch by construction.

A command with nothing worth announcing returns the entity alone, as `addLine`
does. Do not invent an event to make every command look the same.

## Keep make and update silent

`make`, `update` and the factories return the entity and nothing else. Reading
a stored invoice back, healing a stale computed column, or patching a dunning
level is not a business fact, and none of them produces an event. Events come
from commands only, so the set of commands is the set of things that can be
announced.

## Save the state and the events in one transaction

The entity never dispatches. The application takes the outcome and writes both
halves atomically: the replacement row, and one outbox row per event.
Publication happens after the commit, by whatever reads the outbox.

```ts
const voidInvoice = (tx: Tx, id: InvoiceId) =>
  invoices
    .load(tx, id)
    .flatMap((invoice) => invoice.void())
    .flatMap(({ entity, events }) =>
      invoices.save(tx, entity).flatMap(() => outbox.append(tx, events)),
    );
// the caller commits `tx` on Ok and rolls it back otherwise
```

A refused command never reaches `save`, so nothing is written. A failed write
rolls back the state and the outbox rows together. The repository half of this
is [Persist and rehydrate](/how-to/persist-and-rehydrate).

## Publish a contract, not the domain event

A domain event is internal. It may carry whatever the model's own projections
need, private state included. What leaves the service is a separate, versioned
contract, mapped from the domain event by hand:

```ts
export const InvoiceIssuedV1 = z.strictObject({
  type: z.literal("billing.invoice-issued.v1"),
  invoiceId: z.string(),
  number: z.number().int(),
  customerId: z.string(),
  issuedAt: z.string(),
  total: z.object({ amount: z.number().int(), currency: z.string() }),
});

export const toInvoiceIssuedV1 = (
  event: InvoiceIssued,
): z.infer<typeof InvoiceIssuedV1> => ({
  type: "billing.invoice-issued.v1",
  invoiceId: event.invoiceId,
  number: event.number,
  customerId: event.issuedTo,
  issuedAt: event.issuedAt,
  total: { amount: event.total.amount, currency: event.total.currency },
});
```

The mapping names every published field, so a field added to the domain event
is not published until someone adds it here. The lines stay internal, and
`InvoiceVoided` has no public counterpart at all. Not every internal fact is a
published one.

## Expose commands at the module boundary

`update()` is public on every entity, so any code holding an invoice can patch
`status` to `VOID` and skip `void`'s check entirely. The example's spec shows
that call succeeding. Close the gap at the module boundary: export application
functions that load, run a command and save, and keep the entity's `update` to
code inside the domain module.

```ts
// the application module's public surface
export const issueInvoice = (deps: Deps) => (id: InvoiceId) => …;
export const voidInvoice = (deps: Deps) => (id: InvoiceId) => …;
// not exported: anything that hands callers an `Invoice` to `update`
```

`immutable` is the one transition rule a declaration can carry: the issued
variant's `lines` cannot be patched by anyone. Everything else is enforced by
who can reach `update`. Why the library stops there is in
[Invariants and transitions](/explanation/invariants-and-transitions).
