import { Money, Slug } from "@btravstack/entity-example-billing-domain";
import { P } from "unthrown";
import { expect, test } from "vitest";

import {
  InMemorySeriesCounter,
  Series,
  createDraftInvoice,
  issue,
  type DraftInvoice,
  type NumberAllocator,
} from "./numbering.js";

const AT = "2026-08-13T09:00:00Z" as never;
const FY = Series.parse("FY26");

const draft = (amount: number): DraftInvoice =>
  createDraftInvoice({
    series: FY,
    issuedTo: Slug.parse("acme"),
    total: Money.parse({ amount, currency: "EUR" }),
  }).getOrThrow();

test("issuing carries the draft's data over and adds the number", async () => {
  const numbers = new InMemorySeriesCounter();
  const issued = (await issue(numbers, AT)(draft(12_00))).getOrThrow();

  expect(issued.number).toBe(1);
  expect(issued.total.amount).toBe(12_00);
  // Behaviour declared on the root survives the transition, like the data does.
  expect(issued.reference).toBe("FY26/acme");
});

test("the draft's own state loses to the generated one", async () => {
  const numbers = new InMemorySeriesCounter();
  const before = draft(12_00);
  const issued = (await issue(numbers, AT)(before)).getOrThrow();

  expect(before.state).toBe("DRAFT");
  expect(issued.state).toBe("ISSUED");
  // A draft has no `number` at all — not a null one. That is the whole point of
  // two variants rather than one nullable field.
  expect("number" in before.toJSON()).toBe(false);
});

test("numbers within a series are consecutive", async () => {
  const numbers = new InMemorySeriesCounter();
  const issuing = issue(numbers, AT);

  const first = (await issuing(draft(1_00))).getOrThrow();
  const second = (await issuing(draft(2_00))).getOrThrow();
  const third = (await issuing(draft(3_00))).getOrThrow();

  expect([first.number, second.number, third.number]).toEqual([1, 2, 3]);
});

test("a rejected issue hands the number back, so the series keeps no gap", async () => {
  const numbers = new InMemorySeriesCounter();
  const issuing = issue(numbers, AT);

  const first = (await issuing(draft(1_00))).getOrThrow();
  // A draft may total zero; an issued invoice may not. The invariant fires
  // after the number was allocated, which is exactly the case gaplessness has
  // to survive.
  const rejected = await issuing(draft(0));
  const next = (await issuing(draft(2_00))).getOrThrow();

  expect(rejected.isErr()).toBe(true);
  expect([first.number, next.number]).toEqual([1, 2]);
});

test("an unreachable number source is a defect, not an InvalidEntity", async () => {
  const unreachable: NumberAllocator = {
    next: () => Promise.reject(new Error("counter unreachable")),
    release: () => undefined,
  };

  const outcome = await issue(
    unreachable,
    AT,
  )(draft(12_00)).then((result) =>
    result.match({
      ok: () => "issued",
      errCases: (m) => m.with(P.tag("InvalidEntity"), () => "invalid"),
      defect: () => "defect",
    }),
  );

  expect(outcome).toBe("defect");
});
