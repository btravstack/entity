/**
 * The field vocabulary.
 *
 * Every data field is branded. A bare `z.string()` is a compile error, and that
 * is the point: an OrganizationId and a Slug are both strings, and the model
 * should not let you pass one where the other belongs.
 */
import { z } from "zod";

export const OrganizationId = z.uuid().brand("OrganizationId");
export const InvoiceId = z.uuid().brand("InvoiceId");
export const CreditNoteId = z.uuid().brand("CreditNoteId");
export const Slug = z.string().min(1).max(40).brand("Slug");
export const DisplayName = z.string().min(1).brand("DisplayName");
export const DisplayLabel = z.string().min(1).brand("DisplayLabel");
export const Instant = z.iso.datetime().brand("Instant");
export const LineLabel = z.string().min(1).brand("LineLabel");

/**
 * The accounting period a document falls in — `2026-03`. Billing reports and
 * revenue recognition both work per period, so it is derived from the issue
 * date rather than stored beside it, where the two could disagree.
 */
export const AccountingPeriod = z
  .string()
  .regex(/^\d{4}-\d{2}$/)
  .brand("AccountingPeriod");

export const Currency = z.enum(["EUR", "USD", "GBP"]);

/**
 * A value object: no identity, so it is a *branded object* rather than an
 * entity. Amounts are integer minor units — `12_00` is €12.00 — because binary
 * floats are the wrong tool for money.
 */
export const Money = z.object({ amount: z.number().int(), currency: Currency }).brand("Money");

export const LineItem = z
  .object({ label: LineLabel, unit: Money, quantity: z.number().int().positive() })
  .brand("LineItem");

export const InvoiceStatus = z.enum(["DRAFT", "ISSUED", "PAID", "VOID", "UNCOLLECTIBLE"]);

/** Escalation step of a dunning run. */
export const Level = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);

/**
 * Why an invoice entered dunning. Vocabularies this wide are ordinary in
 * billing — and this one is kept at full width deliberately, because it is what
 * pins issue #31. Read the note in `emit-guards.ts` before trimming it.
 */
export const DunningReason = z.enum([
  "CANCELED_LEASE",
  "TENANT_LEAVE_BALANCE_DONE",
  "SUBROGATIVE_RECEIPT_TO_BE_SIGNED",
  "SUBROGATIVE_RECEIPT_SIGNED",
  "NO_RGI_CLAIM",
  "VISALE",
  "MONTHLY_PAYMENT",
  "GROWTH",
  "UNIT_SOLD",
  "EXPENSE_TRANSFER",
  "DECEASED_TENANT",
  "DECEASED_COOWNER",
  "DISPUTE_CHARGES",
  "DISPUTE_REPAIRS",
  "OWNER_INSTRUCTIONS_EXCLUDING_GLI",
  "CHECK_OR_CASH_NOT_RECORDED",
  "AWAITING_CAF_PAYMENT",
  "NEW_BUILDING",
  "NEW_COOWNER",
  "MANAGEMENT_DIFFICULTIES",
  "SALE_IN_PROGRESS",
  "PROMISE_OF_PAYMENT",
  "FALSE_DISTRIBUTIONS",
  "INSTITUTIONAL_COOWNER",
  "HISTORICAL",
  "TENANT_LEAVE_NO_REMINDER",
  "EXTERNAL_RGI_DISASTER",
  "OVER_INDEBTEDNESS_LEGAL_PROCEEDINGS",
  "MEMORANDUM_OF_AGREEMENT",
  "MANUAL_EXPENSE_TRANSFER",
]);
