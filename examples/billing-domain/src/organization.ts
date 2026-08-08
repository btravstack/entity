import { Entity } from "@btravstack/entity";
import type { z } from "zod";

import { DisplayLabel, DisplayName, Instant, OrganizationId, Slug } from "./vocabulary.js";

/**
 * `generated` names the fields the domain produces rather than the caller, so
 * they drop out of `createInput`. `immutable` names the ones `update` refuses.
 * `computed` is re-derived on every construction path, so it cannot drift from
 * its sources.
 *
 * A plain, rootless entity: nothing else shares its fields, so there is nothing
 * for a root to hold.
 */
export class Organization extends Entity("Organization")(
  { id: OrganizationId, slug: Slug, name: DisplayName, createdAt: Instant },
  {
    generated: ["id", "createdAt"],
    immutable: ["id", "createdAt", "slug"],
    computed: {
      displayLabel: Entity.computed(
        DisplayLabel,
        (d) => `${d.name} (${d.slug})` as z.infer<typeof DisplayLabel>,
      ),
    },
    invariants: [
      Entity.invariant((d) => d.name.length <= 80, "name must be at most 80 characters"),
    ],
  },
) {
  /** Behaviour goes in the class body — this is a real class. */
  get isSelfTitled(): boolean {
    return this.name.toLowerCase().startsWith(this.slug.toLowerCase());
  }
}
