import { P } from "unthrown";
import { expect, test } from "vitest";

import {
  AccountingPeriod,
  BillingDocument,
  CreditNote,
  DisplayName,
  DraftInvoice,
  Instant,
  Invoice,
  InvoiceId,
  InvoiceIssuedV1,
  InvoiceNumber,
  LineItem,
  Money,
  Organization,
  Slug,
  createCreditNote,
  createDraftInvoice,
  createOrganization,
  toInvoiceIssuedV1,
} from "./index.js";

/**
 * Every field here is branded, so a plain string or object literal does not
 * satisfy its type — that is the whole point of branding. `parse` is how you
 * mint one, and it is why these helpers exist rather than inline literals.
 *
 * Worth knowing while reading: this file passed `vitest` before it typechecked.
 * vitest transpiles without checking types, so branding violations are invisible
 * to it — which is exactly why this package also compiles its own declarations.
 */
const slug = (value: string) => Slug.parse(value);
const name = (value: string) => DisplayName.parse(value);
const money = (amount: number, currency: "EUR" | "USD" | "GBP") =>
  Money.parse({ amount, currency });

const org = () => createOrganization({ slug: slug("acme"), name: name("Acme SA") }).getOrThrow();

const line = (amount: number, currency: "EUR" | "USD" | "GBP" = "EUR") =>
  LineItem.parse({ label: "Consulting", unit: { amount, currency }, quantity: 1 });

const draft = (total = money(0, "EUR")) =>
  createDraftInvoice({ issuedTo: org(), lines: [], total }).getOrThrow();

// The external facts `issue` needs. A real caller gets the number from a
// transaction and the instant from its clock; neither is the entity's business.
const facts = {
  number: InvoiceNumber.parse(1),
  at: Instant.parse("2026-03-14T10:00:00.000Z"),
};

/** An issued €12.00 invoice, reached the only way there is: through `issue`. */
const issued = () =>
  draft()
    .addLine(line(12_00))
    .flatMap((d) => d.issue(facts))
    .getOrThrow().entity;

/** A stored invoice someone already paid, read back the way a repository would. */
const paid = () => Invoice.make({ ...issued().toJSON(), status: "PAID" }).getOrThrow();

test("a factory supplies the generated fields", () => {
  const acme = org();
  expect(acme.slug).toBe("acme");
  expect(acme.id).toMatch(/^[0-9a-f-]{36}$/);
});

test("a computed field is derived, and re-derived on update", () => {
  const acme = org();
  expect(acme.displayLabel).toBe("Acme SA (acme)");

  const renamed = acme.update({ name: name("Acme SAS") }).getOrThrow();
  expect(renamed.displayLabel).toBe("Acme SAS (acme)");
});

test("an invariant returns an error rather than throwing", () => {
  expect(createOrganization({ slug: slug("acme"), name: name("x".repeat(81)) }).isErr()).toBe(true);
});

test("toJSON is the stored shape, and never carries _tag", () => {
  const stored = org().toJSON();

  expect(Object.keys(stored).sort()).toEqual([
    "createdAt",
    "displayLabel",
    "id",
    "name",
    "riskTier",
    "slug",
  ]);
  expect("_tag" in stored).toBe(false);
});

test("update returns a new entity and leaves the original alone", () => {
  const acme = org();
  const renamed = acme.update({ name: name("Acme SAS") }).getOrThrow();

  expect(acme.name).toBe("Acme SA");
  expect(renamed.name).toBe("Acme SAS");
  // the same organization, in a different state
  expect(renamed.sameIdentityAs(acme)).toBe(true);
  expect(renamed.toJSON()).not.toEqual(acme.toJSON());
});

test("an entity nests inside another and survives the round trip", () => {
  const invoice = issued();
  expect(invoice.issuedTo).toBeInstanceOf(Organization);

  const rehydrated = Invoice.make(invoice.toJSON()).getOrThrow();
  expect(rehydrated.toJSON()).toEqual(invoice.toJSON());
  expect(rehydrated.issuedTo).toBeInstanceOf(Organization);
});

