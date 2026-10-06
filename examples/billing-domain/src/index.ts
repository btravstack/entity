/**
 * A small billing domain, modelled with `@btravstack/entity`.
 *
 * Five modules, in dependency order: `vocabulary.ts` (the branded field
 * vocabulary), `organization.ts` (one standalone entity), `root.ts` (the
 * abstract root the billing documents share), `events.ts` (what the commands
 * announce) and this file — the variants, their commands, the union over them,
 * and the factories binding them to their effect sources. Every shape here is
 * one a billing model actually needs — including the two that once broke
 * declaration emit for consumers: a branded `Money` object, and a dunning
 * vocabulary wide enough to matter. See `emit-guards.ts`.
 *
 * The root lives in its own module rather than beside its variants so the
 * two-compiler declaration pass covers the cross-module case, which is the only
 * one where the root has to be *named* rather than re-declared locally. The
 * reason is measured, and inline in `root.ts`.
 */
import { Entity } from "@btravstack/entity";
import { Err, Ok, type Result, TaggedError } from "unthrown";
import { z } from "zod";

import type { InvoiceIssued, InvoiceVoided } from "./events.js";
import { Organization } from "./organization.js";
import { BillingDocumentBase } from "./root.js";
import {
  CreditNoteId,
  type Currency,
  DunningReason,
  type Instant,
  InvoiceId,
  InvoiceNumber,
  InvoiceStatus,
  Level,
  LineItem,
  Money,
} from "./vocabulary.js";

export * from "./events.js";
export * from "./organization.js";
export * from "./root.js";
export * from "./vocabulary.js";

/* ── The invoice lifecycle ─────────────────────────────────────────────── */

/**
 * An invoice's lifecycle is two variants of the root, not one entity with a
 * `status: "DRAFT"`: an issued invoice carries a `number` a draft cannot have,
 * and a draft's lines are editable where an issued invoice's are frozen.
 * Moving between them is a **command** — `issue` — never a patch, because a
 * patch cannot change which class an instance is.
 *
 * On a draft, the root's `issuedAt` is provisional; `issue` restamps it.
 */
