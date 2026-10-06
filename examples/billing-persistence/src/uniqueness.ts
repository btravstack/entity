/**
 * Uniqueness, which no invariant can express.
 *
 * "This slug is not taken" is a fact about every *other* organization, so it
 * cannot live in `invariants`: those are synchronous predicates over the
 * entity's own fields, and that is what keeps construction free of I/O. Three
 * different rules are in play when an organization is registered, and each
 * belongs to a different layer:
 *
 * - **State invariant** — a closed-world fact about the entity's own data (a
 *   name at most 80 characters long). Declared on `Organization`, checked on
 *   every construction path, never needs a store.
 * - **Command precondition** — an open-world check the use case runs before it
 *   writes (no organization has this slug yet). Good for feedback, worthless as
 *   a guarantee: two requests can both pass it.
 * - **Database constraint** — the unique index on `slug`. The only one of the
 *   three that holds under concurrency, because the store checks and writes in
 *   one atomic step.
 *
 * The store's port speaks unthrown: a driver rejection is triaged once, at the
 * adapter's `fromPromise` boundary, into a modeled `UniqueViolation` or a
 * Defect. The use case then maps a violation of *this* index into the same
 * `SlugTaken` the precondition returns; anything else stays a Defect.
 *
 * See also the how-to: <https://btravstack.github.io/entity/how-to/enforce-uniqueness>.
 */
import type { Entity } from "@btravstack/entity";
import { createOrganization, type Organization } from "@btravstack/entity-example-billing-domain";
import { ErrAsync, OkAsync, P, TaggedError, type AsyncResult } from "unthrown";

type SlugValue = Organization["slug"];

/**
 * The stable application error. It is not an `InvalidEntity`: the organization
 * is perfectly valid, it just lost a race for a name. Whichever layer caught
 * the conflict, the caller sees this one error.
 */
export class SlugTaken extends TaggedError("SlugTaken")<{ slug: SlugValue }> {
  override message = `slug "${this.slug}" is already taken`;
}

/** The name of the unique index, as a driver reports it on a violation. */
export const SLUG_UNIQUE = "organization_slug_key";

/**
 * A write hit a unique index — what a Postgres adapter qualifies SQLSTATE
 * `23505` into, carrying the constraint's name. Keeping the name lets the use
 * case keep a violation of some *other* index out of `SlugTaken`.
 */
export class UniqueViolation extends TaggedError("UniqueViolation")<{ constraint: string }> {
  override message = `duplicate key value violates unique constraint "${this.constraint}"`;
}

/**
 * The port. A real adapter wraps its driver calls in `fromPromise`, qualifying
 * a unique violation into `UniqueViolation` and everything else into a Defect,
 * so no rejection crosses into the use case.
 */
export type OrganizationStore = {
  slugIsTaken(slug: SlugValue): AsyncResult<boolean, never>;
  insert(organization: Organization): AsyncResult<void, UniqueViolation>;
};

/**
 * Stands in for a table with `unique (slug)`. The check and the write sit in
 * one synchronous block, so nothing can interleave between them — the same
 * atomicity a database unique index provides, and the reason the constraint
 * holds where the preflight lookup does not.
 */
export class InMemoryOrganizationStore implements OrganizationStore {
  readonly #bySlug = new Map<string, unknown>();

  slugIsTaken(slug: SlugValue): AsyncResult<boolean, never> {
    return OkAsync(this.#bySlug.has(slug));
  }

  insert(organization: Organization): AsyncResult<void, UniqueViolation> {
    if (this.#bySlug.has(organization.slug)) {
      return ErrAsync(new UniqueViolation({ constraint: SLUG_UNIQUE }));
    }
    this.#bySlug.set(organization.slug, organization.toJSON());
    return OkAsync();
  }
}

/**
 * Check, then create — with the check demoted to what it actually is.
 *
 * 1. Construction runs the state invariants. Synchronous, no store involved.
 * 2. The preflight lookup turns the common case into a clear error before any
 *    write. A store that cannot answer has already become a Defect.
 * 3. The insert is the authority. A violation of *this* index is `SlugTaken`;
 *    anything else the store rejects with is a Defect.
 */
export const registerOrganization =
  (store: OrganizationStore) =>
  (
    input: Entity.CreateInput<typeof Organization>,
  ): AsyncResult<Organization, Entity.InvalidEntity | SlugTaken> =>
    createOrganization(input)
      .toAsync()
      .flatMap((organization) =>
        store
          .slugIsTaken(organization.slug)
          .ensure(
            (taken) => !taken,
            () => new SlugTaken({ slug: organization.slug }),
          )
          .map(() => organization),
      )
      .flatMap((organization) =>
        store
          .insert(organization)
          .mapErrCases((m, defect) =>
            m.with(P.tag("UniqueViolation"), (violation) =>
              violation.constraint === SLUG_UNIQUE
                ? new SlugTaken({ slug: organization.slug })
                : defect(violation),
            ),
          )
          .map(() => organization),
      );
