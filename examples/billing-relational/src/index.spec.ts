import { LineLabel, Money } from "@btravstack/entity-example-billing-domain";
import {
  BillingParty,
  OrderId,
  OrderLine,
  Quantity,
  createCustomer,
  createOrderLine,
  openOrder,
} from "@btravstack/entity-example-billing-domain/order";
import { PGlite } from "@electric-sql/pglite";
import { Kysely, sql } from "kysely";
import { PGliteDialect } from "kysely-pglite-dialect";
import { OkAsync } from "unthrown";
import { beforeEach, expect, test } from "vitest";

import { customerRepository, orderRepository, placeOrder, relayOutbox } from "./index.js";
import { DDL, type Database } from "./schema.js";

// Real Postgres, in-process: a fresh database per test, no server, no Docker.
let db: Kysely<Database>;
beforeEach(async () => {
  const pglite = new PGlite();
  await pglite.exec(DDL);
  db = new Kysely<Database>({ dialect: new PGliteDialect(pglite) });
  return () => db.destroy();
});

const eur = (amount: number) => Money.parse({ amount, currency: "EUR" });

const line = (label: string, amount = 10_00) =>
  createOrderLine({
    label: LineLabel.parse(label),
    unitPrice: eur(amount),
    quantity: Quantity.parse(2),
  }).getOrThrow();

/** A stored customer and a stored one-line draft order, at version 1. */
const seed = async () => {
  const customer = createCustomer({
    billing: BillingParty.parse({ name: "Acme SA", address: "1 rue de la Paix, Paris" }),
  }).getOrThrow();
  await customerRepository(db).add(customer);
  const order = openOrder(customer.id, "EUR")
    .flatMap((draft) => draft.addLine(line("Widget")))
    .getOrThrow();
  await expect(orderRepository(db).save(order, 0, [])).toBeOkWith(1);
  return { customer, order };
};

test("an aggregate round-trips through three tables, brands, lines and snapshot intact", async () => {
  const { order } = await seed();
  await expect(placeOrder(db)(order.id)).toBeOk();

  const { order: loaded, version } = (await orderRepository(db).load(order.id)).getOrThrow();

  expect(version).toBe(2);
  expect(loaded.status).toBe("PLACED");
  expect(loaded.billTo).toEqual({ name: "Acme SA", address: "1 rue de la Paix, Paris" });
  expect(loaded.lines[0]).toBeInstanceOf(OrderLine);
  expect(loaded.lines[0]!.subtotal).toEqual({ amount: 20_00, currency: "EUR" });
  expect(loaded.total).toEqual({ amount: 20_00, currency: "EUR" });
  expect(loaded.sameIdentityAs(order)).toBe(true);
});

test("the snapshot is copied, not joined: the customer moving does not rewrite the order", async () => {
  const { customer, order } = await seed();
  await expect(placeOrder(db)(order.id)).toBeOk();

  await db
    .updateTable("customers")
    .set({ billing_name: "Acme SAS", billing_address: "2 avenue Foch, Lyon" })
    .where("id", "=", customer.id)
    .execute();

  const { order: loaded } = (await orderRepository(db).load(order.id)).getOrThrow();
  expect(loaded.billTo?.address).toBe("1 rue de la Paix, Paris");
});

test("two saves from the same version: one succeeds, the other is a ConcurrentModification", async () => {
  const { order } = await seed();
  const repository = orderRepository(db);

  const first = (await repository.load(order.id)).getOrThrow();
  const second = (await repository.load(order.id)).getOrThrow();
  expect(first.version).toBe(second.version);

  const mine = first.order.addLine(line("Gadget")).getOrThrow();
  const theirs = second.order.addLine(line("Gizmo")).getOrThrow();

  await expect(repository.save(mine, first.version, [])).toBeOkWith(2);
  await expect(repository.save(theirs, second.version, [])).toBeErrTagged("ConcurrentModification");

  // Not a silent overwrite: the stored order is the winner's, and only that.
  const stored = (await repository.load(order.id)).getOrThrow();
  expect(stored.order.lines.map((each) => each.label)).toEqual(["Widget", "Gadget"]);
});

