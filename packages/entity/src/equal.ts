/**
 * Structural equality for stored entity data.
 *
 * This exists because `JSON.stringify(a) === JSON.stringify(b)` — the previous
 * implementation — is wrong in three measured ways for field types this package
 * accepts. `OnlyNominal` admits any branded schema, and `freeze.ts` explicitly
 * contemplates `Map`/`Set` fields, so none of these are exotic declarations:
 *
 * - A `z.bigint().brand(...)` field made `equals` **throw**
 *   `TypeError: Do not know how to serialize a BigInt`. `equals` returns a bare
 *   `boolean` with no Result channel, so that escaped as an uncaught exception.
 * - A `Set`, `Map` or typed-array field serialises to `{}`, so two entities
 *   with entirely different contents compared **equal** — a false positive on
 *   identity, the worst direction for an equality check.
 * - Only top-level key order is normalised, by `project`. A nested
 *   `z.record(...)` holding `{a,b}` versus `{b,a}` — identical contents —
 *   compared **unequal**, so a row read back with a different key order looked
 *   like a change.
 *
 * The traversal mirrors `freeze.ts`'s: the two walk the same shapes, and a
 * type handled there should be handled here.
 */

/** `Object.is`, but treating `+0` and `-0` as equal, per SameValueZero. */
const sameValueZero = (a: unknown, b: unknown): boolean =>
  a === b || (Number.isNaN(a) && Number.isNaN(b));

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

const tagOf = (value: object): string => Object.prototype.toString.call(value);

/**
 * Own enumerable string keys, which is exactly what `toJSON` projects and what
 * a class-body field would add. `_tag` is non-enumerable and so never compared,
 * which is why two entities of different types are ruled out by the
 * `instanceof` check in `equals` rather than by their tags.
 */
const keysOf = (value: object): readonly string[] => Object.keys(value);

/**
 * Set and Map hold their entries in an internal slot, so there is no key order
 * to normalise and no way to index into them. Matching each entry against an
 * unconsumed counterpart is quadratic, which is acceptable: these are domain
 * collections, and the alternative — hashing arbitrary deep values — would need
 * a canonical form this module deliberately does not define.
 */
/**
 * Pairs currently being compared further up the stack — a stack, not a memo.
 *
 * `deepFreeze` guards cycles with a `WeakSet` and its docstring names the
 * sources: "a `z.custom` field or a caller-supplied object can close a loop".
 * That applies here too, and more so now that a `z.custom` value is no longer
 * frozen — measured, an unguarded compare of two cyclic values died with
 * `RangeError: Maximum call stack size exceeded`, which is exactly the escaping
 * throw this module exists to remove.
 *
 * Keyed by the left value, holding the right ones it is currently being
 * compared against, so the guard is per *pair*: `a` may legitimately be
 * compared with several different values in one traversal.
 *
 * Assuming a revisited pair is equal is the standard co-inductive reading —
 * two structures are equal if assuming their cycles match leads to no
 * contradiction elsewhere. That reading is only sound for pairs whose
 * comparison is still *open*: a pair that already finished with `false` must be
 * forgotten on the way out. `unorderedEqual`'s failed candidate matches do not
 * abort the traversal, so a remembered failure would make a later genuine
 * comparison of the same pair short-circuit to `true` — measured, two `Set`
 * fields with plainly different contents compared equal once their elements
 * shared a subtree.
 */
type Seen = WeakMap<object, WeakSet<object>>;

const unorderedEqual = (
  left: readonly unknown[],
  right: readonly unknown[],
  equal: (a: unknown, b: unknown) => boolean,
): boolean => {
  if (left.length !== right.length) return false;
  const taken: boolean[] = Array.from({ length: right.length }, () => false);
  return left.every((l) =>
    right.some((r, i) => {
      if (taken[i] === true || !equal(l, r)) return false;
      taken[i] = true;
      return true;
    }),
  );
};

/**
 * Deep structural equality.
 *
 * Handles what an entity can actually store: primitives (including `bigint`,
 * and `NaN` as equal to itself), `Date` by timestamp, arrays elementwise,
 * `Set`/`Map` by contents rather than order, typed arrays and `ArrayBuffer`
 * bytewise, `RegExp` by source and flags, and plain objects and class instances
 * by their own enumerable keys, order-independently.
 *
 * Two values of different runtime kinds are never equal, so a `Map` never
 * compares equal to the plain object with the same entries.
 */
export const deepEqual = (a: unknown, b: unknown): boolean =>
  equalWith(a, b, new WeakMap<object, WeakSet<object>>());

const equalWith = (a: unknown, b: unknown, seen: Seen): boolean => {
  if (sameValueZero(a, b)) return true;
  if (!isObject(a) || !isObject(b)) return false;

  const tag = tagOf(a);
  if (tag !== tagOf(b)) return false;

  const against = seen.get(a) ?? new WeakSet<object>();
  if (against.has(b)) return true;
  if (!seen.has(a)) seen.set(a, against);
  against.add(b);

  const result = compareObjects(a, b, tag, seen);
  // the pair is only assumed-equal while its own comparison is open — see the
  // `Seen` docstring for why a completed `false` must not stay recorded
  if (!result) against.delete(b);
  return result;
};

const compareObjects = (a: object, b: object, tag: string, seen: Seen): boolean => {
  const deepEqual = (l: unknown, r: unknown): boolean => equalWith(l, r, seen);

  switch (tag) {
    case "[object Date]":
      return (a as Date).getTime() === (b as Date).getTime();
    case "[object RegExp]":
      return String(a) === String(b);
    case "[object Set]": {
      const left = [...(a as Set<unknown>)];
      const right = [...(b as Set<unknown>)];
      return unorderedEqual(left, right, deepEqual);
    }
    case "[object Map]": {
      const left = [...(a as Map<unknown, unknown>)];
      const right = [...(b as Map<unknown, unknown>)];
      return unorderedEqual(left, right, (l, r) => {
        const [lk, lv] = l as readonly [unknown, unknown];
        const [rk, rv] = r as readonly [unknown, unknown];
        return deepEqual(lk, rk) && deepEqual(lv, rv);
      });
    }
    case "[object ArrayBuffer]": {
      const left = new Uint8Array(a as ArrayBuffer);
      const right = new Uint8Array(b as ArrayBuffer);
      return left.length === right.length && left.every((byte, i) => byte === right[i]);
    }
    default:
      break;
  }

  if (ArrayBuffer.isView(a) && ArrayBuffer.isView(b)) {
    const left = new Uint8Array(a.buffer, a.byteOffset, a.byteLength);
    const right = new Uint8Array(b.buffer, b.byteOffset, b.byteLength);
    return left.length === right.length && left.every((byte, i) => byte === right[i]);
  }

  if (Array.isArray(a) || Array.isArray(b)) {
    if (!Array.isArray(a) || !Array.isArray(b) || a.length !== b.length) return false;
    return a.every((item, i) => deepEqual(item, b[i]));
  }

  const aKeys = keysOf(a);
  const bKeys = keysOf(b);
  if (aKeys.length !== bKeys.length) return false;
  const bRecord = b as Record<string, unknown>;
  const aRecord = a as Record<string, unknown>;
  return aKeys.every((key) => Object.hasOwn(bRecord, key) && deepEqual(aRecord[key], bRecord[key]));
};
