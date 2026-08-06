import type { OnlyNominal } from "./shape.js";
import type { ComputedOf, Fields } from "./types.js";

/** What `computed(fields, from)` produces: a field set and the function that fills it. */
export type ComputedSpec<A extends Fields, D> = {
  readonly fields: A;
  readonly from: (d: D) => ComputedOf<A>;
};

/**
 * Declares derived fields and how to produce them:
 *
 * ```ts
 * computed({ fullName: Full }, (d) => ({ fullName: `${d.first} ${d.last}` }))
 * ```
 *
 * `from` reads the *declared* fields and re-runs on every construction —
 * `decode`, `make` and `update` alike — so a derived value can never go stale
 * against the data it is derived from. That is what a getter would give you;
 * this carries a schema too, so the field reaches `decoded` and the JSON
 * Schema a getter cannot.
 *
 * `D` is fixed by the expected return type at the call site, which the options
 * object parameterises by the entity's declared shape.
 */
export function computed<A extends Fields, D>(
  fields: A & OnlyNominal<A>,
  from: (d: D) => ComputedOf<A>,
): ComputedSpec<A, D> {
  return { fields: fields as A, from };
}
