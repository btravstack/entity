/**
 * Storing and rehydrating entities.
 *
 * `toJSON()` is the only projection the package offers, and it is exactly the
 * stored shape — `_tag` is a non-enumerable instance property, so it never
 * reaches a row, a `JSON.stringify`, or a spread. `make()` is the way back in,
 * and it validates, so a corrupt row is an `InvalidEntity` **value** rather
 * than an exception: this repository has nothing to `try`/`catch`.
 *
 * The store here is a `Map`. Swap it for a driver and nothing else moves —
 * that is the point of the entity knowing nothing about persistence.
 */
import type { Entity } from "@btravstack/entity";
import { Organization } from "@btravstack/entity-example-billing-domain";
import { Err, TaggedError, type Result } from "unthrown";

type OrganizationId = Organization["id"];
type Row = ReturnType<Organization["toJSON"]>;

/**
 * A missing row is not a *malformed* row, and collapsing the two would throw
 * away the distinction the caller needs: one is a 404, the other is corrupt
 * data worth paging someone about. The library deliberately defines no
 * `NotFound` — whether an absent row is exceptional is a repository's decision,
 * so it is modelled here.
 */
export class OrganizationNotFound extends TaggedError("OrganizationNotFound") {}

export type OrganizationRepository = {
  save(organization: Organization): void;
  byId(id: OrganizationId): Result<Organization, Entity.InvalidEntity | OrganizationNotFound>;
};

export class InMemoryOrganizationRepository implements OrganizationRepository {
  readonly #rows = new Map<string, unknown>();

  save(organization: Organization): void {
    // Exactly the stored shape. No mapper, no omit list, no `_tag`.
    this.#rows.set(organization.id, organization.toJSON());
  }

  byId(id: OrganizationId): Result<Organization, Entity.InvalidEntity | OrganizationNotFound> {
    const row = this.#rows.get(id);

    if (row === undefined) {
      return Err(new OrganizationNotFound());
    }

    // `make` validates on the way in, so whatever the store handed back is
    // checked before it becomes an entity — rows predate the current model.
    return Organization.make(row);
  }

  /** Test seam: what actually landed in the store. */
  rawRow(id: OrganizationId): Row | undefined {
    return this.#rows.get(id) as Row | undefined;
  }

  /** Test seam: a row that never came from a valid entity. */
  seedRaw(id: string, row: unknown): void {
    this.#rows.set(id, row);
  }
}
