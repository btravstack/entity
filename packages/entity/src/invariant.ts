/**
 * One whole-entity rule: its stable code, the predicate, and what to say when
 * it fails.
 *
 * `describe` is always a function — `invariant` normalises a plain string into
 * one — so a rule has a single uniform shape and `construct` needs no branch.
 */
export type Invariant<D> = {
  readonly code: string;
  readonly ensure: (d: D) => boolean;
  readonly describe: (d: D) => string;
};

/**
 * Declares one rule spanning the whole entity:
 *
 * ```ts
 * invariants: [
 *   invariant({
 *     code: "NAME_TOO_LONG",
 *     ensure: (d) => d.name.length <= 80,
 *     message: "name must be at most 80 characters",
 *   }),
 *   invariant({
 *     code: "ENDS_BEFORE_START",
 *     ensure: (d) => d.endsAt > d.startsAt,
 *     message: (d) => `endsAt must be after ${d.startsAt}`,
 *   }),
 * ]
 * ```
 *
 * `code` is the rule's stable identity, and it is required: a caller keys
 * behaviour off *which* rule failed — an HTTP error code, a field to
 * highlight, a localised string — and a rule without one is exactly the gap
 * that left adopters matching on message text (#70). The message may vary
 * with the data; the code must not. It rides on the issue as `params.code` —
 * zod's own slot for a custom issue's metadata, which zod carries through
 * nested entities, arrays and unions with the path prefixed — and
 * `Entity.codeOf(issue)` reads it back.
 *
 * One object rather than positional arguments, so each part is named at the
 * call site and a misspelled key is an excess-property error.
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
 * A predicate calling the entity's **own** statics needs an explicit return
 * annotation — `ensure: (d): boolean => Doc.isActive(d.tags)` — or the class
 * resolves inside its own base expression (TS2506). Same idiom as `computed`;
 * pinned in `computed.test-d.ts`.
 *
 * `message` takes the data when the text depends on it. Every failing rule in
 * the list reports, not just the first, and none carries a `path`: an invariant
 * spans the entity, which is what distinguishes it from a field complaint.
 *
 * A predicate that throws is a Defect rather than an `InvalidEntity`, on the
 * same reasoning as `computed` — a rule is pure and total, so a violation is a
 * bug in domain code rather than bad caller input.
 */
export function invariant<D>(rule: {
  readonly code: string;
  readonly ensure: (d: D) => boolean;
  readonly message: string | ((d: D) => string);
}): Invariant<D> {
  const { code, ensure, message } = rule;
  return { code, ensure, describe: typeof message === "function" ? message : () => message };
}
