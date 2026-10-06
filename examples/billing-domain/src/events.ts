/**
 * What the invoice commands announce.
 *
 * Events are **values a command returns beside the entity**. Nothing here
 * dispatches, and no entity emits from `make`, `update` or a factory: an
 * `InvoiceIssued` exists because `issue` ran, never because a `status` field
 * differs between two instances. Importing a legacy row, correcting a typo and
 * issuing can all end in similar state, and only one of them is an issuance.
 *
 * Two layers, on purpose. The domain events are internal: they may carry
 * whatever the model's own projections need, private state included. The
 * integration contract is what leaves the service, and it is written by hand
 * from the domain event, so a field added to the model is never published by
 * accident.
 */
import { z } from "zod";

import type {
  Instant,
  InvoiceId,
  InvoiceNumber,
  LineItem,
  Money,
  OrganizationId,
} from "./vocabulary.js";

/* ── Internal domain events ─────────────────────────────────────────── */

export type InvoiceIssued = {
  readonly type: "InvoiceIssued";
  readonly invoiceId: z.infer<typeof InvoiceId>;
  readonly number: z.infer<typeof InvoiceNumber>;
  readonly issuedTo: z.infer<typeof OrganizationId>;
  readonly issuedAt: z.infer<typeof Instant>;
  readonly total: z.infer<typeof Money>;
  /** Internal detail: revenue projections want it, the outside world does not. */
  readonly lines: readonly z.infer<typeof LineItem>[];
};

export type InvoiceVoided = {
  readonly type: "InvoiceVoided";
  readonly invoiceId: z.infer<typeof InvoiceId>;
  readonly number: z.infer<typeof InvoiceNumber>;
};

export type InvoiceEvent = InvoiceIssued | InvoiceVoided;

/* ── The public integration contract ────────────────────────────────────
   Versioned, unbranded (a consumer in another service has no brands), and
   deliberately narrower than the domain event. `InvoiceVoided` has no public
   counterpart at all: not every internal fact is a published one.         */

export const InvoiceIssuedV1 = z.strictObject({
  type: z.literal("billing.invoice-issued.v1"),
  invoiceId: z.string(),
  number: z.number().int(),
  customerId: z.string(),
  issuedAt: z.string(),
  total: z.object({ amount: z.number().int(), currency: z.string() }),
});

export const toInvoiceIssuedV1 = (event: InvoiceIssued): z.infer<typeof InvoiceIssuedV1> => ({
  type: "billing.invoice-issued.v1",
  invoiceId: event.invoiceId,
  number: event.number,
  customerId: event.issuedTo,
  issuedAt: event.issuedAt,
  total: { amount: event.total.amount, currency: event.total.currency },
});
