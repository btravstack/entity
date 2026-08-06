import { fromSchema, type SchemaIssues } from "@unthrown/standard-schema";
import { Err, Ok, P, type Result } from "unthrown";
import type { z } from "zod";

import type { AddSpec } from "./add.js";
import { InvalidEntity } from "./errors.js";
import { deepFreeze } from "./freeze.js";
import { attachInstance } from "./instance.js";
import { shape, type OnlyNominal } from "./shape.js";
import type {
  AddedOf,
  CreateInputOf,
  DecodedOf,
  DeepReadonly,
  EncodedOf,
  EntityStatic,
  Fields,
  GeneratedOf,
  PatchOf,
  Sealed,
  UpdateInputShapeOf,
} from "./types.js";

const maskOf = (keys: readonly PropertyKey[]) =>
  Object.fromEntries(keys.map((k) => [k, true as const]));

type IssuePath = NonNullable<SchemaIssues[number]["path"]>;

/**
 * A path segment is either a bare `PropertyKey` or a `{ key }` wrapper —
 * Standard Schema permits both, and zod v4 emits the bare form. `typeof`
 * separates them without a property probe: only the wrapper is an object.
 */
const keyOf = (segment: IssuePath[number]): PropertyKey =>
  typeof segment === "object" ? segment.key : segment;

/**
 * Renders a schema issue as `"<path>: <message>"`, so a caller can tell which
 * field failed: `"secret: Too small: …"`, `"tags.0: …"` for an array element,
 * `"nested.deep: …"` for a nested object. An empty path — a whole-object
 * issue, which is what zod reports for `path: []` on e.g. a non-object input
 * — stays unprefixed rather than growing a meaningless `": "`.
 *
 * The path goes *into the string* instead of alongside it: `issues` stays a
 * `readonly string[]`, so nothing about `InvalidEntity` breaks and there is
 * still one representation of an issue rather than two parallel ones. The
 * separator is `": "`, so splitting on the first occurrence recovers the
 * path when a caller wants to key a field-level error response by it.
 *
 * Only schema issues pass through here. `invariants` messages are already
 * plain domain sentences about the whole entity, and `construct` puts them on
 * `InvalidEntity` untouched.
 */
const describeIssue = (issue: SchemaIssues[number]): string => {
  const path = issue.path ?? [];
  return path.length === 0
    ? issue.message
    : `${path.map((s) => String(keyOf(s))).join(".")}: ${issue.message}`;
};

/**
 * `class X extends Entity("X")({ …fields }) {}`
 *
 * Curried on the tag so it reads next to the class name it labels, ahead of
 * the field map. The tag is a non-enumerable instance property: it exists
 * for `P.tag` matching and never reaches the wire.
 */
