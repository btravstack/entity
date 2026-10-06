/**
 * A relational repository for the `Order` aggregate, over Kysely.
 *
 * The entity knows nothing about any of this. What the adapter decides, per
 * field, is the domain decision the nesting alone cannot tell it:
 *
 *  - `lines` are **owned**, so they get a child table written in the same
 *    transaction as the order, replaced wholesale on every save.
 *  - `customerId` is a **reference** to another aggregate, so it is a foreign
 *    key. Loading an order never loads the customer.
 *  - `billTo` is a **snapshot**, so it is copied into columns on `orders`
 *    rather than joined from `customers`: it records who was billed, and must
 *    not follow the customer when it moves.
 *
 * Four more decisions live here and nowhere else: the `version` column that
 * turns a lost update into a `ConcurrentModification`, the outbox written in
 * the save's own transaction, the pure `migrate` that brings an old row up to
 * date before `make` sees it, and the triage that turns a driver rejection into
 * a typed error or a Defect. Every method returns an `AsyncResult`; there is no
 * `try`/`catch` in the file.
 *
 * See also the how-to: <https://btravstack.github.io/entity/how-to/persist-relationally>.
 */
import type { Entity } from "@btravstack/entity";
import { Customer, Order } from "@btravstack/entity-example-billing-domain/order";
import type { Kysely, Selectable } from "kysely";
import {
  allAsync,
  fromNullable,
  fromPromise,
  fromSafePromise,
  OkAsync,
  TaggedError,
} from "unthrown";
import type { AsyncResult } from "unthrown";
import { z } from "zod";

import { CURRENT_SCHEMA_VERSION, type Database } from "./schema.js";

type OrderId = Order["id"];
type CustomerId = Customer["id"];

/* ── Errors ────────────────────────────────────────────────────────────── */

export class OrderNotFound extends TaggedError("OrderNotFound")<{ orderId: string }> {
  override message = `no order ${this.orderId}`;
}

/** Absent on a read, or rejected by the foreign key on a write: either way, not there. */
export class CustomerNotFound extends TaggedError("CustomerNotFound")<{ customerId: string }> {
  override message = `no customer ${this.customerId}`;
}

/**
 * Someone else saved this order since it was loaded. Not an overwrite and not
 * a Defect: the caller decides whether to reload and retry, or to report a 409.
 */
export class ConcurrentModification extends TaggedError("ConcurrentModification")<{
  orderId: string;
  expectedVersion: number;
}> {
  override message = `order ${this.orderId} changed since version ${this.expectedVersion} was loaded`;
}

/* ── Events ────────────────────────────────────────────────────────────── */

/**
 * Announced by `placeOrder`, because `place` ran. Not derived by diffing two
 * versions of the order: a status that changed is not the same fact as an
 * order being placed, and an import or a correction can change it too.
 */
export type OrderPlaced = {
  readonly eventId: string;
  readonly type: "OrderPlaced";
  readonly orderId: OrderId;
  readonly customerId: CustomerId;
  readonly total: Order["total"];
};

export type OrderEvent = OrderPlaced;

/* ── Rows ──────────────────────────────────────────────────────────────── */

type Stored = {
  readonly order: Selectable<Database["orders"]>;
  readonly lines: readonly Selectable<Database["order_lines"]>[];
};

/**
 * The legacy-row policy: a pure function from a stored aggregate in any
 * supported row shape to the current one, run before `make`, so the entity
 * only ever validates one shape.
 *
 * Version 1 stored a line's price in major units (`12.50`) with no currency of
 * its own; version 2 stores integer minor units and the line's currency. The
 * table's `check (schema_version in (1, 2))` is what makes the `1 | 2` honest.
 * A third version adds one branch here, and its step runs after this one.
 */
const migrate = (stored: Stored): Stored =>
  stored.order.schema_version === 1
    ? {
        order: { ...stored.order, schema_version: CURRENT_SCHEMA_VERSION },
        lines: stored.lines.map((line) => ({
          ...line,
          unit_price: null,
          // `numeric(12, 2)` holds at most two decimals, so rounding is exact.
          unit_price_amount:
            line.unit_price === null ? null : Math.round(Number(line.unit_price) * 100),
          unit_price_currency: stored.order.currency,
        })),
      }
    : stored;

