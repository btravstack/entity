/**
 * Gapless numbering, modelled as two states rather than one nullable field.
 *
 * Some numbers are legally required to be consecutive — an invoice series with
 * a hole in it is a finding at audit. That guarantee is a property of a
 * *transaction*, never of a field: a database sequence hands out numbers
 * outside the transaction, so a rollback burns one permanently. What the entity
 * can do is refuse to exist without its number.
 *
 * The tempting shape is one `Invoice` with `number: number | null`, stamped
 * later. It types every read site as nullable forever to describe a state that
 * lasts milliseconds. Two variants of one root say the same thing without the
 * null: a `DraftInvoice` has no `number` **field**, an `IssuedInvoice` has a
 * `number` that is `generated` and `immutable`, and the transition between them
 * is a `factoryAsync` call. Shared data and shared behaviour live on the root,
 * declared once.
 *
 * Contrast `Invoice` in the domain package, which carries a `status` field
 * covering DRAFT and ISSUED. A status field is the right tool when both states
 * hold the same data. Here they do not — one of them has a number — and that is
 * what makes it a second entity.
 *
 * See also the how-to: <https://btravstack.github.io/entity/how-to/number-without-gaps>.
 */
import { Entity } from "@btravstack/entity";
import { Instant, Money, Slug } from "@btravstack/entity-example-billing-domain";
import { P, type AsyncResult } from "unthrown";
import { z } from "zod";

export const InvoiceNumber = z.number().int().positive().brand("InvoiceNumber");
export const Series = z.string().min(1).max(8).brand("Series");

type SeriesValue = z.infer<typeof Series>;
type InvoiceNumberValue = z.infer<typeof InvoiceNumber>;

/**
 * What both states are. Tagless, so it carries the shared fields and the shared
 * behaviour into each variant without being an entity itself.
 */
abstract class InvoiceBase extends Entity.abstract("Invoice")(
  {
    series: Entity.field(Series, { immutable: true }),
    issuedTo: Entity.field(Slug, { immutable: true }),
    total: Money,
  },
  {
    invariants: [Entity.invariant((d) => d.total.amount >= 0, "total must not be negative")],
  },
) {
  get reference(): string {
    return `${this.series}/${this.issuedTo}`;
  }
}

/** Numberless by construction, so no read site has to check for one. */
export class DraftInvoice extends InvoiceBase.extend("DraftInvoice")({
  state: Entity.field(z.literal("DRAFT"), { generated: true, immutable: true }),
}) {}

/**
 * Numbered by construction. The invariant is stricter than the root's on
 * purpose: a draft may total zero while it is being assembled, an issued
 * invoice may not — which is what makes a stamp fallible, and therefore what
 * makes handing the number back a case that has to work.
 */
export class IssuedInvoice extends InvoiceBase.extend("IssuedInvoice")(
  {
    state: Entity.field(z.literal("ISSUED"), { generated: true, immutable: true }),
    number: Entity.field(InvoiceNumber, { generated: true, immutable: true }),
    issuedAt: Entity.field(Instant, { generated: true, immutable: true }),
  },
  {
    invariants: [
      Entity.invariant((d) => d.total.amount > 0, "an issued invoice must bill something"),
    ],
  },
) {}

export const createDraftInvoice = DraftInvoice.factory({ state: () => "DRAFT" });

/**
 * The port. `next` is what the database's counter row does; `release` is what
 * its transaction does for free.
 */
export type NumberAllocator = {
  next(series: SeriesValue): Promise<InvoiceNumberValue>;
  release(series: SeriesValue, number: InvoiceNumberValue): void;
};

/**
 * Stands in for `update invoice_counter set last = last + 1 where series = $1
 * returning last`. The row lock that statement takes is what serialises
 * concurrent writers; the surrounding transaction is what returns the number
 * when the insert fails.
 *
 * ponytail: a Map plus an explicit `release`, sound only because this runs one
 * draft at a time. Swap it for the counter row when it stops being a demo —
 * nothing above this line changes.
 */
export class InMemorySeriesCounter implements NumberAllocator {
  readonly #last = new Map<string, number>();

  next(series: SeriesValue): Promise<InvoiceNumberValue> {
    const next = (this.#last.get(series) ?? 0) + 1;
    this.#last.set(series, next);
    return Promise.resolve(InvoiceNumber.parse(next));
  }

  release(series: SeriesValue, number: InvoiceNumberValue): void {
    // Only the newest number can go back. Releasing any other would reopen a
    // hole in the middle of the series instead of closing one at the end.
    if (this.#last.get(series) === number) this.#last.set(series, number - 1);
  }
}

/**
 * The transition. `toJSON()` is the draft's data and the generated fields
 * spread last, so the draft's own `state` cannot survive into an issued
 * invoice — a caller cannot forge one by handing over a doctored projection.
 *
 * The allocation sits inside the generator rather than in front of the call:
 * that is what turns an unreachable counter into a Defect instead of a
 * rejection escaping this function.
 *
 * One draft at a time, in order, or two workers race for the same number. In
 * production that is one consumer per series, not a comment.
 */
export const issue =
  (numbers: NumberAllocator, at: z.infer<typeof Instant>) =>
  (draft: DraftInvoice): AsyncResult<IssuedInvoice, Entity.InvalidEntity> => {
    let allocated: InvoiceNumberValue | undefined;

    return IssuedInvoice.factoryAsync({
      state: () => Promise.resolve("ISSUED"),
      issuedAt: () => Promise.resolve(at),
      number: async () => {
        allocated = await numbers.next(draft.series);
        return allocated;
      },
      // An invariant that fires after the number was taken is the case the
      // whole design exists for: give it back, or the series has a gap in it
      // forever. A rejected allocation never took one, so `allocated` is
      // undefined on that path and there is nothing to return.
    })(draft.toJSON()).tapErrCases((m) =>
      m.with(P.tag("InvalidEntity"), () => {
        if (allocated !== undefined) numbers.release(draft.series, allocated);
      }),
    );
  };
