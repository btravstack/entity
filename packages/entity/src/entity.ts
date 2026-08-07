import { fromSchema, type SchemaIssues } from "@unthrown/standard-schema";
import { Err, Ok, P, all, fromPromise, fromThrowable, type Result } from "unthrown";
import type { z } from "zod";

import { computed, type ComputedField } from "./computed.js";
import { deepEqual } from "./equal.js";
import { InvalidEntity } from "./errors.js";
import { deepFreeze } from "./freeze.js";
import { invariant, type Invariant } from "./invariant.js";
import { renderIssue } from "./issues.js";
import { attachSchema } from "./schema.js";
import { shape, type OnlyNominal } from "./shape.js";
import type {
  AsyncEntityFactory,
  AsyncGenerators,
  BaseInstance,
  ConstructionKey,
  EntityFactory,
  Generators,
  OutputOf,
  DeepReadonly,
  InputOf,
  EntityStatic,
  Fields,
  PatchOf,
  Sealed,
  UpdateInputShapeOf,
} from "./types.js";
import { union, type EntityUnion, type UnionMember } from "./union.js";

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
 * What each entity was declared with, so `extend` can rebuild from it. Keyed
 * by the base class rather than stored on it, so nothing leaks onto the
 * public surface or into a consumer's declarations.
 */
const declarations = new WeakMap<
  object,
  { readonly fields: Fields; readonly options: Record<string, unknown> | undefined }