export function Entity<Tag extends string>(tag: Tag) {
  return function <
    S extends Fields,
    A extends Fields = Record<never, never>,
    const K extends readonly (keyof S)[] = [],
    const G extends readonly (keyof S)[] = [],
    const I extends readonly (keyof DecodedOf<S, A, K>)[] = [],
  >(
    fields: S & OnlyNominal<S>,
    options?: {
      readonly generated?: G;
      readonly immutable?: I;
      readonly decoded?: { readonly omit?: K; readonly add?: AddSpec<A, EncodedOf<S>> };
      readonly invariants?: (d: DecodedOf<S, A, K>) => readonly string[];
    },
  ): EntityStatic<Tag, S, A, K, G, I> {
    const encoded = shape<S>(fields);

    const omitted = options?.decoded?.omit ?? [];
    const addSpec = options?.decoded?.add;

    // `.omit()`'s mask can't be satisfied by a mask built from a generic key
    // list — TS won't reduce `Exclude<K[number], keyof S>` (or the equivalent
    // for `G`/`I`) to `never` even though the constraint implies it — so this
    // calls through a simplified signature rather than fight it.
    const omitBy = (o: z.ZodObject<Fields>, keys: readonly PropertyKey[]) =>
      keys.length > 0
        ? (o.omit as (m: Record<string, true>) => z.ZodObject<Fields>)(maskOf(keys))
        : o;

    const afterOmit = omitBy(encoded as z.ZodObject<Fields>, omitted);
    const decoded = (addSpec ? afterOmit.extend(addSpec.fields) : afterOmit) as z.ZodObject<
      Omit<S, K[number]> & A
    >;

    const generatedKeys = options?.generated ?? [];
    const immutableKeys = options?.immutable ?? [];

    /** what a caller may send to create */
    const createInput = omitBy(encoded as z.ZodObject<Fields>, generatedKeys) as z.ZodObject<
      Omit<S, G[number]>
    >;
    /** what a caller may send to update */
    const updateInput = omitBy(
      decoded as z.ZodObject<Fields>,
      immutableKeys,
    ).partial() as z.ZodObject<UpdateInputShapeOf<S, A, K, I>>;

    type DecodedShape = DecodedOf<S, A, K>;
    type EncodedShape = EncodedOf<S>;

    const dataKeys = Object.keys(decoded.shape) as unknown as readonly (keyof DecodedShape)[];
    const parseEncoded = fromSchema(encoded);
    // `DecodedShape` is hand-rolled alias of the same values for better error clarity
    const parseDecoded = fromSchema(decoded) as (d: unknown) => Result<DecodedShape, SchemaIssues>;

    const toInvalidEntity = (issues: SchemaIssues) =>
      new InvalidEntity({ entity: tag, issues: issues.map(describeIssue) });

    /**
     * Validates ONLY what `add` returned, never the kept fields: `decode`
     * already validated every kept field against `encoded`, and re-running a
     * field schema over its own output is not a no-op — a non-idempotent
     * transform applies twice, and a type-changing one rejects its own
     * output. Checking `add`'s output is what makes its unchecked `as Brand`
     * casts honest.
     */
    const parseAdded = addSpec
      ? (fromSchema(shape<A>(addSpec.fields as A & OnlyNominal<A>)) as (
          d: unknown,
        ) => Result<AddedOf<A>, SchemaIssues>)
      : undefined;

    const decodedFrom = (e: EncodedShape, computed: object): DecodedShape => {
      const kept = { ...e } as Record<PropertyKey, unknown>;
      for (const k of omitted) delete kept[k as PropertyKey];
      return { ...kept, ...computed } as unknown as DecodedShape;
    };

    const invariants = options?.invariants;

    /** The tail every entry point shares: check the invariants, then seal and construct. */
    const construct = <T>(
      Ctor: new (d: Sealed<DecodedShape>) => T,
      d: DecodedShape,
    ): Result<T, InvalidEntity> => {
      const broken = invariants?.(d) ?? [];
      return broken.length > 0
        ? Err(new InvalidEntity({ entity: tag, issues: broken }))
        : Ok(new Ctor(d as Sealed<DecodedShape>));
    };

    class Base {
      static readonly entityName = tag;
      /** the full wire object */
      static readonly encoded = encoded;
      /** stored state and response body */
      static readonly decoded = decoded;
      /** what a caller may send to create */
      static readonly createInput = createInput;
      /** what a caller may send to update */
      static readonly updateInput = updateInput;

      constructor(d: Sealed<DecodedShape>) {
        const source = d as unknown as Record<PropertyKey, unknown>;
        // One set for the whole instance, not one per field: fields can share
        // a subtree, and a per-field set would re-walk it once per field that
        // reaches it. See `deepFreeze`.
        const seen = new WeakSet<object>();
        for (const k of dataKeys) {
          Object.defineProperty(this, k, {
            // `writable: false` locks the binding; `deepFreeze` locks the
            // value behind it, so an array or nested object field cannot be
            // mutated out from under the invariants that just passed.
            // Deliberately NOT `Object.freeze(this)`: subclass field
            // initialisers run after `super()` returns, so the instance
            // itself must stay extensible (pinned by a test in
            // `entity.spec.ts`).
            value: deepFreeze(source[k as PropertyKey], seen),
            writable: false,
            enumerable: true,
          });
        }
        // non-enumerable, so it is absent from Object.keys, spread,
        // JSON.stringify and encode() — but still readable by P.tag
        Object.defineProperty(this, "_tag", { value: tag, enumerable: false });
      }

      /** projects only the stored schema's keys, so subclass fields never leak */
      encode(): DecodedShape {
        const self = this as unknown as Record<keyof DecodedShape, unknown>;
        return Object.fromEntries(dataKeys.map((k) => [k, self[k]])) as DecodedShape;
      }

      toJSON(): DecodedShape {
        return this.encode();
      }

      /** Equal encoded data means equal entity. Compares JSON-serialized form to
       * handle arrays correctly and ignore construction order. */
      equals(other: unknown): boolean {
        if (!(other instanceof Base)) return false;
        return JSON.stringify(this.encode()) === JSON.stringify(other.encode());
      }

      /** a full untrusted encoded payload → entity */
      static decode<T>(
        this: new (d: Sealed<DecodedShape>) => T,
        raw: unknown,
      ): Result<T, InvalidEntity> {
        return parseEncoded(raw)
          .mapErrCases((m) =>
            // SchemaIssues is `readonly Issue[]` — a single non-union type, nothing to enumerate
            // oxlint-disable-next-line unthrown/no-catch-all-pattern
            m.with(P._, toInvalidEntity),
          )
          .flatMap((e) =>
            parseAdded === undefined || addSpec === undefined
              ? Ok(decodedFrom(e, {}))
              : parseAdded(addSpec.from(e))
                  .mapErrCases((m, defect) =>
                    // SchemaIssues is `readonly Issue[]` — a single non-union type, nothing to enumerate
                    // oxlint-disable-next-line unthrown/no-catch-all-pattern
                    m.with(P._, (issues) =>
                      defect(
                        new Error(
                          `${tag}.add produced data its own schema rejects: ${issues
                            .map(describeIssue)
                            .join("; ")}`,
                        ),
                      ),
                    ),
                  )
                  // `.flatMap` rather than `.map` because `map`'s NotThenable
                  // guard cannot resolve while the type is still generic.
                  .flatMap((computed) => Ok(decodedFrom(e, computed))),
          )
          .flatMap((d) => construct(this, d));
      }

      /** already-stored state → entity, for row mappers and event folds */
      static make<T>(
        this: new (d: Sealed<DecodedShape>) => T,
        state: unknown,
      ): Result<T, InvalidEntity> {
        return parseDecoded(state)
          .mapErrCases((m) =>
            // SchemaIssues is `readonly Issue[]` — a single non-union type, nothing to enumerate
            // oxlint-disable-next-line unthrown/no-catch-all-pattern
            m.with(P._, toInvalidEntity),
          )
          .flatMap((d) => construct(this, d));
      }

      /** caller fields + domain-generated fields → entity */
      static create<T>(
        this: new (d: Sealed<DecodedShape>) => T,
        input: CreateInputOf<S, G>,
        generated: GeneratedOf<S, G>,
      ): Result<T, InvalidEntity> {
        // generated spreads last, so a caller cannot override a domain-owned field
        return (this as unknown as { decode: (raw: unknown) => Result<T, InvalidEntity> }).decode({
          ...(input as object),
          ...(generated as object),
        });
      }

      /** a partial of the mutable fields → a NEW entity */
      update(this: Base, patch: PatchOf<S, A, K, I>): Result<Base, InvalidEntity> {
        const current = this.encode() as Record<PropertyKey, unknown>;
        const applied = { ...current };
        for (const [k, v] of Object.entries(patch as object)) {
          // immutable keys are a compile error already; drop them at runtime
          // too — `immutableKeys` is generic `I`, so `.includes` narrows its
          // parameter, hence the cast to the widened runtime element type.
          if (!(immutableKeys as readonly PropertyKey[]).includes(k)) applied[k] = v;
        }
        const Ctor = this.constructor as unknown as {
          make: (state: unknown) => Result<Base, InvalidEntity>;
        };
        return Ctor.make(applied);
      }
    }

    attachInstance<Base & DeepReadonly<DecodedShape>>(Base, encoded);

    return Base as unknown as EntityStatic<Tag, S, A, K, G, I>;
  };
}

/** What the wire sends — for mapper and request signatures. */
export type Encoded<E extends { readonly __encoded: unknown }> = E["__encoded"];

/** What the entity stores — for `make` and repository signatures. */
export type Decoded<E extends { readonly __decoded: unknown }> = E["__decoded"];

/** What `create` accepts from a caller. */
export type CreateInput<E extends { readonly __createInput: unknown }> = E["__createInput"];

/** What `update` accepts. */
export type Patch<E extends { readonly __patch: unknown }> = E["__patch"];
