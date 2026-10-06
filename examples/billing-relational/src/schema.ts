/**
 * The tables, and Kysely's view of them.
 *
 * One aggregate, `Order`, spread over two tables because it owns a list:
 * `orders` and `order_lines` are always written together, in one transaction.
 * The other two tables are not part of it. `customers` is a separate aggregate
 * the order references by id, and `outbox` holds the events a save announces.
 *
 * Every column type below is a plain `string` or `number`. That is
 * deliberate: Kysely describes what the driver hands back, and the driver has
 * never heard of a brand. The adapter does not paper over that with casts; a
 * read goes through `Order.make`, which parses the plain values into branded
 * ones, and a write takes `toJSON()`, whose branded values are already
 * assignable to the plain column types.
 */
import type { ColumnType, Generated } from "kysely";

/** The aggregate shape a row written today has. Bumped by every row-shape change. */
export const CURRENT_SCHEMA_VERSION = 2 as const;

export type Database = {
  customers: {
    id: string;
    billing_name: string;
    billing_address: string;
  };
  orders: {
    id: string;
    /** A reference to another aggregate: a foreign key, never a join into the entity. */
    customer_id: string;
    currency: string;
    status: string;
    /**
     * The `billTo` snapshot, copied into the order's own row when it is placed.
     * Both null on a draft. Not a join to `customers`: a snapshot records who
     * was billed, and must not follow the customer when it moves.
     */
    bill_to_name: string | null;
    bill_to_address: string | null;
    /** Optimistic concurrency. Compared and incremented by every save. */
    version: number;
    /** Which row shape this aggregate was written in. See `migrate` in `index.ts`. */
    schema_version: 1 | 2;
  };
  order_lines: {
    order_id: string;
    id: string;
    /** Keeps the order's line order; a table has none of its own. */
    position: number;
    label: string;
    quantity: number;
    /**
     * Schema version 1 only: the price in major units (`12.50`), priced in the
     * order's currency. `numeric` comes back from Postgres as a string.
     * Null on every row written at version 2.
     */
    unit_price: string | null;
    /** Schema version 2: integer minor units, and the line's own currency. */
    unit_price_amount: number | null;
    unit_price_currency: string | null;
  };
  outbox: {
    id: string;
    aggregate_id: string;
    type: string;
    payload: ColumnType<unknown, string, string>;
    /** Set by the relay once the event is published, never inside the save. */
    delivered_at: ColumnType<Date | null, never, Date>;
    position: Generated<number>;
  };
};

/**
 * The DDL the specs run against PGlite. A real service keeps this in its
 * migration tool; it lives here so the example has nothing to install.
 */
export const DDL = `
  create table customers (
    id              uuid primary key,
    billing_name    text not null,
    billing_address text not null
  );

  create table orders (
    id              uuid primary key,
    customer_id     uuid not null constraint orders_customer_id_fkey references customers (id),
    currency        text not null,
    status          text not null,
    bill_to_name    text,
    bill_to_address text,
    version         integer not null,
    schema_version  integer not null check (schema_version in (1, 2))
  );

  create table order_lines (
    order_id            uuid not null references orders (id) on delete cascade,
    id                  uuid not null,
    position            integer not null,
    label               text not null,
    quantity            integer not null,
    unit_price          numeric(12, 2),
    unit_price_amount   integer,
    unit_price_currency text,
    primary key (order_id, id)
  );

  create table outbox (
    id           uuid primary key,
    aggregate_id uuid not null,
    type         text not null,
    payload      jsonb not null,
    delivered_at timestamptz,
    position     integer generated always as identity
  );
`;
