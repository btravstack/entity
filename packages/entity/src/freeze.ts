/**
 * The runtime half of deep immutability.
 *
 * The entity constructor installs each data field with
 * `Object.defineProperty(…, { writable: false })`, which locks the *binding*
 * and nothing else: `org.tags = []` throws, but `org.tags.push(…)` succeeds,
 * shows up in `encode()`, and can push an entity into a state its own
 * `invariants` already rejected. Freezing the values as they are installed is
 * what makes "a rule that holds at construction holds for the instance's
 * lifetime" true rather than aspirational.
 *
 * What gets frozen is deliberately narrow:
 *
 * - **Arrays and plain objects** (prototype `Object.prototype` or `null`) are
 *   frozen *and* recursed into. This is the whole of the JSON-shaped data zod
 *   produces for `z.array`, `z.object`, `z.record` and `z.tuple` — i.e. every
 *   field an entity can normally hold — and `Object.freeze` genuinely stops
 *   writes to it.
 * - **`Date`** is frozen but not recursed into. It is safe: a `Date` has no
 *   own enumerable properties and its timestamp lives in an internal slot, so
 *   nothing that exists as a property is being taken away. It is also only
 *   partial — a frozen `Date` still accepts `setTime` — so freezing it buys
 *   only the guarantee that properties cannot be bolted onto stored data.
 * - **Everything else is left alone**: `Map`, `Set`, typed arrays, and
 *   whatever a `z.custom(...)`/`z.instanceof(...)` field hands straight
 *   through. Freezing those is at best theatre (a frozen `Map` still accepts
 *   `.set`, for the same internal-slot reason) and at worst destructive (a
 *   class instance that memoises into an own field stops working, and the
 *   value may still be referenced by the caller who passed it in). A field
 *   whose schema yields a live mutable object is outside this guarantee, and
 *   the README says so.
 */

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

/** Plain data, as opposed to an instance of some class with behaviour. */
const isPlainObject = (value: object): boolean => {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

const freezeInto = (value: object, seen: WeakSet<object>): void => {
  // `seen` guards the cyclic case — decoded data is normally a tree, but a
  // `z.custom` field or a caller-supplied object can close a loop, and a
  // shared subtree would otherwise be walked once per reference.
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    Object.freeze(value);
    for (const element of value as readonly unknown[]) {
      if (isObject(element)) freezeInto(element, seen);
    }
    return;
  }

  if (value instanceof Date) {
    Object.freeze(value);
    return;
  }

  if (!isPlainObject(value)) return;

  Object.freeze(value);
  for (const property of Object.values(value)) {
    if (isObject(property)) freezeInto(property, seen);
  }
};

/**
 * Freezes `value` in place and returns it, so it can wrap the expression it
 * guards. A primitive — which is every branded scalar field — costs one
 * `typeof` and allocates nothing.
 */
export const deepFreeze = <T>(value: T): T => {
  if (isObject(value)) freezeInto(value, new WeakSet<object>());
  return value;
};
