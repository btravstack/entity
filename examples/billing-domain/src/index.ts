/**
 * A small billing domain, modelled with `@btravstack/entity`.
 *
 * Read it top to bottom: the field vocabulary first, then the two entities,
 * then the factories binding them to their effect sources. Every shape here is
 * one a billing model actually needs — including the two that once broke
 * declaration emit for consumers: a branded `Money` object, and a dunning
 * vocabulary wide enough to matter. See `emit-guards.ts`.
 */
import { Entity } from "@btravstack/entity";
import { z } from "zod";

/* ── The field vocabulary ──────────────────────────────────────────────
   Every data field is branded. A bare `z.string()` is a compile error, and
   that is the point: an OrganizationId and a Slug are both strings, and the
   model should not let you pass one where the other belongs.              */

export const OrganizationId = z.uuid().brand("OrganizationId");
export const InvoiceId = z.uuid().brand("InvoiceId");
export const Slug = z.string().min(1).max(40).brand("Slug");
export const DisplayName = z.string().min(1).brand("DisplayName");
export const DisplayLabel = z.string().min(1).brand("DisplayLabel");
export const Instant = z.iso.datetime().brand("Instant");
export const LineLabel = z.string().min(1).brand("LineLabel");

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

/* ── The entities ──────────────────────────────────────────────────────── */

/**
 * `generated` names the fields the domain produces rather than the caller, so
 * they drop out of `createInput`. `immutable` names the ones `update` refuses.
 * `computed` is re-derived on every construction path, so it cannot drift from
 * its sources.
 */
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
      Entity.invariant((d) => d.name.length <= 80, "name must be at most 80 characters"),
    ],
  },
) {
  /** Behaviour goes in the class body — this is a real class. */
  get isSelfTitled(): boolean {
    return this.name.toLowerCase().startsWith(this.slug.toLowerCase());
  }
}

/**
 * `issuedTo` is another entity used directly as a field: the class is itself a
 * zod schema, so it parses back to a real `Organization`, behaviour and all.
 */
export class Invoice extends Entity("Invoice")(
  {
    id: InvoiceId,
    issuedTo: Organization,
    lines: z.array(LineItem),
    total: Money,
    status: InvoiceStatus,
    dunningReasons: z.array(DunningReason),
    level: Level,
    issuedAt: Instant,
  },
  {
    generated: ["id", "issuedAt"],
    immutable: ["id", "issuedAt", "issuedTo"],
    invariants: [
      Entity.invariant((d) => d.total.amount >= 0, "total must not be negative"),
      Entity.invariant(
        (d) => d.status !== "VOID" || d.dunningReasons.length === 0,
        "a void invoice cannot be in dunning",
      ),
    ],
  },
) {
  get isCollectable(): boolean {
    return this.status === "ISSUED" || this.status === "DRAFT";
  }
}

/** Dispatches on the declared discriminant, so a failing member reports its own issues. */
export const BillingRecord = Entity.union("_tag", [Organization, Invoice] as const);

/* ── Binding the effect sources ────────────────────────────────────────
   The package reads no clock and generates no id. A factory is where those
   come in, bound once at the composition root — which is what leaves the
   entities themselves trivially testable.                                 */

const now = () => new Date().toISOString() as z.infer<typeof Instant>;

export const createOrganization = Organization.factory({
  id: () => crypto.randomUUID() as z.infer<typeof OrganizationId>,
  createdAt: now,
});

export const createInvoice = Invoice.factory({
  id: () => crypto.randomUUID() as z.infer<typeof InvoiceId>,
  issuedAt: now,
});
