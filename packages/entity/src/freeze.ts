/**
 * The runtime half of deep immutability.
 *
 * The entity constructor installs each data field with
 * `Object.defineProperty(…, { writable: false })`, which locks the *binding*
 * and nothing else: `org.tags = []` throws, but `org.tags.push(…)` succeeds,
 * shows up in `toJSON()`, and can push an entity into a state its own
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
 *   `docs/explanation.md` says so.
 */

const isObject = (value: unknown): value is object => typeof value === "object" && value !== null;

/** Plain data, as opposed to an instance of some class with behaviour. */
const isPlainObject = (value: object): boolean => {
  const proto: unknown = Object.getPrototypeOf(value);
  return proto === Object.prototype || proto === null;
};

type Def = { readonly type: string } & Record<string, unknown>;
type Schema = { readonly _zod: { readonly def: Def } };

const defOf = (schema: Schema | undefined): Def | undefined => schema?._zod.def;

const asSchema = (value: unknown): Schema | undefined =>
  typeof value === "object" && value !== null && "_zod" in value ? (value as Schema) : undefined;

/**
 * Follows the single-child wrappers to the schema that actually describes the
 * value. `.brand()` needs no case: it is type-level in zod v4 and adds no
 * wrapper, so a branded `z.custom` still reports `custom`.
 */
const unwrap = (schema: Schema | undefined): Schema | undefined => {
  const def = defOf(schema);
  if (def === undefined) return schema;
  switch (def.type) {
    case "optional":
    case "nullable":
    case "default":
    case "prefault":
    case "readonly":
    case "nonoptional":
    case "catch":
      return unwrap(asSchema(def["innerType"]));
    case "lazy": {
      const getter = def["getter"];
      return typeof getter === "function" ? unwrap(asSchema((getter as () => unknown)())) : schema;
    }
    // the value being frozen is what parsing *produced*, and a pipe's output
    // is described by its out side
    case "pipe":
      return unwrap(asSchema(def["out"]));
    default:
      return schema;
  }
};

/**
 * Whether a value described by this schema was handed through untouched, and so
 * may still be referenced by the caller who passed it in.
 *
 * A union counts if **any** branch is `custom`: the schema cannot say which
 * branch produced this value, and freezing an object the caller still owns is
 * the worse of the two errors.
 */
const isPassthrough = (schema: Schema | undefined): boolean => {
  const def = defOf(unwrap(schema));
  if (def === undefined) return false;
  if (def.type === "custom") return true;
  if (def.type === "union") {
    const options = def["options"];
    return Array.isArray(options) && options.some((o) => isPassthrough(asSchema(o)));
  }
  // an intersection's value satisfied both sides, so if either side hands the
  // caller's reference through, the value may still be caller-owned
  if (def.type === "intersection") {
    return isPassthrough(asSchema(def["left"])) || isPassthrough(asSchema(def["right"]));
  }
  return false;
};

/**
 * One schema context standing for several candidates, for the positions where
 * the walk cannot know which branch produced the value. A synthetic `union`
 * def, so `isPassthrough` treats it as passthrough when *any* candidate is —
 * freezing an object the caller still owns is the worse of the two errors, and
 * ambiguity resolves toward skipping.
 */
const anyOf = (candidates: readonly (Schema | undefined)[]): Schema | undefined => {
  const children = candidates.filter((c): c is Schema => c !== undefined);
  if (children.length === 0) return undefined;
  if (children.length === 1) return children[0];
  return { _zod: { def: { type: "union", options: children } } };
};

/**
 * The schema describing `value[key]`, or `undefined` when the shape is one this
 * cannot follow. `undefined` means "no schema context", and the traversal then
 * freezes as it always did — safe only because every container a passthrough
 * value can legally sit under has a case here; an unhandled *leaf* is a missed
 * skip rather than a crash.
 */
const childSchema = (schema: Schema | undefined, key: string | number): Schema | undefined => {
  const def = defOf(unwrap(schema));
  if (def === undefined) return undefined;
  switch (def.type) {
    case "object":
    case "interface": {
      const shape = def["shape"];
      return typeof shape === "object" && shape !== null
        ? asSchema((shape as Record<string, unknown>)[String(key)])
        : undefined;
    }
    case "array":
      return asSchema(def["element"]);
    case "record":
      return asSchema(def["valueType"]);
    case "tuple": {
      const items = def["items"];
      const item = Array.isArray(items) ? items[Number(key)] : undefined;
      return asSchema(item ?? def["rest"]);
    }
    // the walk cannot know which branch produced the value, so the child
    // context is "any of these" — see `anyOf`
    case "union": {
      const options = def["options"];
      return Array.isArray(options)
        ? anyOf(options.map((o) => childSchema(asSchema(o), key)))
        : undefined;
    }
    case "intersection":
      return anyOf([
        childSchema(asSchema(def["left"]), key),
        childSchema(asSchema(def["right"]), key),
      ]);
    default:
      return undefined;
  }
};

const freezeInto = (value: object, schema: Schema | undefined, seen: WeakSet<object>): void => {
  // Decided by the schema, never by the runtime shape: `z.custom` hands the
  // caller's own reference straight back, and a plain-object one is
  // indistinguishable from decoded data once it reaches here.
  if (isPassthrough(schema)) return;

  // `seen` guards the cyclic case — entity data is normally a tree, but a
  // `z.custom` field or a caller-supplied object can close a loop, and a
  // shared subtree would otherwise be walked once per reference.
  if (seen.has(value)) return;
  seen.add(value);

  if (Array.isArray(value)) {
    Object.freeze(value);
    (value as readonly unknown[]).forEach((element, i) => {
      if (isObject(element)) freezeInto(element, childSchema(schema, i), seen);
    });
    return;
  }

  if (value instanceof Date) {
    Object.freeze(value);
    return;
  }

  if (!isPlainObject(value)) return;

  Object.freeze(value);
  for (const [key, property] of Object.entries(value)) {
    if (isObject(property)) freezeInto(property, childSchema(schema, key), seen);
  }
};

/**
 * Freezes `value` in place and returns it, so it can wrap the expression it
 * guards. A primitive — which is every branded scalar field — costs one
 * `typeof` and allocates nothing.
 *
 * `seen` is optional so a single call site stays a one-liner, but the entity
 * constructor passes one `WeakSet` across every field of the instance it is
 * building. That is not only about allocation: two fields can reference the
 * same object (zod hands back whatever the payload held, so a shared subtree
 * survives decoding), and a per-field set would walk that subtree once per
 * field that reaches it. Sharing the set makes the whole instance one
 * traversal. It is allocated lazily rather than as a default parameter,
 * because a default is evaluated before the `isObject` guard and would
 * allocate for every primitive field.
 *
 * `schema` is what lets the walk skip a passed-through value at any depth, not
 * only when it is the whole field. Omit it and the traversal freezes exactly as
 * it did before — which is what the standalone tests below rely on. It sits
 * *after* `seen` deliberately: typed `unknown`, it would otherwise silently
 * swallow a `seen` argument passed in the old position.
 */
export const deepFreeze = <T>(value: T, seen?: WeakSet<object>, schema?: unknown): T => {
  if (isObject(value)) freezeInto(value, asSchema(schema), seen ?? new WeakSet<object>());
  return value;
};
