import type { z } from "zod";

import type { OnlyNominal } from "./shape.js";

/** One derived field: its schema, and the function that produces it. */
export type ComputedField<T extends z.core.$ZodType, D> = {
  readonly schema: T;
  readonly from: (d: D) => z.infer<T>;
};

/**
 * Declares one derived field:
 *
 * ```ts
 * computed: {
 *   fullName: computed(FullName, (d) => `${d.first} ${d.last}`),
 *   initials: computed(Initials, (d) => `${d.first[0]}${d.last[0]}`),
 * }
 * ```
 *
 * `from` reads the declared fields and re-runs on every construction, so a
 * derived value cannot go stale against its sources. `D` is fixed by the
 * expected type at the call site, so `d` needs no annotation, and the return
 * type is checked against *this* field's schema — a wrong brand reports on the
 * field that produced it rather than on the whole map.
 */
export function computed<T extends z.core.$ZodType, D>(
  schema: T & OnlyNominal<{ value: T }>["value"],
  from: (d: D) => z.infer<T>,
): ComputedField<T, D> {
  return { schema: schema as T, from };
}
