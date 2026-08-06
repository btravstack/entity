import { fromSchema, type SchemaIssues } from "@unthrown/standard-schema";
import { Err, Ok, P, fromPromise, fromThrowable, type Result } from "unthrown";
import type { z } from "zod";

import type { AddSpec } from "./add.js";
import { InvalidEntity } from "./errors.js";
import { deepFreeze } from "./freeze.js";
import { attachInstance } from "./instance.js";
import { renderIssue } from "./issues.js";
import { shape, type OnlyNominal } from "./shape.js";
import type {
  AddedOf,
  AsyncEntityFactory,
  AsyncGenerators,
  EntityFactory,
  Generators,
  DecodedOf,
  DeepReadonly,
  EncodedOf,
  EntityStatic,
  Fields,
  PatchOf,
  Sealed,
  UpdateInputShapeOf,
} from "./types.js";

/** Calls every generator once, in declaration order. */
const callAll = (generators: Record<string, () => unknown>): Record<string, unknown> =>
  Object.fromEntries(Object.entries(generators).map(([k, gen]) => [k, gen()]));

const resolveAll = async (
  generators: Record<string, () => PromiseLike<unknown>>,
): Promise<Record<string, unknown>> =>
  Object.fromEntries(
    await Promise.all(
      Object.entries(generators).map(async ([k, gen]) => [k, await gen()] as const),
    ),
  );

const maskOf = (keys: readonly PropertyKey[]) =>
  Object.fromEntries(keys.map((k) => [k, true as const]));

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

    /**
     * Every key `update` refuses: the declared immutable ones, plus the keys
     * `add` contributed. An added field is *implicitly* immutable — `add`
     * reads the **encoded** object, and `update` only ever holds the decoded
     * one, which no longer carries an omitted source field like `secret`, so
     * there is nothing to recompute from. Freezing them is the only answer
     * that keeps a computed field consistent with its source; see `PatchOf`.
     * Typed at the widened runtime element type so both uses below — the
     * `.omit()` mask and `update`'s drop-list — take it without a cast.
     */
    const frozenKeys: readonly PropertyKey[] = [
      ...immutableKeys,
      ...(addSpec ? Object.keys(addSpec.fields) : []),
    ];

    /** what a caller may send to create */
    const createInput = omitBy(encoded as z.ZodObject<Fields>, generatedKeys) as z.ZodObject<
      Omit<S, G[number]>
    >;
    /** what a caller may send to update */
    const updateInput = omitBy(decoded as z.ZodObject<Fields>, frozenKeys).partial() as z.ZodObject<
      UpdateInputShapeOf<S, A, K, I>
    >;

    type DecodedShape = DecodedOf<S, A, K>;
    type EncodedShape = EncodedOf<S>;

    const dataKeys = Object.keys(decoded.shape) as unknown as readonly (keyof DecodedShape)[];

    /**
     * Projects an instance down to exactly the `decoded` schema's keys.
     *
     * Module-private on purpose. `toJSON`, `equals` and `update` all need this
     * projection, but only `toJSON` is a public surface — routing the other
     * two through a shared function rather than through `toJSON` keeps them
     * from depending on a serialization hook a subclass is free to override.
     */
    const project = (self: object): DecodedShape => {
      const source = self as Record<keyof DecodedShape, unknown>;
      return Object.fromEntries(dataKeys.map((k) => [k, source[k]])) as DecodedShape;
    };

    const parseEncoded = fromSchema(encoded);
    // `DecodedShape` is hand-rolled alias of the same values for better error clarity
    const parseDecoded = fromSchema(decoded) as (d: unknown) => Result<DecodedShape, SchemaIssues>;

    const toInvalidEntity = (issues: SchemaIssues) => new InvalidEntity({ entity: tag, issues });

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
      // no `path` — an invariant spans the entity, not one field
      if (broken.length > 0) {
        return Err(
          new InvalidEntity({ entity: tag, issues: broken.map((message) => ({ message })) }),
        );
      }
      // A defect, not an `InvalidEntity`: subclassing is a bug in domain code,
      // not bad caller input. `fromThrowable` is what keeps it inside the
      // Result channel — a bare throw would escape `decode()` entirely.
      return fromThrowable(
        () => {
          const ctor = Ctor as unknown as object;
          if (ctor !== Base && (Object.getPrototypeOf(ctor) as unknown) !== Base) {
            // oxlint-disable-next-line unthrown/no-throw
            throw new Error(
              `${tag}: subclassing an entity class is not supported — put the behaviour in the entity's own class body.`,
            );
          }
          return new Ctor(d as Sealed<DecodedShape>);
        },
        (cause, defect) => defect(cause),
      )() as Result<T, InvalidEntity>;
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
        // JSON.stringify and toJSON() — but still readable by P.tag
        Object.defineProperty(this, "_tag", { value: tag, enumerable: false });
      }

      /**
       * The stored data, projected to exactly the `decoded` schema's keys.
       *
       * This is the *only* public projection. `toJSON` is not a name this
       * package chose — it is the hook `JSON.stringify` looks for — and it has
       * to exist regardless: without it, `JSON.stringify(entity)` walks own
       * enumerable properties, which includes a subclass's own instance
       * fields, and leaks them. Projecting `dataKeys` is what excludes both
       * those and `_tag`.
       *
       * There is deliberately no second method returning the same value under
       * a domain name. One that existed here was removed: two public spellings
       * of one projection is the alias CONTRIBUTING tells us to resist, and a
       * repository write reads perfectly well as `db.insert(org.toJSON())`.
       */
      toJSON(): DecodedShape {
        return project(this);
      }

      /** Equal stored data means equal entity. Compares JSON-serialized form to
       * handle arrays correctly and ignore construction order. */
      equals(other: unknown): boolean {
        if (!(other instanceof Base)) return false;
        return JSON.stringify(project(this)) === JSON.stringify(project(other));
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
                            .map(renderIssue)
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
      static factory<T>(
        this: new (d: Sealed<DecodedShape>) => T,
        generators: Generators<S, G>,
      ): EntityFactory<T, S, G> {
        const Ctor = this as unknown as { decode: (raw: unknown) => Result<T, InvalidEntity> };
        return {
          create: (input) =>
            // generated spreads last, so a caller cannot override a domain-owned field
            Ctor.decode({ ...(input as object), ...callAll(generators) }),
        };
      }

      static factoryAsync<T>(
        this: new (d: Sealed<DecodedShape>) => T,
        generators: AsyncGenerators<S, G>,
      ): AsyncEntityFactory<T, S, G> {
        const Ctor = this as unknown as { decode: (raw: unknown) => Result<T, InvalidEntity> };
        return {
          create: (input) =>
            // a generator that rejects is infrastructure failing, not bad domain
            // input, so it stays a Defect rather than becoming an InvalidEntity
            fromPromise(resolveAll(generators), (cause, defect) => defect(cause)).flatMap(
              (generated) => Ctor.decode({ ...(input as object), ...generated }),
            ),
        };
      }

      /** a partial of the mutable fields → a NEW entity */
      update(this: Base, patch: PatchOf<S, A, K, I>): Result<Base, InvalidEntity> {
        const current = project(this) as Record<PropertyKey, unknown>;
        const applied = { ...current };
        for (const [k, v] of Object.entries(patch as object)) {
          // frozen keys — declared immutable, or contributed by `add` — are a
          // compile error already; drop them at runtime too, so a patch that
          // reached here as `unknown` cannot desynchronise a computed field
          // from the source it was derived from.
          if (!frozenKeys.includes(k)) applied[k] = v;
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