>();

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
    const G extends readonly (keyof S)[] = [],
    const I extends readonly (keyof OutputOf<S, A>)[] = [],
  >(
    fields: S & OnlyNominal<S>,
    options?: {
      readonly generated?: G;
      readonly immutable?: I;
      readonly computed?: { [K in keyof A]: ComputedField<A[K], InputOf<S>> };
      // The *declared* fields, not `OutputOf`. A rule cannot read a computed
      // field — see `invariant.ts` for why that is both sound and necessary.
      readonly invariants?: readonly Invariant<InputOf<S>>[];
    },
  ): EntityStatic<Tag, S, A, G, I> {
    const input = shape<S>(fields);

    // `.omit()`'s mask can't be satisfied by a mask built from a generic key
    // list — TS won't reduce `Exclude<G[number], keyof S>` (or the equivalent
    // for `I`) to `never` even though the constraint implies it — so this
    // calls through a simplified signature rather than fight it.
    //
    // The empty-key branch rebuilds rather than returning `o`. Returning the
    // argument made `input === output === createInput` for any entity with no
    // `generated` and no `computed` — one object under three names. Since the
    // design rule is "contracts compose the four plain `ZodObject`s", anything
    // keying off schema identity collapsed: registering the three in
    // `z.globalRegistry` under distinct ids silently kept only the last, and
    // `z.toJSONSchema` emitted one `$def` that all three properties `$ref`'d.
    // `contract.spec.ts` missed it because its fixture declares both options.
    const omitBy = (o: z.ZodObject<Fields>, keys: readonly PropertyKey[]) =>
      (o.omit as (m: Record<string, true>) => z.ZodObject<Fields>)(maskOf(keys));

    /** [key, validate its output, produce it] per computed field. */
    const computedFields = Object.entries(
      (options?.computed ?? {}) as Record<string, ComputedField<z.ZodTypeAny, InputShape>>,
    );

    // `.extend({})` on the empty branch for the same reason as `omitBy`: the
    // four schema members must be four distinct objects, or a consumer keying a
    // registry by identity silently loses three of them.
    const output = (input as z.ZodObject<Fields>).extend(
      Object.fromEntries(computedFields.map(([k, f]) => [k, f.schema])),
    ) as unknown as z.ZodObject<S & A>;

    const generatedKeys = options?.generated ?? [];
    const immutableKeys = options?.immutable ?? [];

    /**
     * Every key `update` refuses: the declared immutable ones, plus the
     * computed ones. A computed field is not patchable because it is derived —
     * `update` re-runs `from` like every other construction path, so patching
     * it would only be overwritten. Typed at the widened runtime element type
     * so both uses below — the `.omit()` mask and `update`'s drop-list — take
     * it without a cast.
     */
    const frozenKeys: readonly PropertyKey[] = [
      ...immutableKeys,
      ...computedFields.map(([k]) => k),
    ];

    /** what a caller may send to create */
    const createInput = omitBy(input as z.ZodObject<Fields>, generatedKeys) as z.ZodObject<
      Omit<S, G[number]>
    >;
    /** what a caller may send to update */
    const updateInput = omitBy(output as z.ZodObject<Fields>, frozenKeys).partial() as z.ZodObject<
      UpdateInputShapeOf<S, A, I>
    >;

    type OutputShape = OutputOf<S, A>;
    type InputShape = InputOf<S>;

    const dataKeys = Object.keys(output.shape) as unknown as readonly (keyof OutputShape)[];

    /**
     * Fields the freeze must not touch, decided by their **schema** rather than
     * by the runtime shape of what came back.
     *
     * `freeze.ts` documents that a `z.custom(...)`/`z.instanceof(...)` value is
     * left alone, precisely because "the value may still be referenced by the
     * caller who passed it in". That promise was false: `z.custom` returns the
     * caller's reference unchanged, so a plain-object one satisfied
     * `isPlainObject` and was deep-frozen in place — measured, the caller's own
     * later `config.retries = 5` threw `Cannot assign to read only property`.
     * The runtime cannot tell a passed-through object from decoded data; only
     * the schema can, so the decision is made here and passed down.
     *
     * `z.custom`, `z.instanceof` and a branded `z.custom` all report `custom`:
     * brand is type-level in zod v4 and adds no wrapper.
     */
    const passthroughKeys = new Set(
      Object.entries(output.shape as Record<string, z.core.$ZodType>)
        .filter(([, schema]) => schema._zod.def.type === "custom")
        .map(([key]) => key),
    );

    /**
     * Projects an instance down to exactly the `output` schema's keys.
     *
     * Module-private on purpose. `toJSON`, `equals` and `update` all need this
     * projection, but only `toJSON` is a public surface — routing the other
     * two through a shared function rather than through `toJSON` keeps them
     * from depending on a serialization hook a subclass is free to override.
     */
    const project = (self: object): OutputShape => {
      const source = self as Record<keyof OutputShape, unknown>;
      return Object.fromEntries(dataKeys.map((k) => [k, source[k]])) as OutputShape;
    };

    const parseInput = fromSchema(input);

    const toInvalidEntity = (issues: SchemaIssues) => new InvalidEntity({ entity: tag, issues });

    /**
     * Each computed field's own validator, so a failure names that field.
     *
     * Only the derived values are checked, never the declared ones: those were
     * already validated against `input`, and re-running a field schema over
     * its own output is not a no-op — a non-idempotent transform applies twice,
     * and a type-changing one rejects its own output. Checking the derived
     * output is what makes `from`'s unchecked `as Brand` cast honest.
     */
    const computedParsers = computedFields.map(
      ([key, f]) => [key, f.from, fromSchema(f.schema)] as const,
    );

    const computedDefect = (key: string, detail: string) =>
      new Error(`${tag}.computed.${key} produced data its own schema rejects: ${detail}`);

    /**
     * Re-derives every computed field from the declared ones. Runs on every
     * construction path, so a derived value cannot go stale against its own
     * sources — which is why `from` reads the declared fields rather than the
     * raw payload.
     *
     * `from` is wrapped: it is domain code, and a throw would otherwise escape
     * `decode`/`make`/`update` and break the Result contract. Both a throw and
     * output its own schema rejects are defects — `from` is pure, total and
     * typed, so either is a bug rather than bad caller input.
     */
    const recompute = (base: InputShape): Result<OutputShape, InvalidEntity> => {
      if (computedParsers.length === 0) return Ok({ ...base } as unknown as OutputShape);
      return all(
        computedParsers.map(([key, from, parse]) =>
          fromThrowable(
            () => from(base),
            (cause, defect) => defect(cause),
          )()
            .flatMap((produced) =>
              parse(produced).mapErrCases((m, defect) =>
                // SchemaIssues is `readonly Issue[]` — a single non-union type, nothing to enumerate
                // oxlint-disable-next-line unthrown/no-catch-all-pattern
                m.with(P._, (issues) =>
                  defect(computedDefect(key, issues.map(renderIssue).join("; "))),
                ),
              ),
            )
            .map((value) => [key, value] as const),
        ),
        // `.flatMap` rather than `.map`: `map`'s NotThenable guard cannot
        // resolve while the shape is still generic.
      ).flatMap((pairs) =>
        Ok({ ...base, ...Object.fromEntries(pairs) } as unknown as OutputShape),
      ) as Result<OutputShape, InvalidEntity>;
    };

    const invariants = options?.invariants;

    /** The tail every entry point shares: check the invariants, then seal and construct. */
    const construct = <T>(
      Ctor: new (d: Sealed<OutputShape>) => T,
      d: OutputShape,
    ): Result<T, InvalidEntity> => {
      // Every failing rule reports, not just the first. A predicate that throws
      // escapes to the defect channel via the `fromThrowable` around `make`,
      // which is what a bug in a rule should be.
      const broken = (invariants ?? [])
        .filter((rule) => !rule.ensure(d))
        .map((rule) => rule.describe(d));
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
          return new Ctor(d as Sealed<OutputShape>);
        },
        (cause, defect) => defect(cause),
      )() as Result<T, InvalidEntity>;
    };

    class Base {
      static readonly entityName = tag;
      /** everything `make` accepts */
      static readonly input = input;
      /** stored state and response body */
      static readonly output = output;
      /** what a caller may send to create */
      static readonly createInput = createInput;
      /** what a caller may send to update */
      static readonly updateInput = updateInput;

      constructor(d: Sealed<OutputShape>) {
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
            value: passthroughKeys.has(k as string)
              ? source[k as PropertyKey]
              : deepFreeze(source[k as PropertyKey], seen),
            writable: false,
            enumerable: true,
          });
        }
        // non-enumerable, so it is absent from Object.keys, spread,
        // JSON.stringify and toJSON() — but still readable by P.tag
        Object.defineProperty(this, "_tag", { value: tag, enumerable: false });
      }

      /**
       * The stored data, projected to exactly the `output` schema's keys.
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
      toJSON(): OutputShape {
        return project(this);
      }

      /**
       * Equal stored data means equal entity.
       *
       * Compares the projected data structurally, not by `JSON.stringify`:
       * serialising threw on a `bigint` field, equated `Set`/`Map`/typed-array
       * fields with different contents, and reported a nested record as changed
       * when only its key order differed. See `equal.ts`.
       */
      equals(other: unknown): boolean {
        if (!(other instanceof Base)) return false;
        return deepEqual(project(this), project(other));
      }

      /**
       * data → entity. The only way in: a database row, a folded event stream,
       * an untrusted import, a replayed integration event.
       *
       * Validated against `input`, not `output`, even though a stored row
       * carries the computed keys too. Those keys are re-derived rather than
       * read, so validating them would reject exactly the rows this is meant to
       * heal: one written before a derivation changed, or written before the
       * computed field existed at all. Extra keys are ignored, as zod ignores
       * any unknown key.
       */
      static make<T>(
        this: new (d: Sealed<OutputShape>) => T,
        state: unknown,
      ): Result<T, InvalidEntity> {
        return parseInput(state)
          .mapErrCases((m) =>
            // SchemaIssues is `readonly Issue[]` — a single non-union type, nothing to enumerate
            // oxlint-disable-next-line unthrown/no-catch-all-pattern
            m.with(P._, toInvalidEntity),
          )
          .flatMap(recompute)
          .flatMap((d) => construct(this, d));
      }

      /** caller fields + domain-generated fields → entity */
      static factory<T>(
        this: new (d: Sealed<OutputShape>) => T,
        generators: Generators<S, G>,
      ): EntityFactory<T, S, G> {
        const Ctor = this as unknown as { make: (state: unknown) => Result<T, InvalidEntity> };
        // generated spreads last, so a caller cannot override a domain-owned field
        return (input) => Ctor.make({ ...(input as object), ...callAll(generators) });
      }

      static factoryAsync<T>(
        this: new (d: Sealed<OutputShape>) => T,
        generators: AsyncGenerators<S, G>,
      ): AsyncEntityFactory<T, S, G> {
        const Ctor = this as unknown as { make: (state: unknown) => Result<T, InvalidEntity> };
        // a generator that rejects is infrastructure failing, not bad domain
        // input, so it stays a Defect rather than becoming an InvalidEntity
        return (input) =>
          fromPromise(resolveAll(generators), (cause, defect) => defect(cause)).flatMap(
            (generated) => Ctor.make({ ...(input as object), ...generated }),
          );
      }

      /** a partial of the mutable fields → a NEW entity */
      update(this: Base, patch: PatchOf<S, A, I>): Result<Base, InvalidEntity> {
        const current = project(this) as Record<PropertyKey, unknown>;
        const applied = { ...current };
        for (const [k, v] of Object.entries(patch as object)) {
          // frozen keys — declared immutable, or computed — are a
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

    attachSchema<Base & DeepReadonly<OutputShape>>(Base, input);
    declarations.set(Base, { fields, options: options as Record<string, unknown> | undefined });

    /**
     * A *new* entity carrying this one's fields plus more, under its own tag.
     *
     * Not subclassing, which stays forbidden: the result is its own
     * `Entity(...)` call, so it has a distinct tag, a distinct identity under
     * `equals`, and its own schemas. `class X extends Parent {}` would have
     * had none of those — same fields, same tag, no way to tell the two apart.
     *
     * Options merge per key, child winning — except `invariants`, which
     * **concatenates** parent-then-child. Inheriting matters more than it might
     * look: silently dropping the parent's `immutable` or `invariants` would
     * leave the extension quietly laxer than what it extends, and child-wins on
     * a list of rules is exactly how that happens. An extension can add rules;
     * it cannot shed them. Chained extends compose without duplicating, because
     * each `extend` stores the list it already merged.
     */
    Object.defineProperty(Base, "extend", {
      enumerable: false,
      value: (nextTag: string) => (nextFields: Fields, nextOptions?: Record<string, unknown>) => {
        const parent = declarations.get(Base);
        const parentOptions = parent?.options as
          | { readonly invariants?: readonly Invariant<unknown>[] }
          | undefined;
        const childInvariants = (
          nextOptions as { readonly invariants?: readonly Invariant<unknown>[] } | undefined
        )?.invariants;
        const invariants = [...(parentOptions?.invariants ?? []), ...(childInvariants ?? [])];
        return (Entity as (t: string) => (f: Fields, o?: unknown) => unknown)(nextTag)(
          { ...parent?.fields, ...nextFields },
          {
            ...parent?.options,
            ...nextOptions,
            ...(invariants.length > 0 ? { invariants } : {}),
          },
        );
      },
    });

    return Base as unknown as EntityStatic<Tag, S, A, G, I>;
  };
}