/**
 * The current row shape back to what `Order.make` reads. Plain values in,
 * `unknown` to `make`, which brands and checks them: no cast is needed, and a
 * column the shape does not account for (a null where a price belongs) comes
 * back as an `InvalidEntity`, never as a typed lie.
 */
const toInput = ({ order, lines }: Stored) => ({
  id: order.id,
  customerId: order.customer_id,
  currency: order.currency,
  status: order.status,
  // Both null is a draft. Only one null is corrupt, and `make` says so.
  billTo:
    order.bill_to_name === null && order.bill_to_address === null
      ? undefined
      : { name: order.bill_to_name, address: order.bill_to_address },
  lines: lines.map((line) => ({
    id: line.id,
    label: line.label,
    quantity: line.quantity,
    unitPrice: { amount: line.unit_price_amount, currency: line.unit_price_currency },
  })),
});

/* ── Driver triage ─────────────────────────────────────────────────────── */

/** The part of a Postgres error worth triaging on, parsed rather than cast. */
const PostgresError = z.object({ code: z.string(), constraint: z.string().optional() });

const FOREIGN_KEY_VIOLATION = "23503";

/* ── The repository ────────────────────────────────────────────────────── */

export type Loaded = { readonly order: Order; readonly version: number };

export const orderRepository = (db: Kysely<Database>) => ({
  /**
   * Both reads in one `repeatable read` transaction, so the order row and its
   * lines come from the same snapshot even while a save replaces the lines.
   * A read has no failure worth modelling, so every rejection is a Defect.
   */
  load: (id: OrderId): AsyncResult<Loaded, OrderNotFound | Entity.InvalidEntity> =>
    fromSafePromise(() =>
      db
        .transaction()
        .setIsolationLevel("repeatable read")
        .execute(async (trx) => ({
          order: await trx.selectFrom("orders").selectAll().where("id", "=", id).executeTakeFirst(),
          lines: await trx
            .selectFrom("order_lines")
            .selectAll()
            .where("order_id", "=", id)
            .orderBy("position")
            .execute(),
        })),
    ).flatMap(({ order, lines }) =>
      fromNullable(order, () => new OrderNotFound({ orderId: id })).flatMap((row) =>
        Order.make(toInput(migrate({ order: row, lines }))).map((loaded) => ({
          order: loaded,
          version: row.version,
        })),
      ),
    ),

  /**
   * Writes the replacement aggregate and its events in one transaction, if and
   * only if the stored row is still at `expectedVersion`. `0` means "new".
   *
   * The version check is the first statement. When it matches no row nothing
   * has been written, so the callback returns and commits an empty
   * transaction; the conflict becomes an error value outside it, with no
   * `throw` needed to roll anything back. Any later rejection rolls the whole
   * transaction back: the order, its lines and its outbox rows together.
   */
  save: (
    order: Order,
    expectedVersion: number,
    events: readonly OrderEvent[],
  ): AsyncResult<number, ConcurrentModification | CustomerNotFound> => {
    const json = order.toJSON();
    const version = expectedVersion + 1;
    const row = {
      id: json.id,
      customer_id: json.customerId,
      currency: json.currency,
      status: json.status,
      bill_to_name: json.billTo?.name ?? null,
      bill_to_address: json.billTo?.address ?? null,
      version,
      schema_version: CURRENT_SCHEMA_VERSION,
    };

    return fromPromise(
      () =>
        db.transaction().execute(async (trx) => {
          const written =
            expectedVersion === 0
              ? (
                  await trx
                    .insertInto("orders")
                    .values(row)
                    .onConflict((conflict) => conflict.column("id").doNothing())
                    .executeTakeFirst()
                ).numInsertedOrUpdatedRows
              : (
                  await trx
                    .updateTable("orders")
                    .set(row)
                    .where("id", "=", json.id)
                    .where("version", "=", expectedVersion)
                    .executeTakeFirst()
                ).numUpdatedRows;
          if (written === 0n) return false;

          await trx.deleteFrom("order_lines").where("order_id", "=", json.id).execute();
          if (json.lines.length > 0) {
            await trx
              .insertInto("order_lines")
              .values(
                json.lines.map((line, position) => ({
                  order_id: json.id,
                  id: line.id,
                  position,
                  label: line.label,
                  quantity: line.quantity,
                  unit_price: null,
                  unit_price_amount: line.unitPrice.amount,
                  unit_price_currency: line.unitPrice.currency,
                })),
              )
              .execute();
          }
          if (events.length > 0) {
            await trx
              .insertInto("outbox")
              .values(
                events.map((event) => ({
                  id: event.eventId,
                  aggregate_id: json.id,
                  type: event.type,
                  payload: JSON.stringify(event),
                })),
              )
              .execute();
          }
          return true;
        }),
      // The one rejection with a domain meaning: the referenced customer does
      // not exist. Every other one, an outbox clash included, is a Defect.
      (cause, defect) => {
        const error = PostgresError.safeParse(cause);
        return error.success &&
          error.data.code === FOREIGN_KEY_VIOLATION &&
          error.data.constraint === "orders_customer_id_fkey"
          ? new CustomerNotFound({ customerId: json.customerId })
          : defect(cause);
      },
    )
      .ensure(
        (saved) => saved,
        () => new ConcurrentModification({ orderId: json.id, expectedVersion }),
      )
      .map(() => version);
  },
});