test("a branded object field keeps its members", () => {
  const drafted = draft(money(999, "USD"));

  expect(drafted.total.amount).toBe(999);
  expect(drafted.total.currency).toBe("USD");
});

test("a malformed row comes back as an error, not an exception", () => {
  expect(Organization.make({ slug: "", name: "" }).isErr()).toBe(true);
});

/* ── The root carries the fields and the behaviour both variants share ── */

test("an invoice carries the root's behaviour", () => {
  const invoice = issued();
  expect(invoice.counterpartySlug).toBe("acme");
  expect(invoice.signedAmount()).toBe(12_00);
  // A draft is a variant too, and signs its amount its own way: not at all.
  expect(draft(money(12_00, "EUR")).signedAmount()).toBe(0);
});

test("each variant signs the shared amount its own way", () => {
  const note = createCreditNote({
    issuedTo: org(),
    against: InvoiceId.parse("33333333-3333-4333-8333-333333333333"),
    total: money(500, "EUR"),
  }).getOrThrow();

  expect(note.signedAmount()).toBe(-500);
  expect(note.counterpartySlug).toBe("acme");
});

test("a variant inherits the root's computed field without re-stating it", () => {
  const drafted = draft();
  expect(drafted.period).toBe(drafted.issuedAt.slice(0, 7));

  // Both variants, since neither names `period` and the claim is that every one
  // of them gets it — an assertion on `Invoice` alone would not say that.
  const note = createCreditNote({
    issuedTo: org(),
    against: InvoiceId.parse("33333333-3333-4333-8333-333333333333"),
    total: money(500, "EUR"),
  }).getOrThrow();
  expect(note.period).toBe(note.issuedAt.slice(0, 7));

  // Derived, so it is not patchable on either.
  expect(Object.keys(Invoice.updateInput.shape)).not.toContain("period");
  expect(Object.keys(CreditNote.updateInput.shape)).not.toContain("period");
});

test("the period's own schema rejects a month that cannot exist", () => {
  // A computed field's schema is what makes `from`'s unchecked cast honest, so
  // it has to be able to fail. `\d{2}` would pass all three of these.
  expect(AccountingPeriod.safeParse("2026-03").success).toBe(true);
  expect(AccountingPeriod.safeParse("2026-12").success).toBe(true);
  for (const impossible of ["2026-00", "2026-13", "2026-99"]) {
    expect(AccountingPeriod.safeParse(impossible).success).toBe(false);
  }
});

test("the root's invariant guards a variant that declares none of its own", async () => {
  // `CreditNote` no longer spells out "total must not be negative" — the root
  // does. An extension can add rules; it cannot shed them.
  const message = await createCreditNote({
    issuedTo: org(),
    against: InvoiceId.parse("33333333-3333-4333-8333-333333333333"),
    total: money(-1, "EUR"),
  }).match({
    ok: () => "ok",
    errCases: (m) => m.with(P.tag("InvalidEntity"), (e) => e.issues[0]?.message ?? ""),
    defect: () => "defect",
  });

  expect(message).toBe("total must not be negative");
});

/* ── The union dispatches on a DECLARED field, never on `_tag` ──────────
   These four are the tests whose absence let a broken union ship: the first
   version of this file discriminated on "_tag", which is non-enumerable and
   therefore missing from every row, so `make` rejected everything with an
   empty "expected one of " set. Nothing noticed, because nothing called it. */

test("the union makes the right class from a row", async () => {
  const invoiceRow = issued().toJSON();
  const made = BillingDocument.make(invoiceRow).getOrThrow();

  expect(made).toBeInstanceOf(Invoice);
  expect(made).not.toBeInstanceOf(CreditNote);

  // Both lifecycle variants travel down the same channel.
  expect(BillingDocument.make(draft().toJSON()).getOrThrow()).toBeInstanceOf(DraftInvoice);
});

