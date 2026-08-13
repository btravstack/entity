---
title: Number without gaps
description: Give an entity a consecutive, gapless number by modelling the numbered state as its own variant, and by allocating the number where a rollback can take it back.
---

# Number without gaps

**Problem:** an entity needs a number that is legally required to be
consecutive — an invoice series, a receipt book — and a hole in the sequence is
a finding at audit rather than a cosmetic defect.

> Snippets below assume these imports:
>
> ```ts
> import { z } from "zod";
> import { Entity } from "@btravstack/entity";
> ```
>
> Domain vocabulary — entities, brands, factories — is whatever your own
> domain declares.

## Decide whether you need it at all

Gapless is not the same as unique. If the number is an identifier, take a
database sequence and accept the holes: everything below costs you write
concurrency, and it buys nothing a `uuid` does not already give you. Reach for
this only when something outside your system counts the sequence.

Note the other half of that requirement while you are here. A gapless series
cannot survive a `DELETE`, so the rows are append-only forever and a mistake is
corrected by issuing a reversal, never by removing a row.

## Allocate where a rollback can take the number back

The guarantee is a property of a transaction, not of a field. No declaration in
this library can provide it, and no database sequence can either:
`serial`, `identity` and `nextval` all hand out numbers outside the
transaction, so a rollback burns one permanently. That is the intended
behaviour of a sequence, not a bug in it.

What works is a counter row bumped inside the same transaction as the insert:

```sql
create table invoice_counter (series text primary key, last int not null default 0);
alter table invoice add constraint uq_invoice_number unique (series, number);
```

```ts
const allocateNumber = async (tx: Tx, series: string) => {
  const { rows } = await tx.query(
    `update invoice_counter set last = last + 1 where series = $1 returning last`,
    [series],
  );
  // A driver hands back `unknown`. Mint the brand by parsing it, never by
  // asserting it — the row is data crossing a boundary like any other.
  return InvoiceNumber.parse(rows[0].last);
};
```

The row lock that `update` takes serialises concurrent writers, and the
rollback un-bumps the counter along with the insert it was for. The unique
constraint is the belt to those braces.

## Model the numbered state as its own entity

The shape that suggests itself is one entity with `number: number | null`,
stamped in later. It types every read site as nullable forever to describe a
state that lasts milliseconds, and it gives you nothing to hold when you want
"an invoice that definitely has a number".

Declare two variants of one root instead. The shared data and the shared
behaviour are written once, on the root:

```ts
abstract class InvoiceBase extends Entity.abstract("Invoice")(
  {
    series: Entity.field(Series, { immutable: true }),
    issuedTo: Entity.field(Slug, { immutable: true }),
    total: Money,
  },
  {
    invariants: [
      Entity.invariant(
        (d) => d.total.amount >= 0,
        "total must not be negative",
      ),
    ],
  },
) {
  get reference(): string {
    return `${this.series}/${this.issuedTo}`;
  }
}

export class DraftInvoice extends InvoiceBase.extend("DraftInvoice")({
  state: Entity.field(z.literal("DRAFT"), { generated: true, immutable: true }),
}) {}

export class IssuedInvoice extends InvoiceBase.extend("IssuedInvoice")(
  {
    state: Entity.field(z.literal("ISSUED"), {
      generated: true,
      immutable: true,
    }),
    number: Entity.field(InvoiceNumber, { generated: true, immutable: true }),
    issuedAt: Entity.field(Instant, { generated: true, immutable: true }),
  },
  {
    invariants: [
      Entity.invariant(
        (d) => d.total.amount > 0,
        "an issued invoice must bill something",
      ),
    ],
  },
) {}
```

A draft has no `number` field, so forgetting to check for one is a compile
error rather than a `null` in a report. `IssuedInvoice["number"]` is
`InvoiceNumber`, never `InvoiceNumber | null`. Variants accumulate onto a root,
so the stricter invariant on the issued variant runs in addition to the root's,
not instead of it — see [Declaring an entity](/reference/declaration).

A `status` field is still the right tool when both states carry the same data.
What makes this a second entity is that one of the states holds a field the
other cannot.

## Write the transition as a factory call

Generated fields spread last, so the transition is the draft's own projection
handed to the issued variant's factory:

```ts
const issue =
  (numbers: NumberAllocator, at: Instant) => async (draft: DraftInvoice) => {
    let allocated: InvoiceNumber | undefined;

    const issued = await IssuedInvoice.factoryAsync({
      state: () => Promise.resolve("ISSUED"),
      issuedAt: () => Promise.resolve(at),
      number: async () => {
        allocated = await numbers.next(draft.series);
        return allocated;
      },
    })(draft.toJSON());

    if (!issued.isOk() && allocated !== undefined)
      numbers.release(draft.series, allocated);

    return issued;
  };
```

Three things are load bearing there.

The draft's own `state` cannot survive into an issued invoice, because the
generated fields are spread over the caller's input rather than under it. A
caller cannot forge an issued invoice by handing over a doctored projection.

The allocation sits **inside** the generator rather than in front of the call.
A generator that rejects becomes a Defect, so an unreachable counter is
reported as infrastructure failing rather than as bad domain input — and it
never escapes this function as a rejection.

The number is handed back when construction fails. An invariant that fires
after the number was allocated is precisely the case gaplessness has to
survive; with a real transaction the rollback does this for you, which is why
the allocator's `release` disappears when you swap the in-memory counter for
the counter row.

## Number after the fact when throughput demands it

Everything above allocates on the request path, which means the counter row is
a lock every writer queues behind. If that becomes the bottleneck, keep the
same two entities and move the transition to a worker: requests write drafts,
and a stamping process turns them into issued invoices later.

The counter does not go away, it relocates. Each stamp is still one transaction
that bumps the counter and writes the number, so a failed stamp still rolls its
number back. What you gain is that the user's insert no longer waits on the
lock.

It costs three constraints, and all three are easy to discover late:

- **One consumer per series.** Two workers stamping the same series race for
  the same number. Partition by series, or run a single consumer.
- **One transaction per stamp**, not one per batch. A batch that fails halfway
  either rolls back numbers it should have kept or keeps numbers it should have
  released.
- **Numbering order may diverge from creation order** when a stamp is retried.
  That satisfies the legal requirement, which is about holes rather than order,
  but it will be reported as a bug by someone eventually.

## Why there is no lazy field flag

The declaration this page works around — a field that is generated, immutable,
and filled in later — is not a field. It is a state transition, and spelling it
as a flag would type the field as `number | undefined` at every read site
anyway. That is the same cost as the nullable column, moved somewhere harder to
notice.

Two variants pay the cost once, at the boundary where the state actually
changes, and let every other line of the model say what it means. Store them
however you like: the two projections differ by exactly the fields the states
differ by, which is what
[Persist and rehydrate](/how-to/persist-and-rehydrate) is about.