test("creating an order whose id is already stored is a conflict too", async () => {
  const { order } = await seed();
  await expect(orderRepository(db).save(order, 0, [])).toBeErrTagged("ConcurrentModification");
});

test("a reference to a missing customer is a typed error, triaged from the foreign key", async () => {
  const stranger = createCustomer({
    billing: BillingParty.parse({ name: "Nobody", address: "Nowhere" }),
  }).getOrThrow();
  const order = openOrder(stranger.id, "EUR").getOrThrow();

  await expect(orderRepository(db).save(order, 0, [])).toBeErrTagged("CustomerNotFound");
});

test("a failed transaction commits neither the new state nor its outbox rows", async () => {
  const { customer, order } = await seed();
  const repository = orderRepository(db);
  const { order: draft, version } = (await repository.load(order.id)).getOrThrow();
  const placed = draft.place(customer).getOrThrow();

  // An event id already in the outbox: the outbox insert, the last statement
  // of the save, hits the primary key after the order row was updated.
  const eventId = crypto.randomUUID();
  await db
    .insertInto("outbox")
    .values({ id: eventId, aggregate_id: order.id, type: "Earlier", payload: "{}" })
    .execute();

  const saved = repository.save(placed, version, [
    {
      eventId,
      type: "OrderPlaced",
      orderId: placed.id,
      customerId: placed.customerId,
      total: placed.total,
    },
  ]);
  await expect(saved).toBeDefect();

  const after = (await repository.load(order.id)).getOrThrow();
  expect(after.version).toBe(version);
  expect(after.order.status).toBe("DRAFT");
  const outbox = await db.selectFrom("outbox").select("type").execute();
  expect(outbox).toEqual([{ type: "Earlier" }]);
});

test("events are delivered after commit, by the relay, once", async () => {
  const { order } = await seed();
  await expect(placeOrder(db)(order.id)).toBeOk();

  const published: unknown[] = [];
  const publish = (payload: unknown) => {
    published.push(payload);
    return OkAsync();
  };

  await expect(relayOutbox(db)(publish)).toBeOkWith(1);
  expect(published).toEqual([expect.objectContaining({ type: "OrderPlaced", orderId: order.id })]);
  await expect(relayOutbox(db)(publish)).toBeOkWith(0);
});

test("a version-1 row is migrated at the repository boundary before make", async () => {
  const { customer } = await seed();
  const id = OrderId.parse(crypto.randomUUID());

  // Written by an older release: the price in major units, no line currency.
  await sql`
    insert into orders (id, customer_id, currency, status, version, schema_version)
    values (${id}, ${customer.id}, 'EUR', 'DRAFT', 7, 1)
  `.execute(db);
  await sql`
    insert into order_lines (order_id, id, position, label, quantity, unit_price)
    values (${id}, ${crypto.randomUUID()}, 0, 'Legacy widget', 3, 12.50)
  `.execute(db);

  const { order, version } = (await orderRepository(db).load(id)).getOrThrow();
  expect(order.lines[0]!.unitPrice).toEqual({ amount: 12_50, currency: "EUR" });
  expect(order.total.amount).toBe(37_50);

  // The next save writes the current shape, so the row heals as it is touched.
  await expect(orderRepository(db).save(order, version, [])).toBeOkWith(8);
  const healed = await db
    .selectFrom("order_lines")
    .selectAll()
    .where("order_id", "=", id)
    .execute();
  expect(healed).toEqual([
    expect.objectContaining({
      unit_price: null,
      unit_price_amount: 12_50,
      unit_price_currency: "EUR",
    }),
  ]);
  const { schema_version } = await db
    .selectFrom("orders")
    .select("schema_version")
    .where("id", "=", id)
    .executeTakeFirstOrThrow();
  expect(schema_version).toBe(2);
});

test("a row no migration can save is an InvalidEntity, not a typed lie", async () => {
  const { customer } = await seed();
  const id = OrderId.parse(crypto.randomUUID());
  await sql`
    insert into orders (id, customer_id, currency, status, bill_to_name, version, schema_version)
    values (${id}, ${customer.id}, 'EUR', 'PLACED', 'Half a snapshot', 1, 2)
  `.execute(db);

  await expect(orderRepository(db).load(id)).toBeErrTagged("InvalidEntity");
});
