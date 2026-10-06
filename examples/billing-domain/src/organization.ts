import { Entity } from "@btravstack/entity";
import { z } from "zod";

import { DisplayLabel, Instant, OrganizationId, Slug } from "./vocabulary.js";

/**
 * `Entity.field(schema, { generated, immutable })` flags the fields the
 * domain produces rather than the caller (`generated`, dropped from
 * `createInput`) and the ones `update` refuses (`immutable`). `computed` is
 * re-derived on every construction path, so it cannot drift from its sources.
 *
 * `riskTier` is **internal-only**: the credit team sets it, and no customer
 * should ever see it. It is an ordinary, mutable domain field, because the
 * domain does not know who is asking. Keeping it out of the public API is the
 * HTTP contract's job: `examples/billing-api` allowlists its response instead
 * of sending `output`. It stays absent until the credit team assesses the
 * organization.
 *
 * `name` is **unbranded**: free display text, with no second string it could
 * be confused with and no invariant riding on a brand. Branding it only made
 * every consumer of the public response mint a `DisplayName` to build one
 * (#73). `id` and `slug` keep their brands — mixing those up is a real bug.
 *
 * A plain, rootless entity: nothing else shares its fields, so there is nothing
 * for a root to hold.
 */
export class Organization extends Entity("Organization")(
  {
    id: Entity.field(OrganizationId, { generated: true, immutable: true }),
    slug: Entity.field(Slug, { immutable: true }),
    name: Entity.field(z.string().min(1), { unbranded: true }),
    createdAt: Entity.field(Instant, { generated: true, immutable: true }),
    riskTier: z.enum(["STANDARD", "WATCHLIST", "BLOCKED"]).optional(),
  },
  {
    computed: {
      displayLabel: Entity.computed(DisplayLabel, (d) => `${d.name} (${d.slug})`),
    },
    invariants: [
      Entity.invariant({
        code: "NAME_TOO_LONG",
        ensure: (d) => d.name.length <= 80,
        message: "name must be at most 80 characters",
      }),
    ],
  },
) {
  /** Behaviour goes in the class body — this is a real class. */
  get isSelfTitled(): boolean {
    return this.name.toLowerCase().startsWith(this.slug.toLowerCase());
  }
}
