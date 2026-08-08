/**
 * NOT example code. Do not copy anything out of this file.
 *
 * It is a compile-time test that happens to live beside an example, because
 * what it tests *is* what an example is: a downstream package that uses the
 * library **and emits its own declarations**. It replaced
 * `packages/entity/consumer/`.
 *
 * Three rules that are easy to destroy by tidying:
 *
 *  1. **An unused `@ts-expect-error` here is a failure, not noise.** A
 *     namespace member emitted as a circular self-alias still *compiles*; the
 *     type simply degenerates, and a directive going unused is the only
 *     signal. Every member of `Entity` is therefore named below, so
 *     declaration emit has to walk each one.
 *
 *  2. **The gate checks the emitted declarations, not only that emitting
 *     succeeded.** `typecheck`'s last step feeds `node_modules/.emit-check` back
 *     through the 5.9.3 compiler. Without it the pass caught only emit-time
 *     diagnostics (`TS4020` and friends); a *dangling type-parameter reference
 *     in the output* is not one, and one shipped — `Omit<A, keyof A2> & A2`
 *     written inline at `extend`'s return type emitted a bare `A2`, which
 *     failed a consumer with `TS2304`. Never add `--skipLibCheck` to that step:
 *     it turns off `.d.ts` checking entirely and the run exits 0 on the broken
 *     output. Measured.
 *
 *  3. **The widths in `vocabulary.ts` are load bearing.** `TS7056` is a
 *     threshold on serialised *characters*, so `Invoice` — declared in
 *     `index.ts`, built from those schemas — needs its full dunning
 *     vocabulary, its branded timestamp and its six-member level union to stay
 *     above it. Measured: trimming them put the old fixture back under the
 *     ceiling, where it compiled happily and guarded nothing. Splitting the
 *     declarations out of `index.ts` did *not* shrink them — the emitter
 *     expands each schema in anonymous type-argument position rather than
 *     naming the binding, so `Invoice_base` still carries all thirty members
 *     inline.
 *
 * What went wrong when nothing checked this: `EntityStatic` was unexported, so
 * TypeScript had no name to write for the builder's return type and serialised
 * the entire static surface into every consumer's `.d.ts` — a one-field entity
 * emitted 274,048 bytes, against 240 now. A wide enum then crossed the ceiling
 * (`TS7056`, #31) and a branded object reached zod's module-private `$brand`
 * through `DeepReadonly` (`TS4020`, #32). `Entity.union` had the same problem
 * one type further along (`TS4023`), found while writing this example.
 */
import { Entity } from "@btravstack/entity";
import type { z } from "zod";

// `Organization` is imported as a value: the sealed-construction assertion
// below needs the runtime binding to write `new Organization(...)` at all.
import { Organization } from "./index.js";
import type { BillingDocument, CreditNote, DisplayLabel, Invoice, Money, Slug } from "./index.js";

/* ── Construction stays sealed from outside the package ───────────────── */

// @ts-expect-error `new` is a compile error: every instance comes through make, update or a factory
void new Organization({ id: "x" as never, slug: "y" as never });

// @ts-expect-error the construction key cannot be forged structurally
const forged: Entity.ConstructionKey = {} as { seal: never };
void forged;

/* ── A branded object stays deep-readonly (issue #32) ─────────────────── */

export const readTotal = (invoice: Invoice): number => invoice.total.amount;

export const mutateTotal = (invoice: Invoice): void => {
  // @ts-expect-error a branded object's members are readonly all the way down
  invoice.total.amount = 1;
};

/* ── Every namespace member, named so declaration emit walks it ───────── */

export type Row = Entity.Output<typeof Organization>;
export type Wire = Entity.Input<typeof Organization>;
export type NewOrg = Entity.CreateInput<typeof Organization>;
export type OrgPatch = Entity.Patch<typeof Organization>;
export type Derived = Entity.ComputedField<typeof DisplayLabel, { slug: z.infer<typeof Slug> }>;
export type Rule = Entity.Invariant<{ slug: z.infer<typeof Slug> }>;
export type SealedRow = Entity.Sealed<Row>;
export type Base = Entity.BaseInstance<{ slug: typeof Slug }, Record<never, never>, never>;
// `G` and `I` are unions of keys, so the empty case is `never` rather than `[]`.
export type Static = Entity.Static<
  "Organization",
  { slug: typeof Slug },
  Record<never, never>,
  never,
  never
>;
export type Members = Entity.Union<"kind", [typeof Invoice, typeof CreditNote]>;
export type AnyDocument = Entity.Instance<typeof BillingDocument>;
export type OneInvoice = Entity.Instance<typeof Invoice>;
export type Root = Entity.Abstract<
  "BillingDocument",
  { total: typeof Money },
  Record<never, never>,
  never,
  never
>;
export type Merged = Entity.MergedComputed<{ label: typeof DisplayLabel }, Record<never, never>>;

/** The error is reachable as both a value and a type. */
export const isInvalid = (error: unknown): error is Entity.InvalidEntity =>
  error instanceof Entity.InvalidEntity;