test("the union dispatches to the other member on the other value", () => {
  const note = createCreditNote({
    issuedTo: org(),
    against: InvoiceId.parse("33333333-3333-4333-8333-333333333333"),
    total: money(500, "EUR"),
  }).getOrThrow();

  const made = BillingDocument.make(note.toJSON()).getOrThrow();
  expect(made).toBeInstanceOf(CreditNote);
});

test("the discriminant survives toJSON, which is why it is a declared field", () => {
  const row = issued().toJSON();

  expect(row.kind).toBe("INVOICE");
  // `_tag` does NOT survive — a union built on it could never match a row.
  expect("_tag" in row).toBe(false);
});

test("an unknown discriminant is a reported error, not a silent miss", async () => {
  const message = await BillingDocument.make({ kind: "PROFORMA" }).match({
    ok: () => "ok",
    errCases: (m) => m.with(P.tag("InvalidEntity"), (e) => e.issues[0]?.message ?? ""),
    defect: () => "defect",
  });

  expect(message).toContain("Invalid discriminant");
  expect(message).toContain('"INVOICE"');
  expect(message).toContain('"CREDIT_NOTE"');
});

test("a variant inherits the root's immutable keys without re-stating them", () => {
  const drafted = draft();
  // `issuedAt` is immutable, so `PatchOf` omits it — smuggle it in like crud.spec.ts does.
  const rejected = drafted.update({ issuedAt: drafted.issuedAt } as never);

  const message = rejected.match({
    ok: () => "WRONGLY ACCEPTED",
    errCases: (m) => m.with(P.tag("InvalidEntity"), (e) => e.issues[0]?.message ?? ""),
    defect: () => "defect",
  });
  expect(message).toBe("Immutable field — cannot be patched");
});

/* ── Commands: named transitions, typed refusals, explicit events ────────
   `update` checks the state it produces. A command also checks the change.
   These tests pin the difference, and the bypass `update` leaves open.     */

test("a command returns a new entity and leaves the source alone", () => {
  const before = draft();
  const after = before.addLine(line(12_00)).getOrThrow();

  expect(after.lines).toHaveLength(1);
  expect(after.total.amount).toBe(12_00);
  expect(before.lines).toHaveLength(0);
  expect(before.total.amount).toBe(0);
});

test("a refused command is a typed business error, and the source is unchanged", () => {
  const before = draft();
  const refused = before.addLine(line(5_00, "USD"));

  expect(refused.isErr() && refused.error).toMatchObject({
    _tag: "CurrencyMismatch",
    expected: "EUR",
    received: "USD",
  });
  expect(before.lines).toHaveLength(0);
});

test("issuing moves the invoice to the variant that carries a number", () => {
  const ready = draft().addLine(line(12_00)).getOrThrow();
  const { entity, events } = ready.issue(facts).getOrThrow();

  expect(entity).toBeInstanceOf(Invoice);
  expect(entity.id).toBe(ready.id);
  expect(entity.number).toBe(1);
  expect(entity.status).toBe("ISSUED");
  expect(entity.issuedAt).toBe(facts.at);
  // The source is still a draft: no number field, not even an undefined one.
  expect(ready).toBeInstanceOf(DraftInvoice);
  expect("number" in ready).toBe(false);

  // One deliberately named event, its payload built from the new state.
  expect(events).toEqual([
    {
      type: "InvoiceIssued",
      invoiceId: ready.id,
      number: 1,
      issuedTo: ready.issuedTo.id,
      issuedAt: facts.at,
      total: entity.total,
      lines: entity.lines,
    },
  ]);
});

