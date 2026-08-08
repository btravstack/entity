import { Entity } from "@btravstack/entity";

import { Organization } from "./organization.js";
import { Instant, Money } from "./vocabulary.js";

/**
 * What every billing document shares. A root rather than a third entity: it is
 * tagless, has no `make`, and exists to hold the fields and the behaviour the
 * variants have in common. `Entity.abstract` is the only extensible declaration
 * — an entity itself is final.
 *
 * `issuedTo` is another entity used directly as a field: the class is itself a
 * zod schema, so it parses back to a real `Organization`, behaviour and all.
 *
 * **Exported, and in a module of its own, on purpose.** A root's instance type
 * is the sixth type argument of every variant's `EntityStatic`, so it lands in
 * the emitted `.d.ts` of whatever module the variants are exported from — and
 * it lands there two different ways. Kept beside its variants, TypeScript
 * synthesises a local `declare abstract class`; across a module boundary it has
 * to *name* the export, and `index.d.ts` opens with
 * `import { BillingDocumentBase } from "./root.js"`. Only the first path was
 * covered while this declaration sat in `index.ts`. Measured on both TypeScript
 * 7.0.2 and 5.9.3: both paths emit clean, and `update`'s polymorphic `this`
 * survives both as `Result<Invoice, …>` rather than degrading.
 *
 * The user-facing rule is simpler than the emit is: a root has to be exported
 * for variants in another module to extend it at all, since `extend` is a call
 * on the value.
 */
export abstract class BillingDocumentBase extends Entity.abstract("BillingDocument")(
  { issuedTo: Organization, total: Money, issuedAt: Instant },
  {
    generated: ["issuedAt"],
    immutable: ["issuedAt", "issuedTo"],
    invariants: [Entity.invariant((d) => d.total.amount >= 0, "total must not be negative")],
  },
) {
  /** What the document contributes to the ledger — declared once, signed per variant. */
  abstract signedAmount(): number;

  get counterpartySlug(): string {
    return this.issuedTo.slug;
  }
}
