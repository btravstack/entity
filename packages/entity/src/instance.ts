import { P, type Result } from "unthrown";
import { z } from "zod";

import type { InvalidEntity } from "./errors.js";
import { keysOf } from "./issues.js";

/**
 * The composable surface: encoded input decoded to a class instance.
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
 * instead of reporting an ordinary issue. An unexpected bug in `decode`
 * must stay distinguishable from bad caller input, not surface as one.
 */
function instanceSchema<T>(
  encoded: z.ZodType,
  decodeFrom: (d: unknown) => Result<T, InvalidEntity>,
): z.ZodType<T> {
  return encoded.transform((d, ctx) =>
    decodeFrom(d)
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
 * Attaches `instance` and `~standard` to an entity class as lazily
 * computed, self-overwriting accessor properties.
 *
 * The class is only ever consumed through a subclass (`class X extends
 * Entity(tag)(fields) {}`), which does not exist yet when the entity builder
 * runs. A plain value would close over the literal base constructor, so
 * `X.instance.parse(...)` would build a base instance — not an `X` —
 * failing `instanceof X`. A getter instead reads `this` from the access
 * site (`X.instance`), which JS's prototype-based static inheritance sets
 * to the actual receiver, so it binds to whichever subclass it was read
 * from — but a bare getter would rebuild the schema (and its `~standard`)
 * on every access, so `X.instance !== X.instance` and every `validate()`
 * call would reconstruct the whole transform chain. Each getter therefore
 * overwrites itself with a plain, non-enumerable data property on the same
 * receiver the first time it runs, so later reads are free and identity is
 * stable.
 *
 * Caveat: the self-overwrite is first-read-wins *per receiver*, not per
 * class. `attachInstance` runs once per `Entity(...)` call, so every entity
 * built that way defines its own getter and is unaffected. But a bare `class
 * Y extends X {}` — a plain JS subclass with no `Entity(...)` call of its
 * own — has no getter of its own; it inherits `X`'s. If `X.instance` is read
 * first, the getter on `X` is replaced by `X`'s own data property before `Y`
 * ever reads it, and `Y.instance` then resolves to that inherited property:
 * `Y.instance.parse(...)` silently builds an `X`, not a `Y`, with no error.
 */
export function attachInstance<T>(Base: object, encoded: z.ZodType): void {
  Object.defineProperty(Base, "instance", {
    configurable: true,
    enumerable: false,
    get(this: object) {
      const built = instanceSchema<T>(encoded, (d) =>
        (this as unknown as { decode: (raw: unknown) => Result<T, InvalidEntity> }).decode(d),
      );
      Object.defineProperty(this, "instance", { value: built, enumerable: false });
      return built;
    },
  });
  Object.defineProperty(Base, "~standard", {
    configurable: true,
    enumerable: false,
    get(this: { instance: z.ZodType<T> }) {
      const standard = (this.instance as unknown as { "~standard": unknown })["~standard"];
      Object.defineProperty(this, "~standard", { value: standard, enumerable: false });
      return standard;
    },
  });
}
