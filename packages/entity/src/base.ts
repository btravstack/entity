import type { ComputedField } from "./computed.js";
import type { Invariant } from "./invariant.js";
import type { OnlyNominal } from "./shape.js";
import type { AbstractEntity, Fields, InputOf, OutputOf } from "./types.js";

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
 * `extend` on a root: the same rebuild, plus the new base's prototype rewired
 * onto the receiver's.
 *
 * Chaining rather than copying descriptors, for three reasons: `personal
 * instanceof AccountBase` becomes true, so the root is a real runtime
 * supertype; a behaviour-only intermediate root is picked up without any
 * bookkeeping; and the entity's own `toJSON`/`equals`/`update` stay own
 * members of the child's prototype, so they shadow anything the root declares
 * under those names.
 */
const defineRootExtend = (Root: object, buildEntity: BuildEntity): void => {
  Object.defineProperty(Root, "extend", {
    enumerable: false,
    // `this`, not a `const receiver = this` alias: the returned arrow captures
    // the method's `this` lexically, so the alias only trips `no-this-alias`.
    value(this: { readonly prototype: object }, nextTag: string) {
      return (nextFields: Fields, nextOptions?: Record<string, unknown>) => {
        const child = rebuild(buildEntity, this, nextTag, nextFields, nextOptions);
        Object.setPrototypeOf(child.prototype, this.prototype);
        return child;
      };
    },
  });
};

/**
 * `Entity.abstract`, built against the entity builder rather than importing it,
 * so this module stays free of a cycle.
 */
export const createBase =
  (buildEntity: BuildEntity) =>
  <Name extends string>(name: Name) =>
  <
    S extends Fields,
    A extends Fields = Record<never, never>,
    const G extends readonly (keyof S)[] = [],
    const I extends readonly (keyof OutputOf<S, A>)[] = [],
  >(
    fields: S & OnlyNominal<S>,
    options?: {
      readonly generated?: G;
      readonly immutable?: I;
      readonly computed?: { [K in keyof A]: ComputedField<A[K], InputOf<S>> };
      readonly invariants?: readonly Invariant<InputOf<S>>[];
    },
  ): AbstractEntity<Name, S, A, G, I> => {
    class Root {
      static readonly entityName = name;
      constructor() {
        // A defect, not an `InvalidEntity`: a root is unreachable by
        // construction — a variant's instances belong to the fresh base
        // `extend` builds, not to this class — so reaching it is a bug in
        // domain code.
        // oxlint-disable-next-line unthrown/no-throw
        throw new Error(`${name}: an abstract root has no instances — extend it and use make()`);
      }
    }
    record(Root, fields as Fields, options as Record<string, unknown> | undefined);
    defineRootExtend(Root, buildEntity);
    return Root as unknown as AbstractEntity<Name, S, A, G, I>;
  };
