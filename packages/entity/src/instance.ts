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
 * The one schema each class gets, keyed by the class that asked for it.
 * Keys are constructors, so a discarded class stays collectable.
 */
const schemas = new WeakMap<object, z.ZodType>();

/**
 * Attaches `instance` and `~standard` to an entity class as lazily computed
 * accessor properties, memoised per receiver.
 *
 * The class is only ever consumed through a subclass (`class X extends
 * Entity(tag)(fields) {}`), which does not exist yet when the entity builder
 * runs. A plain value would close over the literal base constructor, so
 * `X.instance.parse(...)` would build a base instance — not an `X` — failing
 * `instanceof X`. A getter instead reads `this` from the access site
 * (`X.instance`), which JS's prototype-based static inheritance sets to the
 * actual receiver, so it binds to whichever subclass it was read from. That
 * receiver-reading is the whole point of the accessor and is why it cannot
 * be replaced by a value.
 *
 * A bare getter would rebuild the schema (and its `~standard`) on every
 * access, so `X.instance !== X.instance` and every `validate()` call would
 * reconstruct the whole transform chain. The obvious cure — letting each
 * getter overwrite itself with a plain data property on the receiver — was
 * tried and abandoned, because a data property defined on `X` is *inherited*
 * by every `class Y extends X {}` that has no `Entity(...)` call of its own.
 * Reading `X.instance` first replaced the getter before `Y` ever saw it, and
 * `Y.instance` then resolved to `X`'s property: `Y.instance.parse(...)`
 * silently built an `X`, not a `Y`, with no error. Read order must not
 * decide which class comes out.
 *
 * So the accessor stays in place permanently and the built schema is cached
 * against the receiver in `schemas` instead. Every read re-enters the getter
 * with `this` bound to the class actually read, and gets that class's own
 * entry: `X.instance === X.instance` (built once, stable identity),
 * `Y.instance !== X.instance`, and `Y.instance.parse(...)` yields a `Y`
 * whichever of the two was read first.
 *
 * `~standard` reads through `this.instance` rather than caching separately,
 * so the two can never disagree about which class they decode to; zod hangs
 * `~standard` off the schema at construction, so a memoised `instance` makes
 * it stable for free. Both properties stay non-enumerable — absent from
 * `Object.keys`, spread and `JSON.stringify` — and configurable, so a
 * consumer can still redefine them on a class of their own.
 */
export function attachInstance<T>(Base: object, encoded: z.ZodType): void {
  Object.defineProperty(Base, "instance", {
    configurable: true,
    enumerable: false,
    get(this: object) {
      const cached = schemas.get(this);
      if (cached !== undefined) return cached;
      const built = instanceSchema<T>(encoded, (d) =>
        (this as unknown as { decode: (raw: unknown) => Result<T, InvalidEntity> }).decode(d),
      );
      schemas.set(this, built);
      return built;
    },
  });
  Object.defineProperty(Base, "~standard", {
    configurable: true,
    enumerable: false,
    get(this: { instance: z.ZodType<T> }) {
      return (this.instance as unknown as { "~standard": unknown })["~standard"];
    },
  });
}
