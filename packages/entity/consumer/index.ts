/**
 * A stand-in for a downstream *library*: it exports an entity subclass **and**
 * emits its own declarations. That combination is what regressed before — a
 * module-private `unique symbol` in the seal made every such consumer fail
 * with TS4020, while this repo's own build (which does not emit declarations
 * through `tsc`) stayed green.
 *
 * `tsconfig.consumer.json` compiles this, and both of its overrides are load
 * bearing: it turns `noEmit` off because declaration emit is what surfaces a
 * leaked private name, and points `paths` at `dist/*.d.mts` so this exercises
 * the published types rather than `src`.
 *
 * It is also what guards the namespace: every member of `Entity` is reached
 * through the built `d.mts` below, because a member emitted as a circular
 * self-alias still *compiles* and only shows up as a `@ts-expect-error` here
 * going unused. See the `Src` comment in `entity.ts`. An unused directive in
 * this file is a failure, not noise.
 */
import { Entity } from "@btravstack/entity";
import { z } from "zod";

const OrgId = z.uuid().brand("OrgId");
const Slug = z.string().min(1).brand("Slug");
const Upper = z.string().min(1).brand("Upper");

export class Organization extends Entity("Organization")(
  { id: OrgId, slug: Slug },
  {
    immutable: ["id"],
    computed: {
      shout: Entity.computed(Upper, (d) => d.slug.toUpperCase() as z.infer<typeof Upper>),
    },
    invariants: [Entity.invariant((d) => d.slug.length <= 40, "slug must be at most 40 chars")],
  },
) {}

/** The statics must still yield the subclass, not the structural base. */
export const load = (raw: unknown): Organization => Organization.make(raw).getOrThrow();

/** The class must still compose as a schema from outside the package. */
export const Aggregate = z.object({ owner: Organization });

// @ts-expect-error construction stays sealed for a consumer
new Organization({ id: "x" as never, slug: "y" as never });

// @ts-expect-error the construction key cannot be forged structurally
const forged: Entity.ConstructionKey = {} as { seal: never };
void forged;

/**
 * Every remaining namespace member, named from outside the package. A member
 * emitted as a circular self-alias degenerates silently, so each one has to be
 * *used* somewhere declaration emit will walk it.
 */
export type Row = Entity.Output<typeof Organization>;
export type Wire = Entity.Input<typeof Organization>;
export type NewOrg = Entity.CreateInput<typeof Organization>;
export type OrgPatch = Entity.Patch<typeof Organization>;
export type Derived = Entity.ComputedField<typeof Upper, { slug: z.infer<typeof Slug> }>;
export type Rule = Entity.Invariant<{ slug: z.infer<typeof Slug> }>;
export type Sealed = Entity.Sealed<Row>;
export type Base = Entity.BaseInstance<{ id: typeof OrgId }, Record<never, never>, []>;
export type Static = Entity.Static<
  "Organization",
  { id: typeof OrgId },
  Record<never, never>,
  [],
  []
>;

/** The error is reachable as both a value and a type. */
export const isInvalid = (e: unknown): e is Entity.InvalidEntity =>
  e instanceof Entity.InvalidEntity;

const Member = Entity.union("kind", [Organization, Organization] as const);
export type MemberUnion = Entity.Union<"kind", [typeof Organization, typeof Organization]>;
void Member;

/**
 * The two field shapes that broke declaration emit while `EntityStatic` was
 * unexported, both reported from a real adoption.
 *
 * With no name to write for the builder's return type, TypeScript serialised
 * the whole static surface into this file's declarations, repeating the field
 * map a dozen times. A **branded object** field was expanded through
 * `DeepReadonly` until zod's module-private `$brand` symbol reached
 * computed-key position, which cannot be named across a module boundary
 * (`TS4020`, issue #32); and a realistically wide domain enum pushed the
 * repeated field map past the compiler's serialisation ceiling (`TS7056`,
 * issue #31). Both now emit as `EntityStatic<…>` by reference.
 *
 * Their guard value differs, and only one of them is carried by *this* pass:
 * `TS4020` reproduces on the repo's TypeScript, so the branded object below
 * fails here the moment the export is removed. `TS7056` is a 5.x-era limit the
 * native port does not enforce, so the wide enum is checked by
 * `tsconfig.consumer5.json` instead — see the comment there.
 */
const Money = z.object({ amount: z.number(), currency: z.enum(["EUR", "USD"]) }).brand("Money");

export class Invoice extends Entity("Invoice")({ id: OrgId, total: Money }) {}

/** The branded object must stay *usable*, not merely compile. */
export const invoiceTotal = (i: Invoice): number => i.total.amount;
export const invoiceCurrency = (i: Invoice): "EUR" | "USD" => i.total.currency;

// @ts-expect-error a branded object's members stay deep-readonly
export const mutateTotal = (i: Invoice): void => void (i.total.amount = 1);

const Reason = z.enum([
  "CANCELED_LEASE",
  "TENANT_LEAVE_BALANCE_DONE",
  "SUBROGATIVE_RECEIPT_TO_BE_SIGNED",
  "SUBROGATIVE_RECEIPT_SIGNED",
  "NO_RGI_CLAIM",
  "VISALE",
  "MONTHLY_PAYMENT",
  "GROWTH",
  "UNIT_SOLD",
  "EXPENSE_TRANSFER",
  "DECEASED_TENANT",
  "DECEASED_COOWNER",
  "DISPUTE_CHARGES",
  "DISPUTE_REPAIRS",
  "OWNER_INSTRUCTIONS_EXCLUDING_GLI",
  "CHECK_OR_CASH_NOT_RECORDED",
  "AWAITING_CAF_PAYMENT",
  "NEW_BUILDING",
  "NEW_COOWNER",
  "MANAGEMENT_DIFFICULTIES",
  "SALE_IN_PROGRESS",
  "PROMISE_OF_PAYMENT",
  "FALSE_DISTRIBUTIONS",
  "INSTITUTIONAL_COOWNER",
  "HISTORICAL",
  "TENANT_LEAVE_NO_REMINDER",
  "EXTERNAL_RGI_DISASTER",
  "OVER_INDEBTEDNESS_LEGAL_PROCEEDINGS",
  "MEMORANDUM_OF_AGREEMENT",
  "MANUAL_EXPENSE_TRANSFER",
]);
const Level = z.union([
  z.literal(0),
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
]);
const Instant = z.date().brand("Instant");

/**
 * Kept at the reported width on purpose. `TS7056` is a threshold on serialised
 * *characters*, so a field map trimmed even slightly — the timestamp dropped,
 * `Level` down to four members — lands back under the ceiling and the case
 * silently stops guarding anything. Measured while writing this fixture. If
 * this entity ever needs editing, re-check it still fails with the export
 * removed.
 */
export class Reminder extends Entity("Reminder")({
  id: OrgId,
  reasons: z.array(Reason),
  createdAt: Instant,
  status: z.enum(["ONGOING_REMINDER", "CLOSE"]),
  kind: z.enum(["TENANT_IN_PLACE", "TENANT_LEAVE", "CO_OWNER"]),
  level: Level,
  nextLevel: Level,
  flag: z.boolean(),
}) {}
