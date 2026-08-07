import { P, type Result } from "unthrown";
import { z } from "zod";

import type { InvalidEntity } from "./errors.js";
import { keysOf } from "./issues.js";

/**
 * The composable surface: input data parsed into a class instance.
 *
 * Failures cross into zod's issue channel so a nested entity reports which
 * member failed — `z.object({ owner: Organization.instance })` yields
 * `path: ["owner"]`. This schema carries a transform, so
 * `z.toJSONSchema(..., { io: "output" })` throws on it by design; contracts
 * use the four plain `ZodObject` members instead.
 *
 * A `Defect` is never folded into a validation issue: `recoverErrCases`
 * recovers only the modelled `InvalidEntity` channel (adding one zod issue
 * per invariant message and yielding `z.NEVER`), which empties the error
 * channel and leaves an unrecovered `Defect` as the only way `.get()` can
 * still fail — at which point it panics (rethrows the original cause)
 * instead of reporting an ordinary issue. An unexpected bug in `make`
 * must stay distinguishable from bad caller input, not surface as one.
 */
function instanceSchema<T>(
  input: z.ZodType,
  makeFrom: (d: unknown) => Result<T, InvalidEntity>,
): z.ZodType<T> {
  return input.transform((d, ctx) =>
    makeFrom(d)
      .recoverErrCases((m) =>
        m.with(P.tag("InvalidEntity"), (invalid) => {
          for (const issue of invalid.issues) {
            // zod prefixes this schema's position, so forwarding the issue's
            // own path yields the full `["owner", "secret"]`.
            ctx.addIssue({ code: "custom", message: issue.message, path: keysOf(issue) });
          }
          return z.NEVER;
        }),
      )
      .get(),
  ) as unknown as z.ZodType<T>;
}

/**
 * Makes the entity class itself a zod schema.
 *
 * `_zod` is the slot zod reads a schema through, and `~standard` is the
 * Standard Schema entry point; delegating both to a lazily built transform
 * schema is enough for `z.object({ owner: Organization })`, `z.array(...)`
 * and an entity field map to accept the class directly. Deliberately *only*
 * these two: the full `ZodType` surface would put a throwing `.parse()` on
 * every entity beside `make`, which this package exists to avoid.
 *
 * The class is only ever consumed through a subclass (`class X extends
 * Entity(tag)(fields) {}`), which does not exist yet when the entity builder
 * runs. A plain value would close over the literal base constructor, so
 * parsing would build a base instance — not an `X` — failing `instanceof X`.
 * A getter instead reads `this` from the access site, which JS's
 * prototype-based static inheritance sets to the actual receiver, so it binds
 * to whichever subclass it was read from — but a bare getter would rebuild the
 * schema on every access, so every parse would reconstruct the whole transform
 * chain. The schema is therefore memoised per receiver in a `WeakMap`.
 *
 */
const schemas = new WeakMap<object, z.ZodType>();

export function attachSchema<T>(Base: object, input: z.ZodType): void {
  const schemaFor = (receiver: object): z.ZodType => {
    const cached = schemas.get(receiver);
    if (cached !== undefined) return cached;
    const built = instanceSchema<T>(input, (d) =>
      (receiver as unknown as { make: (state: unknown) => Result<T, InvalidEntity> }).make(d),
    );
    schemas.set(receiver, built);
    return built;
  };

  for (const slot of ["_zod", "~standard"] as const) {
    Object.defineProperty(Base, slot, {
      configurable: true,
      enumerable: false,
      get(this: object) {
        return (schemaFor(this) as unknown as Record<string, unknown>)[slot];
      },
    });
  }
}
