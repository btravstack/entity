import type { OnlyNominal } from "./shape.js";
import type { AddedOf, Fields } from "./types.js";

/** What `add(fields)(from)` produces: a field set and the function that fills it. */
export type AddSpec<A extends Fields, E> = {
  readonly fields: A;
  readonly from: (e: E) => AddedOf<A>;
};

/**
 * Declares computed fields and how to produce them, as one expression:
 *
 * ```ts
 * add({ fingerprint: Fingerprint })((e) => ({ fingerprint: fingerprintOf(e.secret) }))
 * ```
 *
 * `E` is free here and is fixed by the *expected return type* at the call
 * site, which the options object already parameterises by the entity's encoded
 * shape. That is what makes `e` contextually typed without a named base.
 */
export function add<A extends Fields>(fields: A & OnlyNominal<A>) {
  return <E>(from: (e: E) => AddedOf<A>): AddSpec<A, E> => ({ fields: fields as A, from });
}