test("a state invariant on the target variant still applies to the command", () => {
  // "An issued invoice bills at least one line" is true of every issued
  // invoice, so it is an invariant, not a check inside `issue`.
  const outcome = draft().issue(facts);

  const message = outcome.match({
    ok: () => "WRONGLY ISSUED",
    errCases: (m) => m.with(P.tag("InvalidEntity"), (e) => e.issues[0]?.message ?? ""),
    defect: () => "defect",
  });
  expect(message).toBe("an issued invoice bills at least one line");
});

test("voiding announces it, and establishes the void state's own invariant", () => {
  const inDunning = issued()
    .update({ dunningReasons: ["DISPUTE_CHARGES"], level: 2 })
    .getOrThrow();
  const { entity, events } = inDunning.void().getOrThrow();

  expect(entity.status).toBe("VOID");
  expect(entity.dunningReasons).toEqual([]);
  expect(events).toEqual([{ type: "InvoiceVoided", invoiceId: entity.id, number: 1 }]);
});

test("a forbidden transition between two valid states is refused", () => {
  const settled = paid();
  // The target is a valid state on its own: an ISSUED invoice voids to it.
  expect(issued().void().isOk()).toBe(true);

  const refused = settled.void();

  expect(refused.isErr() && refused.error).toMatchObject({
    _tag: "InvoiceNotVoidable",
    invoiceId: settled.id,
    status: "PAID",
  });
  // No successful outcome, so no event to dispatch.
  expect(refused.isOk()).toBe(false);
  expect(settled.status).toBe("PAID");
});

test("update checks the state, not the transition: the bypass a command closes", () => {
  // The exact transition `void` refuses, spelled as a patch. Both states are
  // valid, so `update` has nothing to object to. This is why the module
  // boundary exposes commands rather than the entity's `update`.
  const bypassed = paid().update({ status: "VOID" });

  expect(bypassed.isOk()).toBe(true);
});

test("an immutable field is the one transition rule a declaration can carry", () => {
  // `lines` is immutable on the issued variant, so `PatchOf` omits it.
  const rejected = issued().update({ lines: [] } as never);

  const message = rejected.match({
    ok: () => "WRONGLY ACCEPTED",
    errCases: (m) => m.with(P.tag("InvalidEntity"), (e) => e.issues[0]?.message ?? ""),
    defect: () => "defect",
  });
  expect(message).toBe("Immutable field — cannot be patched");
});

test("a command exists only on the variant it applies to", () => {
  // Compile-time: an issued invoice cannot be issued again and a draft cannot
  // be voided. The variants make those transitions unwritable, not just refused.
  const unwritable = (d: DraftInvoice, i: Invoice) => {
    // @ts-expect-error an issued invoice has no `issue`
    void i.issue(facts);
    // @ts-expect-error a draft has no `void`
    void d.void();
  };
  expect(typeof unwritable).toBe("function");
});

test("rehydration and recalculation announce nothing", () => {
  // Reading a stored invoice back, or re-deriving its computed fields on a
  // patch, is not a business fact. Both hand back the entity alone.
  const rehydrated = Invoice.make(issued().toJSON()).getOrThrow();
  const patched = rehydrated.update({ level: 1 }).getOrThrow();

  expect(rehydrated).toBeInstanceOf(Invoice);
  expect("events" in rehydrated).toBe(false);
  expect(patched.period).toBe(rehydrated.period);
  expect("events" in patched).toBe(false);
});

test("a domain event maps to a narrower, versioned integration contract", () => {
  const ready = draft().addLine(line(12_00)).getOrThrow();
  const [event] = ready.issue(facts).getOrThrow().events;
  const published = toInvoiceIssuedV1(event);

  // Private detail stays private: the lines are on the domain event only.
  expect("lines" in event).toBe(true);
  expect("lines" in published).toBe(false);
  // The contract is strict, so it cannot quietly accept a leaked field.
  expect(InvoiceIssuedV1.safeParse(published).success).toBe(true);
  expect(InvoiceIssuedV1.safeParse({ ...published, lines: event.lines }).success).toBe(false);
});
