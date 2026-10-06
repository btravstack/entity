---
title: Compared with zod and Effect
description: One small domain model written three ways, with plain zod and functions, with entity, and with Effect's Schema.Class, and what each one leaves you to write.
---

# Compared with zod and Effect

The same small model, written three ways: plain zod plus functions, this
package, and [Effect's `Schema.Class`](https://effect.website/docs/v3/schema/classes)
(effect 3.22.2). All three run in
[`examples/billing-domain/src/comparison.spec.ts`](https://github.com/btravstack/entity/blob/main/examples/billing-domain/src/comparison.spec.ts),
and every behaviour this page states is a test there.

This is not a benchmark, and nothing here claims the other two cannot do
something. Each version is written the way its library documents it. The
question is what each one leaves you to write.

## The model

A customer has a generated, immutable `id`, an `email`, a `plan` and a `seats`
count, under one rule that spans two fields: a free plan allows at most three
seats. Callers create customers without an id and update everything but the id.

```ts
const CustomerId = z.uuid().brand("CustomerId");
const Email = z.email().brand("Email");
const Plan = z.enum(["free", "pro"]);
const Seats = z.number().int().positive().brand("Seats");

const withinFreeCap = (d: { plan: "free" | "pro"; seats: number }) =>
  d.plan !== "free" || d.seats <= 3;
const FREE_SEAT_CAP = "a free plan allows at most 3 seats";
```

`nextId()` stands for whatever id source you bind; the spec returns a fixed
UUID.

## Plain zod plus functions

```ts
const PlainShape = z.object({
  id: CustomerId,
  email: Email,
  plan: Plan,
  seats: Seats,
});
const PlainCustomer = PlainShape.refine(withinFreeCap, FREE_SEAT_CAP);
type PlainCustomer = Readonly<z.infer<typeof PlainShape>>;

const PlainCreateInput = PlainShape.omit({ id: true });
const PlainUpdateInput = PlainShape.omit({ id: true }).partial().strict();

const parsePlain = (data: unknown) => {
  const parsed = PlainCustomer.safeParse(data);
  if (parsed.success) Object.freeze(parsed.data);
  return parsed;
};
const createPlain = (input: unknown) => {
  const parsed = PlainCreateInput.safeParse(input);
  return parsed.success ? parsePlain({ ...parsed.data, id: nextId() }) : parsed;
};
const updatePlain = (customer: PlainCustomer, patch: unknown) => {
  const parsed = PlainUpdateInput.safeParse(patch);
  return parsed.success ? parsePlain({ ...customer, ...parsed.data }) : parsed;
};
```

Nothing to adopt beyond zod, and it runs anywhere zod does. You write the
request schemas, the create and update functions, the freeze and the equality
check, and keep them in step with the shape by hand.

## entity

```ts
class Customer extends Entity("Customer")(
  {
    id: Entity.field(CustomerId, { identity: true, generated: true }),
    email: Email,
    plan: Plan,
    seats: Seats,
  },
  {
    invariants: [
      Entity.invariant({
        code: "OVER_FREE_SEAT_CAP",
        ensure: withinFreeCap,
        message: FREE_SEAT_CAP,
      }),
    ],
  },
) {}

const createCustomer = Customer.factory({
  id: () => CustomerId.parse(nextId()),
});
```

The two flags on `id` are what the hand-written parts above become:
`Customer.createInput` and `Customer.updateInput` are derived from them,
`createCustomer` and `customer.update(patch)` are the create and update
functions, and both return a `Result`. Freezing and `sameIdentityAs` come with
the class. The cost is the adoption: two more peer dependencies and branded
fields everywhere. See [Guarantees and compatibility](/reference/guarantees).

## Effect Schema.Class

```ts
class EffectCustomer extends Schema.Class<EffectCustomer>("Customer")(
  Schema.Struct({
    id: Schema.UUID.pipe(Schema.brand("CustomerId")),
    email: Schema.String.pipe(
      Schema.pattern(/^[^@\s]+@[^@\s]+$/),
      Schema.brand("Email"),
    ),
    plan: Schema.Literal("free", "pro"),
    seats: Schema.Int.pipe(Schema.positive(), Schema.brand("Seats")),
  }).pipe(Schema.filter((d) => withinFreeCap(d) || FREE_SEAT_CAP)),
) {}

const EffectCreateInput = Schema.Struct(EffectCustomer.fields).pipe(
  Schema.omit("id"),
);
const EffectUpdateInput = Schema.partial(EffectCreateInput);

const decodeEffect = Schema.decodeUnknownEither(EffectCustomer);
const createEffect = (input: unknown) =>
  Schema.decodeUnknownEither(EffectCreateInput)(input).pipe(
    Either.flatMap((fields) => decodeEffect({ ...fields, id: nextId() })),
  );
const updateEffect = (customer: EffectCustomer, patch: unknown) =>
  Schema.decodeUnknownEither(EffectUpdateInput, { onExcessProperty: "error" })(
    patch,
  ).pipe(Either.flatMap((fields) => decodeEffect({ ...customer, ...fields })));
```

The class gives a type, a validator, methods and structural equality in one
declaration, the same four jobs this package targets. Like plain zod, the
request schemas and the create and update functions are yours to write. Effect
brings its own schema language rather than zod, and a wider ecosystem with it.

## What each leaves you to write

| Job                                 | Plain zod                          | entity                                      | Effect `Schema.Class`                          |
| ----------------------------------- | ---------------------------------- | ------------------------------------------- | ---------------------------------------------- |
| create and update request schemas   | hand-written `omit` / `partial`    | derived from the field flags                | hand-written `omit` / `partial`                |
| create with a generated id          | a function you write               | `factory(generators)`                       | a function you write                           |
| refuse a patch to the id at runtime | `.strict()` on your update schema  | `update` rejects it with the key's path     | `onExcessProperty: "error"` on your decode     |
| re-check the rule on update         | your update function re-parses     | `update` re-runs every invariant            | your update function re-decodes                |
| failures as values                  | `safeParse` result                 | `Result<T, InvalidEntity>`                  | `Either` from `decodeUnknownEither`            |
| value equality                      | `isDeepStrictEqual` yourself       | `isDeepStrictEqual` over `toJSON()`         | `Equal.equals(a, b)`                           |
| identity equality                   | compare the ids yourself           | `sameIdentityAs`, from `identity` flags     | compare the ids yourself                       |
| runtime-immutable instance          | `Object.freeze`, shallow, yourself | non-writable fields, plain data deep-frozen | not frozen in 3.22.2; `readonly` is type-level |

Each row is exercised for all three columns by the spec.

## Where they differ, measured

**The constructor.** Effect's constructor is public and validates:
`new EffectCustomer(invalid)` throws a `ParseError`. This package's
constructor is sealed at the type level instead: `new Customer(...)` does not
compile, and a cast that gets past the seal builds an instance with **no**
validation and no invariant. The seal steers code to `make`; it is not a
runtime trust boundary. See [Sealed construction](/explanation/sealed-construction).

**Assignment through a cast.** On the frozen plain object and on an entity,
assigning `seats` through a cast throws a `TypeError`. On the Effect 3.22.2
instance the same assignment succeeds.

**The class as JSON Schema.** `JSONSchema.make(EffectCustomer)` produces a
schema. `z.toJSONSchema(Customer, { io: "output" })` throws, because the class
parses to an instance through a transform; contracts here use
`Customer.output` and the other three plain `ZodObject`s instead. See
[Schema members](/reference/schemas).

## Choosing

- Plain zod is enough when a model has no behaviour worth a class.
- Effect `Schema.Class` fits when the codebase already speaks Effect.
- entity fits a zod-based backend where the same four jobs (type,
  validator, behaviour, nesting) recur across many models and you want the
  request schemas and update rules derived from one declaration, with every
  failure as a `Result`.