export class DraftInvoice extends BillingDocumentBase.extend("DraftInvoice")({
  id: Entity.field(InvoiceId, { generated: true, immutable: true }),
  kind: Entity.field(z.literal("DRAFT_INVOICE"), { generated: true, immutable: true }),
  lines: z.array(LineItem),
}) {
  /** A draft is not on the ledger yet. */
  override signedAmount(): number {
    return 0;
  }

  /**
   * A command with nothing worth announcing returns the entity alone. The
   * currency check compares the *argument* with the current state, so it is
   * the command's to make: the rule is about this change, not about a state.
   */
  addLine(
    line: z.infer<typeof LineItem>,
  ): Result<DraftInvoice, CurrencyMismatch | Entity.InvalidEntity> {
    if (line.unit.currency !== this.total.currency) {
      return Err(
        new CurrencyMismatch({ expected: this.total.currency, received: line.unit.currency }),
      );
    }
    // Inside the pipeline, so a `parse` that throws (an amount past the safe
    // integer range) becomes a Defect rather than escaping the method.
    return Ok({
      amount: this.total.amount + line.unit.amount * line.quantity,
      currency: this.total.currency,
    })
      .map((total) => Money.parse(total))
      .flatMap((total) => this.update({ lines: [...this.lines, line], total }));
  }

  /**
   * Draft to issued. The number and the instant are **external preconditions**
   * handed in by the caller: allocating a gapless number is a transaction's
   * job, and the package reads no clock.
   *
   * The event is built here, from the new instance, because issuing is the
   * fact it records — not something discovered by comparing two states.
   */
  issue(facts: {
    readonly number: z.infer<typeof InvoiceNumber>;
    readonly at: z.infer<typeof Instant>;
  }): Result<
    { readonly entity: Invoice; readonly events: readonly [InvoiceIssued] },
    Entity.InvalidEntity
  > {
    // The draft's identity carries over: issuing changes which variant the
    // invoice is, not which invoice it is. Its `kind` and provisional
    // `issuedAt` do not — the generators replace both.
    return Invoice.factory({
      id: () => this.id,
      kind: () => "INVOICE" as const,
      issuedAt: () => facts.at,
      number: () => facts.number,
    })({
      issuedTo: this.issuedTo,
      total: this.total,
      // A copy: an entity's arrays are frozen and typed readonly.
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
}

export class Invoice extends BillingDocumentBase.extend("Invoice")(
  {
    id: Entity.field(InvoiceId, { generated: true, immutable: true }),
    kind: Entity.field(z.literal("INVOICE"), { generated: true, immutable: true }),
    number: Entity.field(InvoiceNumber, { generated: true, immutable: true }),
    // Frozen once issued. `immutable` closes the field to `update` outright —
    // the one kind of transition rule a declaration can carry.
    lines: Entity.field(z.array(LineItem), { immutable: true }),
    status: InvoiceStatus,
    dunningReasons: z.array(DunningReason),
    level: Level,
  },
  {
    // State invariants: true of every valid invoice, whatever path built it.
    invariants: [
      Entity.invariant((d) => d.lines.length > 0, "an issued invoice bills at least one line"),
      Entity.invariant(
        (d) => d.status !== "VOID" || d.dunningReasons.length === 0,
        "a void invoice cannot be in dunning",
      ),
    ],
  },
) {
  override signedAmount(): number {
    return this.total.amount;
  }

  get isCollectable(): boolean {
    return this.status === "ISSUED";
  }

  /**
   * A transition rule: PAID and VOID are both valid states, and going from the
   * first to the second is still forbidden — a paid invoice is reversed with a
   * credit note. No invariant can say that, since an invariant sees only the
   * resulting state. `update({ status: "VOID" })` accepts it, which is why the
   * public boundary exposes this command and not `update`.
   *
   * The command also establishes the target's invariant ("a void invoice
   * cannot be in dunning") rather than failing on it.
   */
  void(): Result<
    { readonly entity: Invoice; readonly events: readonly [InvoiceVoided] },
    InvoiceNotVoidable | Entity.InvalidEntity
  > {
    if (this.status !== "ISSUED") {
      return Err(new InvoiceNotVoidable({ invoiceId: this.id, status: this.status }));
    }
    return this.update({ status: "VOID", dunningReasons: [], level: 0 }).map((entity) => ({
      entity,
      events: [{ type: "InvoiceVoided", invoiceId: entity.id, number: entity.number }] as const,
    }));
  }
}

/* ── Business errors ───────────────────────────────────────────────────
   Typed, so a caller matches on the tag rather than on prose. They sit beside
   `InvalidEntity` in a command's error channel: `InvalidEntity` says the
   resulting state would be malformed, these say the request was refused.  */

export class InvoiceNotVoidable extends TaggedError("InvoiceNotVoidable")<{
  readonly invoiceId: z.infer<typeof InvoiceId>;
  readonly status: z.infer<typeof InvoiceStatus>;
}> {
  override message = `invoice ${this.invoiceId} is ${this.status}; only an ISSUED invoice can be voided`;
}

export class CurrencyMismatch extends TaggedError("CurrencyMismatch")<{
  readonly expected: z.infer<typeof Currency>;
  readonly received: z.infer<typeof Currency>;
}> {
  override message = `a ${this.received} line cannot be added to a ${this.expected} invoice`;
}

/**
 * A credit note is an invoice's sibling, not its subtype: same counterparty and
 * money, opposite direction, its own identity. Modelling it as another variant
 * of the root, sharing the `kind` discriminant, is what lets every billing
 * document travel down one channel and come back as the right class.
 */
export class CreditNote extends BillingDocumentBase.extend("CreditNote")({
  id: Entity.field(CreditNoteId, { generated: true, immutable: true }),
  kind: Entity.field(z.literal("CREDIT_NOTE"), { generated: true, immutable: true }),
  against: Entity.field(InvoiceId, { immutable: true }),
}) {
  override signedAmount(): number {
    return -this.total.amount;
  }
}

/**
 * Dispatches on `kind` — a **declared domain field**, never the entity's
 * `_tag`. That distinction is the whole design: `_tag` is non-enumerable, so it
 * is absent from `toJSON()` and from anything that has been through JSON, and a
 * union built on it would register no members and reject every payload with
 * "expected one of " — an empty set.
 *
 * The two mechanisms are not redundant. This field discriminates **data** on
 * the way in; `P.tag(...)` matches an **instance** you already hold.
 */
export const BillingDocument = Entity.union("kind", [DraftInvoice, Invoice, CreditNote]);
export type BillingDocument = Entity.Instance<typeof BillingDocument>;

/* ── Binding the effect sources ────────────────────────────────────────
   The package reads no clock and generates no id. A factory is where those
   come in, bound once at the composition root — which is what leaves the
   entities themselves trivially testable.                                 */

const now = () => new Date().toISOString();

export const createOrganization = Organization.factory({
  id: () => crypto.randomUUID(),
  createdAt: now,
});

export const createDraftInvoice = DraftInvoice.factory({
  id: () => crypto.randomUUID(),
  issuedAt: now,
  // The discriminant is domain-generated, not caller-supplied: a draft that
  // could be created claiming `kind: "INVOICE"` would skip `issue` entirely,
  // and `generated` keeps it out of `createInput`.
  kind: () => "DRAFT_INVOICE" as const,
});

// There is no `createInvoice`. An issued invoice comes from `issue`, or from
// `Invoice.make` when a stored one is read back — never from scratch.

export const createCreditNote = CreditNote.factory({
  id: () => crypto.randomUUID(),
  issuedAt: now,
  kind: () => "CREDIT_NOTE" as const,
});
