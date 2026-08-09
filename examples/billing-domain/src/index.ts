/**
 * A small billing domain, modelled with `@btravstack/entity`.
 *
 * Four modules, in dependency order: `vocabulary.ts` (the branded field
 * vocabulary), `organization.ts` (one standalone entity), `root.ts` (the
 * abstract root the billing documents share) and this file — the two variants,
 * the union over them, and the factories binding them to their effect sources.
 * Every shape here is one a billing model actually needs — including the two
 * that once broke declaration emit for consumers: a branded `Money` object, and
 * a dunning vocabulary wide enough to matter. See `emit-guards.ts`.
 *
 * The root lives in its own module rather than beside its variants so the
 * two-compiler declaration pass covers the cross-module case, which is the only
 * one where the root has to be *named* rather than re-declared locally. The
 * reason is measured, and inline in `root.ts`.
 */
import { Entity } from "@btravstack/entity";
import { z } from "zod";

import { Organization } from "./organization.js";
import { BillingDocumentBase } from "./root.js";
import {
  CreditNoteId,
  DunningReason,
  InvoiceId,
  InvoiceStatus,
  Level,
  LineItem,
} from "./vocabulary.js";

export * from "./organization.js";
export * from "./root.js";
export * from "./vocabulary.js";

/* ── The billing documents ─────────────────────────────────────────────── */

export class Invoice extends BillingDocumentBase.extend("Invoice")(
  {
    id: Entity.field(InvoiceId, { generated: true, immutable: true }),
    kind: Entity.field(z.literal("INVOICE"), { generated: true, immutable: true }),
    lines: z.array(LineItem),
    status: InvoiceStatus,
    dunningReasons: z.array(DunningReason),
    level: Level,
  },
  {
    invariants: [
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
    return this.status === "ISSUED" || this.status === "DRAFT";
  }
}

/**
 * A credit note is an invoice's sibling, not its subtype: same counterparty and
 * money, opposite direction, its own identity. Modelling it as a second variant
 * of the root, sharing the `kind` discriminant, is what lets both travel down
 * one channel and come back as the right class.
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
export class BillingDocument extends Entity.union("kind", [Invoice, CreditNote]) {}

/* ── Binding the effect sources ────────────────────────────────────────
   The package reads no clock and generates no id. A factory is where those
   come in, bound once at the composition root — which is what leaves the
   entities themselves trivially testable.                                 */

const now = () => new Date().toISOString();

export const createOrganization = Organization.factory({
  id: () => crypto.randomUUID(),
  createdAt: now,
});

export const createInvoice = Invoice.factory({
  id: () => crypto.randomUUID(),
  issuedAt: now,
  // The discriminant is domain-generated, not caller-supplied: an invoice that
  // could be created claiming `kind: "CREDIT_NOTE"` would be a bug waiting to
  // happen, and `generated` keeps it out of `createInput` entirely.
  kind: () => "INVOICE" as const,
});

export const createCreditNote = CreditNote.factory({
  id: () => crypto.randomUUID(),
  issuedAt: now,
  kind: () => "CREDIT_NOTE" as const,
});
