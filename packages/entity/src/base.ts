import type { Invariant } from "./invariant.js";
import type { Fields } from "./types.js";

/** The entity builder, loosened. Passed in so this module never imports it. */
export type BuildEntity = (
  tag: string,
) => (fields: Fields, options?: unknown) => { prototype: object };

/**
 * What each declaration was made with, so `extend` can rebuild from it. Keyed
 * by the class rather than stored on it, so nothing leaks onto the public
 * surface or into a consumer's declarations.
 */
const declarations = new WeakMap<
  object,
  { readonly fields: Fields; readonly options: Record<string, unknown> | undefined }
>();

export const record = (
  target: object,
  fields: Fields,
  options: Record<string, unknown> | undefined,
): void => {
  declarations.set(target, { fields, options });
};

/**
 * The nearest declaration up the receiver's *static* chain.
 *
 * Walked rather than read directly, because an abstract root is extended
 * through the user's own subclass — `AccountBase.extend(...)` has `this` set to
 * a class the record was never keyed by.
 */
const declarationOf = (receiver: object) => {
  let ctor: object | null = receiver;
  while (ctor !== null) {
    const found = declarations.get(ctor);
    if (found !== undefined) return found;
    ctor = Object.getPrototypeOf(ctor) as object | null;
  }
  return undefined;
};

/**
 * Options merge per key, child winning — except `invariants`, which
 * **concatenates** parent-then-child. Inheriting matters more than it might
 * look: silently dropping the parent's `immutable` or `invariants` would leave
 * the extension quietly laxer than what it extends. An extension can add rules;
 * it cannot shed them.
 */
const rebuild = (
  buildEntity: BuildEntity,
  receiver: object,
  nextTag: string,
  nextFields: Fields,
  nextOptions: Record<string, unknown> | undefined,
): { prototype: object } => {
  const parent = declarationOf(receiver);
  const parentOptions = parent?.options as
    | { readonly invariants?: readonly Invariant<unknown>[] }
    | undefined;
  const childInvariants = (
    nextOptions as { readonly invariants?: readonly Invariant<unknown>[] } | undefined
  )?.invariants;
  const invariants = [...(parentOptions?.invariants ?? []), ...(childInvariants ?? [])];
  return buildEntity(nextTag)(
    { ...parent?.fields, ...nextFields },
    {
      ...parent?.options,
      ...nextOptions,
      ...(invariants.length > 0 ? { invariants } : {}),
    },
  );
};

/**
 * A *new* entity carrying this one's fields plus more, under its own tag.
 *
 * Not subclassing, which stays forbidden: the result is its own `Entity(...)`
 * call, so it has a distinct tag, a distinct identity under `equals`, and its
 * own schemas.
 */
export const defineExtend = (target: object, buildEntity: BuildEntity): void => {
  Object.defineProperty(target, "extend", {
    enumerable: false,
    value: (nextTag: string) => (nextFields: Fields, nextOptions?: Record<string, unknown>) =>
      rebuild(buildEntity, target, nextTag, nextFields, nextOptions),
  });
};
