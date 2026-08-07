import { P } from "unthrown";
import { expect, test } from "vitest";
import { z } from "zod";

import { Entity, computed } from "./index.js";

const CustomerId = z.uuid().brand("CustomerId");
const OrderId = z.uuid().brand("OrderId");
const Name = z.string().min(1).brand("Name");
const Upper = z.string().min(1).brand("Upper");
const Line = z.string().min(1).brand("Line");

class Customer extends Entity("Customer")(
  { id: CustomerId, name: Name },
  { computed: { shout: computed(Upper, (d) => d.name.toUpperCase() as z.infer<typeof Upper>) } },
) {}

/** An aggregate: an entity whose fields are other entities. */
class Order extends Entity("Order")({
  id: OrderId,
  customer: Customer.instance,
  watchers: z.array(Customer.instance),
  note: Line,
}) {}

const cid = "0199b1f4-1b1e-7000-8000-000000000001";
const cid2 = "0199b1f4-1b1e-7000-8000-000000000002";
const oid = "0199b1f4-1b1e-7000-8000-000000000003";

const raw = {
  id: oid,
  customer: { id: cid, name: "ada" },
  watchers: [{ id: cid2, name: "grace" }],
  note: "rush",
};

test("an entity can declare another entity as a field", () => {
  const order = Order.make(raw).getOrThrow();
  expect(order.customer).toBeInstanceOf(Customer);
  expect(order.customer.name).toBe("ada");
});

test("a nested entity keeps its behaviour and its computed fields", () => {
  const order = Order.make(raw).getOrThrow();
  expect(order.customer.shout).toBe("ADA");
  expect(order.customer._tag).toBe("Customer");
  expect(order.customer.equals(Customer.make({ id: cid, name: "ada" }).getOrThrow())).toBe(true);
});

test("entities nest inside an array field too", () => {
  const order = Order.make(raw).getOrThrow();
  expect(order.watchers[0]).toBeInstanceOf(Customer);
  expect(order.watchers[0]?.shout).toBe("GRACE");
});

test("a nested entity's own validation failure surfaces with its path", () => {
  const issues = Order.make({ ...raw, customer: { id: cid, name: "" } }).match({
    ok: () => [] as readonly (readonly PropertyKey[])[],
    errCases: (m) =>
      m.with(P.tag("InvalidEntity"), (e) => e.issues.map((i) => [...(i.path ?? [])])),
    defect: () => [["DEFECT"]],
  });
  expect(issues).toEqual([["customer", "name"]]);
});

test("JSON.stringify walks nested entities down to plain data", () => {
  const order = Order.make(raw).getOrThrow();
  expect(JSON.parse(JSON.stringify(order))).toEqual({
    id: oid,
    customer: { id: cid, name: "ada", shout: "ADA" },
    watchers: [{ id: cid2, name: "grace", shout: "GRACE" }],
    note: "rush",
  });
});

test("a nested entity survives a round trip through make", () => {
  const order = Order.make(raw).getOrThrow();
  const again = Order.make(JSON.parse(JSON.stringify(order))).getOrThrow();
  expect(again.customer).toBeInstanceOf(Customer);
  expect(again.customer.shout).toBe("ADA");
});

test("updating a sibling field leaves the nested entity intact", () => {
  const order = Order.make(raw).getOrThrow();
  const updated = order.update({ note: "later" as z.infer<typeof Line> }).getOrThrow();
  expect(updated.note).toBe("later");
  expect(updated.customer).toBeInstanceOf(Customer);
  expect(updated.customer.shout).toBe("ADA");
});

test("an invariant can span the outer entity and a nested one", () => {
  class Checked extends Entity("Checked")(
    { id: OrderId, customer: Customer.instance, note: Line },
    {
      invariants: (d) =>
        d.note.length >= d.customer.name.length
          ? []
          : ["note must be at least as long as the name"],
    },
  ) {}
  const ok = Checked.make({ id: oid, customer: { id: cid, name: "ada" }, note: "rush" });
  const bad = Checked.make({ id: oid, customer: { id: cid, name: "grace" }, note: "x" });
  expect(ok.isOk()).toBe(true);
  expect(bad.isErr()).toBe(true);
});

test("a nested entity is not re-frozen into uselessness", () => {
  const order = Order.make(raw).getOrThrow();
  // the nested entity locked its own fields; the outer freeze must not have
  // stripped its prototype methods
  expect(typeof order.customer.toJSON).toBe("function");
  expect(order.customer.toJSON()).toEqual({ id: cid, name: "ada", shout: "ADA" });
});
