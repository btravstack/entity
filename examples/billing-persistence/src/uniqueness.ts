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
 * The constraint's violation is a *known* failure, so it is qualified at the
 * boundary into the same `SlugTaken` the precondition returns. Every other
 * rejection from the store is infrastructure failing and stays a Defect.
 *
 * See also the how-to: <https://btravstack.github.io/entity/how-to/enforce-uniqueness>.
 */
import type { Entity } from "@btravstack/entity";
import { createOrganization, type Organization } from "@btravstack/entity-example-billing-domain";
import { fromPromise, fromSafePromise, TaggedError, type AsyncResult } from "unthrown";

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
 * What a driver rejects with when a write hits a unique index — Postgres
 * reports SQLSTATE `23505` plus the constraint's name. Matching on the name,
 * not just the code, keeps a violation of some *other* index out of
 * `SlugTaken`.
 */
export class UniqueViolation extends Error {
  readonly constraint: string;

  constructor(constraint: string) {
    super(`duplicate key value violates unique constraint "${constraint}"`);
    this.constraint = constraint;
  }
}

/** The port. Both methods are plain promises, the way a driver hands them over. */
export type OrganizationStore = {
  slugIsTaken(slug: SlugValue): Promise<boolean>;
  /** Rejects with `UniqueViolation` when the slug is already stored. */
  insert(organization: Organization): Promise<void>;
};

/**
 * Stands in for a table with `unique (slug)`. The check and the write sit in
 * one synchronous block, so nothing can interleave between them — the same
 * atomicity a database unique index provides, and the reason the constraint
 * holds where the preflight lookup does not.
 */
export class InMemoryOrganizationStore implements OrganizationStore {
  readonly #bySlug = new Map<string, unknown>();

  slugIsTaken(slug: SlugValue): Promise<boolean> {
    return Promise.resolve(this.#bySlug.has(slug));
  }

  insert(organization: Organization): Promise<void> {
    if (this.#bySlug.has(organization.slug)) {
      return Promise.reject(new UniqueViolation(SLUG_UNIQUE));
    }
    this.#bySlug.set(organization.slug, organization.toJSON());
    return Promise.resolve();
  }
}

/**
 * Check, then create — with the check demoted to what it actually is.
 *
 * 1. Construction runs the state invariants. Synchronous, no store involved.
 * 2. The preflight lookup turns the common case into a clear error before any
 *    write. A store that cannot answer is a Defect.
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
        fromSafePromise(store.slugIsTaken(organization.slug))
          .ensure(
            (taken) => !taken,
            () => new SlugTaken({ slug: organization.slug }),
          )
          .map(() => organization),
      )
      .flatMap((organization) =>
        fromPromise(store.insert(organization), (cause, defect) =>
          cause instanceof UniqueViolation && cause.constraint === SLUG_UNIQUE
            ? new SlugTaken({ slug: organization.slug })
            : defect(cause),
        ).map(() => organization),
      );
