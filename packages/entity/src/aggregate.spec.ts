import { Err, P, TaggedError, type Result } from "unthrown";
import { expect, test } from "vitest";
import { z } from "zod";

import { Entity } from "./index.js";

const CartId = z.uuid().brand("CartId");
const ProductId = z.string().min(1).brand("ProductId");
const Quantity = z.number().int().positive().brand("Quantity");
const Item = z.object({ productId: ProductId, quantity: Quantity }).brand("Item");

const CartEvent = z.discriminatedUnion("type", [
  z.object({ type: z.literal("CartOpened"), cartId: z.uuid() }),
  z.object({ type: z.literal("ItemAdded"), productId: z.string(), quantity: z.number().int() }),
  z.object({ type: z.literal("CartCheckedOut") }),
]);
type CartEvent = z.output<typeof CartEvent>;

class CartClosed extends TaggedError("CartClosed") {}

class Cart extends Entity.aggregate("Cart")({
  id: Entity.field(CartId, { identity: true }),
  status: z.enum(["open", "checked_out"]),
  items: z.array(Item),
})({
  events: CartEvent,
  invariants: [
    Entity.invariant({
      code: "TOO_MANY_ITEMS",
      ensure: (d) => d.items.length <= 2,
      message: "a cart holds at most 2 items",
    }),
  ],
  opens: {
    CartOpened: (e) => ({ id: e.cartId, status: "open", items: [] }),
  },
  evolve: {
    ItemAdded: (r, e) => ({
      ...r,
      items: [...r.items, { productId: e.productId, quantity: e.quantity }],
    }),
    CartCheckedOut: (r) => ({ ...r, status: "checked_out" }),
  },
}) {
  addItem(
    productId: string,
    quantity: number,
  ): Result<Entity.Decision<Cart, CartEvent>, CartClosed> {
    if (this.status !== "open") return Err(new CartClosed());
    return this.emit({ type: "ItemAdded", productId, quantity });
  }

  checkOut(): Result<Entity.Decision<Cart, CartEvent>, never> {
    return this.emit({ type: "CartCheckedOut" });
  }
}

const id = "0199b1f4-1b1e-7000-8000-000000000000";
const opened = (): Cart => Cart.start({ type: "CartOpened", cartId: id }).get().state;

/** The outcome of a decision as one comparable value. */
const channel = <T, E>(r: Result<T, E>) =>
  r.match({
    ok: () => "ok",
    // generic in E, so there is nothing to enumerate
    // oxlint-disable-next-line unthrown/no-catch-all-pattern
    errCases: (m) => m.with(P._, () => "err"),
    defect: () => "defect",
  });

test("start opens an aggregate from a creation event and returns a sealed decision", () => {
  const decision = Cart.start({ type: "CartOpened", cartId: id }).get();
  expect(decision.state).toBeInstanceOf(Cart);
  expect(decision.state.toJSON()).toEqual({ id, status: "open", items: [] });
  expect(decision.events).toEqual([{ type: "CartOpened", cartId: id }]);
});

test("a method folds its events onto the current state and verifies the result once", () => {
  const cart = opened();
  const decision = cart.addItem("apple", 2).getOrThrow();
  expect(decision.events).toEqual([{ type: "ItemAdded", productId: "apple", quantity: 2 }]);
  expect(decision.state.items).toEqual([{ productId: "apple", quantity: 2 }]);
  // the source is untouched: a decision is a new state, never a mutation
  expect(cart.items).toEqual([]);
  // the state in the decision is the verified instance, frozen like any entity
  expect(decision.state).toBeInstanceOf(Cart);
  expect(Object.isFrozen(decision.state.items)).toBe(true);
  expect(decision.state.sameIdentityAs(cart)).toBe(true);
});

test("a business check is a typed error, and no events come out of it", () => {
  const closed = opened().checkOut().get().state;
  const result = closed.addItem("apple", 1);
  expect(
    result.match({
      ok: () => "ok",
      errCases: (m) => m.with(P.tag("CartClosed"), () => "closed"),
      defect: () => "defect",
    }),
  ).toBe("closed");
});