/**
 * Grouped under `Entity` rather than exported loose, and the package exports
 * nothing else: `computed` and `union` are both too generic to take from a
 * consumer's import scope — `computed` collides outright with Vue, MobX,
 * Angular signals and Solid — and each reads as a sibling of whatever already
 * holds that name when it is nothing of the sort. `InvalidEntity` would pass
 * that test on its own, and is grouped anyway so the rule has no exceptions.
 */
Entity.computed = computed;
Entity.invariant = invariant;
Entity.union = union;
Entity.InvalidEntity = InvalidEntity;

/**
 * Source aliases for the namespace below. The `Src` suffix is load bearing.
 *
 * A namespace member that shares a name with the type it aliases is emitted by
 * tsdown's dts bundler as a circular self-alias — `type ConstructionKey =
 * ConstructionKey` — because the bundler collapses the import to a bare name
 * that then resolves to the member itself. That **compiles**, so nothing fails
 * loudly; the type just degenerates. Measured against tsdown + typescript
 * 7.0.2: spelling this member `import("./types.js").ConstructionKey` voided the
 * construction seal, and the only signal was the consumer fixture's
 * `@ts-expect-error` on a forged key going *unused*. An unused directive under
 * `consumer/` is a failure here, not noise.
 */
type ComputedFieldSrc<T extends z.core.$ZodType, D> = ComputedField<T, D>;
type InvariantSrc<D> = Invariant<D>;
type EntityUnionSrc<K extends string, M extends readonly UnionMember[]> = EntityUnion<K, M>;
type ConstructionKeySrc = ConstructionKey;
type SealedSrc<D> = Sealed<D>;
type BaseInstanceSrc<
  S extends Fields,
  A extends Fields,
  I extends readonly (keyof OutputOf<S, A>)[],
