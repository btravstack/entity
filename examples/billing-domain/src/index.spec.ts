import { P } from "unthrown";
import { expect, test } from "vitest";

import {
  AccountingPeriod,
  BillingDocument,
  CreditNote,
  DisplayName,
  Invoice,
  InvoiceId,
  Money,
  Organization,
  Slug,
  createCreditNote,
  createInvoice,
  createOrganization,
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

const invoice = (total = money(12_00, "EUR")) =>
  createInvoice({
    issuedTo: org(),
    lines: [],
    total,
    status: "DRAFT",
    dunningReasons: [],
    level: 0,
  }).getOrThrow();

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

  expect(Object.keys(stored).sort()).toEqual(["createdAt", "displayLabel", "id", "name", "slug"]);
  expect("_tag" in stored).toBe(false);
});

test("update returns a new entity and leaves the original alone", () => {
  const acme = org();
  const renamed = acme.update({ name: name("Acme SAS") }).getOrThrow();

  expect(acme.name).toBe("Acme SA");
  expect(renamed.name).toBe("Acme SAS");
  expect(acme.equals(renamed)).toBe(false);
});

test("an entity nests inside another and survives the round trip", () => {
  const drafted = invoice();
  expect(drafted.issuedTo).toBeInstanceOf(Organization);

  const rehydrated = Invoice.make(drafted.toJSON()).getOrThrow();
  expect(rehydrated.equals(drafted)).toBe(true);
  expect(rehydrated.issuedTo).toBeInstanceOf(Organization);
});

test("a branded object field keeps its members", () => {
  const drafted = invoice(money(999, "USD"));

  expect(drafted.total.amount).toBe(999);
  expect(drafted.total.currency).toBe("USD");
});

test("a malformed row comes back as an error, not an exception", () => {
  expect(Organization.make({ slug: "", name: "" }).isErr()).toBe(true);
});

/* ── The root carries the fields and the behaviour both variants share ── */

test("an invoice carries the root's behaviour", () => {
  const drafted = invoice();
  expect(drafted.counterpartySlug).toBe("acme");
  expect(drafted.signedAmount()).toBe(12_00);
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
  const drafted = invoice();
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
  const invoiceRow = invoice().toJSON();
  const made = BillingDocument.make(invoiceRow).getOrThrow();

  expect(made).toBeInstanceOf(Invoice);
  expect(made).not.toBeInstanceOf(CreditNote);
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
  const row = invoice().toJSON();

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
  const drafted = invoice();
  // `issuedAt` is immutable, so `PatchOf` omits it — smuggle it in like crud.spec.ts does.
  const rejected = drafted.update({ issuedAt: drafted.issuedAt } as never);

  const message = rejected.match({
    ok: () => "WRONGLY ACCEPTED",
    errCases: (m) => m.with(P.tag("InvalidEntity"), (e) => e.issues[0]?.message ?? ""),
    defect: () => "defect",
  });
  expect(message).toBe("Immutable field — cannot be patched");
});
