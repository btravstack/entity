import { Entity } from "@btravstack/entity";

import { DisplayLabel, DisplayName, Instant, OrganizationId, Slug } from "./vocabulary.js";

/**
 * `Entity.field(schema, { generated, immutable })` flags the fields the
 * domain produces rather than the caller (`generated`, dropped from
 * `createInput`) and the ones `update` refuses (`immutable`). `computed` is
 * re-derived on every construction path, so it cannot drift from its sources.
 *
 * A plain, rootless entity: nothing else shares its fields, so there is nothing
 * for a root to hold.
 */
export class Organization extends Entity("Organization")(
  {
    id: Entity.field(OrganizationId, { generated: true, immutable: true }),
    slug: Entity.field(Slug, { immutable: true }),
    name: DisplayName,
    createdAt: Entity.field(Instant, { generated: true, immutable: true }),
  },
  {
    computed: {
      displayLabel: Entity.computed(DisplayLabel, (d) => `${d.name} (${d.slug})`),
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
