import { expect, test } from "vitest";

import {
  DisplayName,
  Invoice,
  Money,
  Organization,
  Slug,
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
