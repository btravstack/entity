import type { Result } from "unthrown";
import { expect, test } from "vitest";

import {
  BillingParty,
  Order,
  OrderLineId,
  Quantity,
  createCustomer,
  createOrderLine,
  openOrder,
} from "./order.js";
import { LineLabel, Money } from "./vocabulary.js";

const party = (name: string, address: string) => BillingParty.parse({ name, address });
const quantity = (n: number) => Quantity.parse(n);
const eur = (amount: number) => Money.parse({ amount, currency: "EUR" });

/** The modelled error a result carries, or `undefined` when it succeeded. */
const errorOf = <E>(result: Result<unknown, E>) => (result.isErr() ? result.error : undefined);

const customer = () =>
  createCustomer({ billing: party("Acme SA", "1 rue de la Paix, Paris") }).getOrThrow();

const line = (unit = eur(10_00)) =>
  createOrderLine({
    label: LineLabel.parse("Widget"),
    unitPrice: unit,
    quantity: quantity(1),
  }).getOrThrow();

const draftWithOneLine = () => {
  const buyer = customer();
  const order = openOrder(buyer.id, "EUR")
    .flatMap((draft) => draft.addLine(line()))
    .getOrThrow();
  return { buyer, order };
};

test("the order references its customer by id, and owns its lines", () => {
  const { buyer, order } = draftWithOneLine();
  expect(order.customerId).toBe(buyer.id);
  expect(order.lines).toHaveLength(1);
  expect(order.total).toEqual({ amount: 10_00, currency: "EUR" });
});

test("a root operation changes an owned line and re-derives the total", () => {
  const { order } = draftWithOneLine();

  const changed = order.changeQuantity(order.lines[0]!.id, quantity(3)).getOrThrow();

  expect(changed.lines[0]!.quantity).toBe(3);
  expect(changed.total.amount).toBe(30_00);
  expect(order.lines[0]!.quantity).toBe(1);
  // a new version of the same order: identity holds while the lines changed
  expect(changed.sameIdentityAs(order)).toBe(true);
});

test("a change valid for the line alone is refused when the order breaks a rule", () => {
  const { order } = draftWithOneLine();

  // 1,001 × €10.00 is a perfectly good line. It is the order that cannot hold it.
  expect(errorOf(order.changeQuantity(order.lines[0]!.id, quantity(1_001)))?._tag).toBe(
    "InvalidEntity",
  );
  const dollars = line(Money.parse({ amount: 1_00, currency: "USD" }));
  expect(errorOf(order.addLine(dollars))?._tag).toBe("InvalidEntity");
});

test("a missing line is a modelled error, not an exception", () => {
  const { order } = draftWithOneLine();
  const stranger = OrderLineId.parse(crypto.randomUUID());
  expect(errorOf(order.changeQuantity(stranger, quantity(2)))?._tag).toBe("LineNotFound");
});

test("placing snapshots the billing party, and the snapshot does not follow the customer", () => {
  const { buyer, order } = draftWithOneLine();
  const placed = order.place(buyer).getOrThrow();

  const moved = buyer.update({ billing: party("Acme SAS", "2 avenue Foch, Lyon") }).getOrThrow();

  expect(moved.billing.address).toBe("2 avenue Foch, Lyon");
  expect(placed.billTo).toEqual({ name: "Acme SA", address: "1 rue de la Paix, Paris" });
  // Stored with the order, so a round trip through storage brings the same values back.
  const reloaded = Order.make(JSON.parse(JSON.stringify(placed))).getOrThrow();
  expect(reloaded.billTo).toEqual(placed.billTo);
});

test("a placed order refuses further line changes", () => {
  const { buyer, order } = draftWithOneLine();
  const placed = order.place(buyer).getOrThrow();
  expect(errorOf(placed.addLine(line()))?._tag).toBe("OrderNotEditable");
  expect(errorOf(placed.changeQuantity(placed.lines[0]!.id, quantity(2)))?._tag).toBe(
    "OrderNotEditable",
  );
});

test("an order is placed only with the customer it references", () => {
  const { order } = draftWithOneLine();
  expect(errorOf(order.place(customer()))?._tag).toBe("NotTheOrdersCustomer");
});

test("the aggregate-wide invariants hold on rehydration too", () => {
  const { order } = draftWithOneLine();
  // Placed but without its snapshot: not a state an Order can be in.
  const row = { ...order.toJSON(), status: "PLACED" };
  expect(errorOf(Order.make(row))?._tag).toBe("InvalidEntity");
});
