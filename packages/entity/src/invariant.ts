/**
 * One whole-entity rule: the predicate, and what to say when it fails.
 *
 * `describe` is always a function — `invariant` normalises a plain string into
 * one — so a rule has a single uniform shape and `construct` needs no branch.
 */
export type Invariant<D> = {
  readonly ensure: (d: D) => boolean;
  readonly describe: (d: D) => string;
};

/**
 * Declares one rule spanning the whole entity:
 *
 * ```ts
 * invariants: [
 *   invariant((d) => d.name.length <= 80, "name must be at most 80 characters"),
 *   invariant(
 *     (d) => d.endsAt > d.startsAt,
 *     (d) => `endsAt must be after ${d.startsAt}`,
 *   ),
 * ]
 * ```
 *
 * `ensure` returning **true** means valid — the rule reads as the assertion it
 * makes, not as the failure it detects. `D` is fixed by the expected element
 * type of the surrounding array, so `d` needs no annotation.
 *
 * `d` is the **declared** fields, not the output: a rule cannot read a computed
 * field. Every computed value is a function of the declared data, so any rule
 * about one is expressible over its sources, and a computed value that fails
 * its own schema is already a Defect rather than something to re-check here.
 * Typing `d` as the output would also make it unusable — `OutputOf<S, A>`
 * carries the deferred `ComputedOf<A>` conditional, and `A` is not yet resolved
 * when this array is checked, so `d` would degrade to a bag of `unknown`.
 *
 * `message` takes the data when the text depends on it. Every failing rule in
 * the list reports, not just the first, and none carries a `path`: an invariant
 * spans the entity, which is what distinguishes it from a field complaint.
 *
 * A predicate that throws is a Defect rather than an `InvalidEntity`, on the
 * same reasoning as `computed` — a rule is pure and total, so a violation is a
 * bug in domain code rather than bad caller input.
 */
export function invariant<D>(
  ensure: (d: D) => boolean,
  message: string | ((d: D) => string),
): Invariant<D> {
  return {
    ensure,
    describe: typeof message === "function" ? message : () => message,
  };
}
