import { expectTypeOf, test } from "vitest";
import { z } from "zod";

import { Entity } from "./index.js";

const LineId = z.uuid().brand("LineId");
const OrderId = z.uuid().brand("OrderId");
const Label = z.string().min(1).brand("Label");
const Email = z.email().brand("Email");

class Line extends Entity("Line")(
  { id: LineId, label: Label },
  { computed: { shout: Entity.computed(Label, (d) => d.label.toUpperCase()) } },
) {}
class Personal extends Entity("Personal")({ kind: z.literal("personal"), email: Email }) {}
class Business extends Entity("Business")({ kind: z.literal("business"), vat: Label }) {}
const Payer = Entity.union("kind", [Personal, Business]);

class Order extends Entity("Order")({
  id: OrderId,
  lines: z.array(Line),
  backup: z.optional(Line),
  payer: Payer,
}) {}

type PlainLine = { id: z.output<typeof LineId>; label: z.output<typeof Label> };

test("the public members type a nested entity as its plain data, not its instance", () => {
  type Out = z.output<typeof Order.output>;
  expectTypeOf<Out["lines"][number]>().toEqualTypeOf<{
    id: z.output<typeof LineId>;
    label: z.output<typeof Label>;
    shout: z.output<typeof Label>;
  }>();
  expectTypeOf<z.output<typeof Order.input>["lines"][number]>().toEqualTypeOf<PlainLine>();
  expectTypeOf<z.output<typeof Order.createInput>["backup"]>().toEqualTypeOf<
    PlainLine | undefined
  >();
  expectTypeOf<z.output<typeof Order.updateInput>["lines"]>().toEqualTypeOf<
    PlainLine[] | undefined
  >();
});

test("a union field is the union of its members' plain data", () => {
  expectTypeOf<z.output<typeof Order.output>["payer"]>().toEqualTypeOf<
    | { kind: "personal"; email: z.output<typeof Email> }
    | { kind: "business"; vat: z.output<typeof Label> }
  >();
});

test("the domain types still carry nested instances", () => {
  expectTypeOf<Entity.Output<typeof Order>["lines"][number]>().toHaveProperty("toJSON");
  expectTypeOf<Order["lines"][number]>().toHaveProperty("update");
});
