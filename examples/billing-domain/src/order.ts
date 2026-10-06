/**
 * An order aggregate: the code behind the "Model an aggregate" guide.
 *
 * Four kinds of thing sit inside `Order`, and they are deliberately not the
 * same kind:
 *
 *  - `lines` are **owned child entities**. Each `OrderLine` has an identity of
 *    its own, but no life outside its order: it is created for the order,
 *    changed only through the order's methods, and stored with the order.
 *  - `Money` and `BillingParty` are **value objects**: no identity, compared
 *    by value, replaced rather than changed.
 *  - `customerId` is a **reference to another aggregate**. A `Customer` has its
 *    own lifecycle and its own writes, so the order holds its ID, never the
 *    entity.
 *  - `billTo` is a **historical snapshot**: a copy of the customer's billing
 *    details, taken when the order is placed and never refreshed, because a
 *    placed order has to keep saying who it was billed to.
 *
 * `Order` is the aggregate root in the DDD sense: the only object outside code
 * holds, and the only one whose methods change what is inside. That is a
 * modelling role, not a declaration — nothing here uses `Entity.abstract`,
 * which is an inheritance mechanism and says nothing about consistency.
 */
import { Entity } from "@btravstack/entity";
import { Err, TaggedError, type Result } from "unthrown";
import { z } from "zod";

import { Currency, DisplayName, LineLabel, Money } from "./vocabulary.js";

export const CustomerId = z.uuid().brand("CustomerId");
export const OrderId = z.uuid().brand("OrderId");
export const OrderLineId = z.uuid().brand("OrderLineId");
export const Quantity = z.number().int().positive().brand("Quantity");
export const OrderStatus = z.enum(["DRAFT", "PLACED"]);

/** Who a document is addressed to. A value object, and the shape of the snapshot. */
export const BillingParty = z
  .object({ name: DisplayName, address: z.string().min(1) })
  .brand("BillingParty");

/** An order may not exceed €10,000.00 — a rule over every line at once. */
export const ORDER_CEILING = 10_000_00;

/* ── Another aggregate ─────────────────────────────────────────────────── */

/** Its own aggregate: renamed and re-addressed on its own schedule, saved on its own. */
export class Customer extends Entity("Customer")({
  id: Entity.field(CustomerId, { generated: true, immutable: true }),
  billing: BillingParty,
}) {}

/* ── The aggregate and what it owns ────────────────────────────────────── */

/** An owned child entity: identity within its order, no life outside it. */
export class OrderLine extends Entity("OrderLine")(
  {
    id: Entity.field(OrderLineId, { generated: true, immutable: true }),
    label: LineLabel,
    unitPrice: Entity.field(Money, { immutable: true }),
    quantity: Quantity,
  },
  {
    computed: {
      subtotal: Entity.computed(Money, (d) => ({
        amount: d.unitPrice.amount * d.quantity,
        currency: d.unitPrice.currency,
      })),
    },
  },
) {}

export class OrderNotEditable extends TaggedError("OrderNotEditable")<{ orderId: string }> {
  override message = `order ${this.orderId} is placed; its lines can no longer change`;
}

export class LineNotFound extends TaggedError("LineNotFound")<{ lineId: string }> {
  override message = `no line ${this.lineId} on this order`;
}

export class NotTheOrdersCustomer extends TaggedError("NotTheOrdersCustomer")<{
  customerId: string;
}> {
  override message = `customer ${this.customerId} is not the one this order references`;
}

const sum = (lines: readonly { readonly subtotal: { readonly amount: number } }[]) =>
  lines.reduce((total, line) => total + line.subtotal.amount, 0);

export class Order extends Entity("Order")(
  {
    id: Entity.field(OrderId, { generated: true, immutable: true }),
    customerId: Entity.field(CustomerId, { immutable: true }),
    currency: Entity.field(Currency, { immutable: true }),
    status: Entity.field(OrderStatus, { generated: true }),
    lines: z.array(OrderLine),
    billTo: BillingParty.optional(),
  },
  {
    computed: {
      total: Entity.computed(Money, (d) => ({ amount: sum(d.lines), currency: d.currency })),
    },
    // Aggregate-wide rules: none of them can be checked by one line alone, and
    // every construction path — `make`, `update`, a factory — re-runs them all.
    invariants: [
      Entity.invariant(
        (d) => new Set(d.lines.map((line) => line.id)).size === d.lines.length,
        "line ids must be unique within an order",
      ),
      Entity.invariant(
        (d) => d.lines.every((line) => line.unitPrice.currency === d.currency),
        "every line must be priced in the order's currency",
      ),
      Entity.invariant((d) => sum(d.lines) <= ORDER_CEILING, "order total exceeds the ceiling"),
      Entity.invariant(
        (d) => (d.status === "PLACED") === (d.billTo !== undefined),
        "a placed order, and only a placed order, carries a billing snapshot",
      ),
      Entity.invariant(
        (d) => d.status === "DRAFT" || d.lines.length > 0,
        "a placed order has at least one line",
      ),
    ],
  },
) {
  addLine(line: OrderLine): Result<Order, Entity.InvalidEntity | OrderNotEditable> {
    if (this.status !== "DRAFT") return Err(new OrderNotEditable({ orderId: this.id }));
    return this.update({ lines: [...this.lines, line] });
  }

  /**
   * The child is changed through the root, never on its own: the new line is
   * valid by itself, and only the order can tell whether the order still is.
   */
  changeQuantity(
    lineId: z.output<typeof OrderLineId>,
    quantity: z.output<typeof Quantity>,
  ): Result<Order, Entity.InvalidEntity | OrderNotEditable | LineNotFound> {
    if (this.status !== "DRAFT") return Err(new OrderNotEditable({ orderId: this.id }));
    const line = this.lines.find((candidate) => candidate.id === lineId);
    if (line === undefined) return Err(new LineNotFound({ lineId }));
    return line
      .update({ quantity })
      .flatMap((changed) =>
        this.update({ lines: this.lines.map((each) => (each.id === lineId ? changed : each)) }),
      );
  }

  /** Copies the customer's billing details as they are now. Later changes to the customer do not reach it. */
  place(
    customer: Customer,
  ): Result<Order, Entity.InvalidEntity | OrderNotEditable | NotTheOrdersCustomer> {
    if (this.status !== "DRAFT") return Err(new OrderNotEditable({ orderId: this.id }));
    if (customer.id !== this.customerId) {
      return Err(new NotTheOrdersCustomer({ customerId: customer.id }));
    }
    return this.update({ status: "PLACED", billTo: customer.billing });
  }
}

/* ── Binding the effect sources ────────────────────────────────────────── */

export const createCustomer = Customer.factory({ id: () => crypto.randomUUID() });
export const createOrderLine = OrderLine.factory({ id: () => crypto.randomUUID() });

/**
 * Exported on purpose: the regression guard for #152. Its inferred type spells
 * out the nested `OrderLine` instance, branded `Money` included, and that once
 * failed declaration emit with `TS4023` on both compilers.
 */
export const createOrder = Order.factory({
  id: () => crypto.randomUUID(),
  status: () => "DRAFT" as const,
});

/** Every order opens as an empty draft for one customer, so the caller supplies only what varies. */
export const openOrder = (
  customerId: z.output<typeof CustomerId>,
  currency: z.output<typeof Currency>,
): Result<Order, Entity.InvalidEntity> => createOrder({ customerId, currency, lines: [] });