/** The other aggregate. It commits on its own, and an order only ever holds its id. */
export const customerRepository = (db: Kysely<Database>) => ({
  add: (customer: Customer): AsyncResult<void, never> => {
    const json = customer.toJSON();
    return fromSafePromise(() =>
      db
        .insertInto("customers")
        .values({
          id: json.id,
          billing_name: json.billing.name,
          billing_address: json.billing.address,
        })
        .execute(),
    ).map(() => undefined);
  },

  load: (id: CustomerId): AsyncResult<Customer, CustomerNotFound | Entity.InvalidEntity> =>
    fromSafePromise(() =>
      db.selectFrom("customers").selectAll().where("id", "=", id).executeTakeFirst(),
    ).flatMap((found) =>
      fromNullable(found, () => new CustomerNotFound({ customerId: id })).flatMap((row) =>
        Customer.make({
          id: row.id,
          billing: { name: row.billing_name, address: row.billing_address },
        }),
      ),
    ),
});

/* ── A use case ────────────────────────────────────────────────────────── */

/**
 * Load, run the domain command, save the replacement with the version it was
 * loaded at, and record the event in the same transaction. Nothing is
 * published here: delivery is the relay's job, after commit.
 */
export const placeOrder = (db: Kysely<Database>) => (id: OrderId) =>
  orderRepository(db)
    .load(id)
    .flatMap(({ order, version }) =>
      customerRepository(db)
        .load(order.customerId)
        .flatMap((customer) => order.place(customer))
        .flatMap((placed) =>
          orderRepository(db)
            .save(placed, version, [
              {
                eventId: crypto.randomUUID(),
                type: "OrderPlaced",
                orderId: placed.id,
                customerId: placed.customerId,
                total: placed.total,
              },
            ])
            .map(() => placed),
        ),
    );

/* ── Delivery ──────────────────────────────────────────────────────────── */

/**
 * Publishes every undelivered outbox row in the order it was written, then marks them
 * delivered. It only ever sees committed rows, so a rolled-back save publishes
 * nothing. Publish-then-mark is at-least-once: a crash between the two
 * publishes again, so consumers dedupe on the event id.
 *
 * ponytail: one relay at a time. Several concurrent relays want
 * `for update skip locked` on the select, inside a transaction.
 */
export const relayOutbox =
  (db: Kysely<Database>) =>
  (publish: (payload: unknown) => AsyncResult<void, never>): AsyncResult<number, never> =>
    fromSafePromise(() =>
      db
        .selectFrom("outbox")
        .select(["id", "payload"])
        .where("delivered_at", "is", null)
        .orderBy("position")
        .execute(),
    ).flatMap((rows) =>
      rows.length === 0
        ? OkAsync(0)
        : allAsync(rows.map((row) => publish(row.payload)))
            .flatMap(() =>
              fromSafePromise(() =>
                db
                  .updateTable("outbox")
                  .set({ delivered_at: new Date() })
                  .where(
                    "id",
                    "in",
                    rows.map((row) => row.id),
                  )
                  .execute(),
              ),
            )
            .map(() => rows.length),
    );