> = BaseInstance<S, A, I>;

export declare namespace Entity {
  /** What the wire sends — for mapper and request signatures. */
  export type Input<E extends { readonly __input: unknown }> = E["__input"];

  /** What the entity stores — for `make` and repository signatures. */
  export type Output<E extends { readonly __output: unknown }> = E["__output"];

  /** What `create` accepts from a caller. */
  export type CreateInput<E extends { readonly __createInput: unknown }> = E["__createInput"];

  /** What `update` accepts. */
  export type Patch<E extends { readonly __patch: unknown }> = E["__patch"];

  /** One derived field: its schema, and the function that produces it. */
  export type ComputedField<T extends z.core.$ZodType, D> = ComputedFieldSrc<T, D>;

  /** One whole-entity rule: the predicate, and what to say when it fails. */
  export type Invariant<D> = InvariantSrc<D>;

  // `InvalidEntity` is a class, so it needs both meanings under `Entity`: the
  // value for `instanceof`, the type for annotations. A re-export carries both,
  // where a `type` member would shadow the value and reject the runtime
  // assignment above (TS2339).
  export { InvalidEntity };

  /** What `Entity.union(...)` returns. */
  export type Union<K extends string, M extends readonly UnionMember[]> = EntityUnionSrc<K, M>;

  // Exported only so a consumer's emitted declarations can name them — none of
  // the three is part of the API you write against. See `Sealed` in types.ts.
  export type BaseInstance<
    S extends Fields,
    A extends Fields,
    I extends readonly (keyof OutputOf<S, A>)[],
  > = BaseInstanceSrc<S, A, I>;
  export type ConstructionKey = ConstructionKeySrc;
  export type Sealed<D> = SealedSrc<D>;
}