test("events that break an invariant are a defect, before anything can be persisted", () => {
  const two = opened().addItem("a", 1).getOrThrow().state.addItem("b", 1).getOrThrow().state;
  expect(channel(two.addItem("c", 1))).toBe("defect");
});

test("an emitted event that does not match the declared schema is a defect", () => {
  const cart = opened();
  expect(channel(cart.emit({ type: "ItemAdded", productId: "x", quantity: 1.5 } as never))).toBe(
    "defect",
  );
  expect(channel(cart.emit({ type: "Nope" } as never))).toBe("defect");
});

test("a throwing handler is a defect", () => {
  class Brittle extends Entity.aggregate("Brittle")({
    id: Entity.field(CartId, { identity: true }),
  })({
    events: z.discriminatedUnion("type", [
      z.object({ type: z.literal("Opened"), id: z.uuid() }),
      z.object({ type: z.literal("Broke") }),
    ]),
    opens: { Opened: (e) => ({ id: e.id }) },
    evolve: {
      Broke: () => {
        // oxlint-disable-next-line unthrown/no-throw -- the handler bug under test
        throw new Error("boom");
      },
    },
  }) {}
  const brittle = Brittle.start({ type: "Opened", id }).get().state;
  expect(channel(brittle.emit({ type: "Broke" }))).toBe("defect");
});

test("start refuses a non-opening event as a defect", () => {
  expect(channel(Cart.start({ type: "CartCheckedOut" } as never))).toBe("defect");
});

/* ── Rehydration ────────────────────────────────────────────────────── */

test("replay folds a stored stream into the same state, and emits nothing", () => {
  const first = Cart.start({ type: "CartOpened", cartId: id }).get();
  const second = first.state.addItem("apple", 2).getOrThrow();
  const stream = [...first.events, ...second.events];

  const replayed = Cart.replay(stream).getOrThrow();
  expect(replayed).toBeInstanceOf(Cart);
  expect(replayed.toJSON()).toEqual(second.state.toJSON());
  expect(Object.keys(replayed)).not.toContain("events");
});

test("make rehydrates a snapshot, and an aggregate has no update and no factory", () => {
  const snapshot = opened().addItem("apple", 1).getOrThrow().state.toJSON();
  const cart = Cart.make(snapshot).getOrThrow();
  expect(cart.items).toHaveLength(1);
  expect("update" in cart).toBe(false);
  expect("factory" in Cart).toBe(false);
  expect("factoryAsync" in Cart).toBe(false);
});

/** Every issue of a failed replay as `[path, message]`. */
const replayIssues = (events: unknown) =>
  Cart.replay(events).match({
    ok: () => [],
    errCases: (m) =>
      m.with(P.tag("InvalidEntity"), (e) =>
        e.issues.map((i) => [Entity.keysOf(i), Entity.codeOf(i) ?? i.message] as const),
      ),
    defect: () => [["defect"]],
  });

test("replay validates every stored event, reporting it at its index", () => {
  const issues = replayIssues([
    { type: "CartOpened", cartId: id },
    { type: "ItemAdded", productId: "apple", quantity: "two" },
  ]);
  expect(issues).toHaveLength(1);
  expect(issues[0]?.[0]).toEqual([1, "quantity"]);
});

test("a stream must start with an opening event", () => {
  expect(replayIssues([])[0]?.[0]).toEqual([]);
  expect(replayIssues([{ type: "CartCheckedOut" }])[0]?.[0]).toEqual([0, "type"]);
  expect(replayIssues({ not: "a stream" })[0]?.[0]).toEqual([]);
});

test("a later opening event mid-stream is refused at its index", () => {
  const issues = replayIssues([
    { type: "CartOpened", cartId: id },
    { type: "CartOpened", cartId: id },
  ]);
  expect(issues[0]?.[0]).toEqual([1, "type"]);
});

test("a stream that breaks today's invariant is an InvalidEntity, like make", () => {
  const issues = replayIssues([
    { type: "CartOpened", cartId: id },
    { type: "ItemAdded", productId: "a", quantity: 1 },
    { type: "ItemAdded", productId: "b", quantity: 1 },
    { type: "ItemAdded", productId: "c", quantity: 1 },
  ]);
  expect(issues).toEqual([[[], "TOO_MANY_ITEMS"]]);
});
