import type { AsyncResult, Result } from "unthrown";
import type { z } from "zod";

import type { InvalidEntity } from "./errors.js";

export type Fields = Record<string, z.ZodTypeAny>;

/** The data an entity accepts on the wire. */
export type EncodedOf<S extends Fields> = z.infer<z.ZodObject<S>>;

/**
 * The values the computed fields contribute.
 *
 * Zod's `$InferObjectOutput` special-cases an *empty* shape to
 * `Record<string, never>` — a real index signature, not `{}`. Unguarded, that
 * makes an option-less entity's decoded type read as "any string key, valued
 * never", and intersecting it poisons the whole type (TS2411: a subclass
 * instance method is "not assignable to 'string' index type 'never'").
 * `Record<never, never>` is inert under intersection.
 *
 * `[keyof A] extends [never]` is tuple-wrapped so a union `A` is tested as a
 * whole rather than distributed.
 *
 * A non-empty `A` goes through `z.infer` rather than a mapped type so an
 * `.optional()` field keeps its optional key (`k?: T`) instead of becoming a
 * required `k: T | undefined`.
 */
export type ComputedOf<A extends Fields> = [keyof A] extends [never]
  ? Record<never, never>
  : z.infer<z.ZodObject<A>>;

/**
 * What the entity stores and returns: the declared fields plus the computed
 * ones. There is deliberately no `_tag` — the tag is a
 * non-enumerable instance property and never part of the data.
 */
export type DecodedOf<S extends Fields, A extends Fields> = EncodedOf<S> & ComputedOf<A>;

/** What `create` accepts from a caller: everything the domain does not generate. */
export type CreateInputOf<S extends Fields, G extends readonly (keyof S)[]> = Omit<
  EncodedOf<S>,
  G[number]
>;

/**
 * What `create` requires the use case to supply.
 *
 * `Pick` constrains its second parameter to `keyof T`, and TypeScript cannot
 * prove `G[number]` — which is `keyof S` — satisfies `keyof EncodedOf<S>`
 * through zod's inference chain. This mapped type with key remapping achieves
 * the same semantics. `CreateInputOf` uses `Omit` (no such constraint);
 * `GeneratedOf` uses this mapped form for that reason.
 */
export type GeneratedOf<S extends Fields, G extends readonly (keyof S)[]> = {
  [K in keyof EncodedOf<S> as K extends G[number] ? K : never]: EncodedOf<S>[K];
};

/**
 * The types `DeepReadonly` hands back untouched.
 *
 * Primitives have no properties to lock. The load-bearing case is the
 * *branded* primitive every field of this package carries: `z.infer` of
 * `z.string().brand("Slug")` is `string & z.core.$brand<"Slug">`, an
 * intersection whose object constituent makes it satisfy `extends object`.
 * Mapping over it was measured to destroy it: `{ readonly [K in keyof Slug]:
 * … }` keeps `String`'s members and the brand key but drops the primitive
 * itself, so the result no longer assigns back to `Slug` — TS2322, "Type
 * '{ readonly [x: number]: string; readonly toString: {}; … readonly
 * [$brand]: {…}; }' is not assignable to type 'string'". Testing against the
 * bare primitives first short-circuits every branded scalar with its brand
 * intact, because an intersection is assignable to any of its constituents.
 *
 * `Date` keeps its timestamp in an internal slot a mapped type cannot
 * describe; `RegExp` keeps `source` and its flags the same way, though its
 * `lastIndex` *is* an ordinary mutable data property; and a function's call
 * signature is likewise not a property — the `never[]` rest parameter is the
 * contravariance-safe spelling of "any function" (`unknown[]` rejects
 * narrower parameter lists under `strictFunctionTypes`).
 *
 * All three are therefore left unmapped *at the type level*. That is not the
 * same as the runtime leaving them untouched, and the two halves deliberately
 * do not line up: `freeze.ts` freezes a `Date` as a leaf (harmless — it has
 * no own enumerable properties, and `setTime` still works, so it only stops
 * properties being bolted on), while `RegExp` and functions are not frozen at
 * all. Freezing a `RegExp` is actively destructive, not merely useless: a
 * `/g` or `/y` pattern rewrites `lastIndex` on every `exec`, so on a frozen
 * one `exec` itself throws — measured: `TypeError: Cannot assign to read only
 * property 'lastIndex'`. See `freeze.ts` for the runtime rules.
 */
type Immutable =
  | string
  | number
  | bigint
  | boolean
  | symbol
  | null
  | undefined
  | Date
  | RegExp
  | ((...args: never[]) => unknown);

/**
 * `Readonly`, applied all the way down.
 *
 * A shallow `Readonly<D>` only stops `org.tags = […]`; it leaves
 * `org.tags.push(…)` a legal expression, because `z.infer` of
 * `z.array(Tag)` is `Tag[]`, not `readonly Tag[]`. That is the type-level
 * half of the immutability hole this closes — the runtime half is the deep
 * freeze in `freeze.ts`.
 *
 * The mapped type is homomorphic (`[K in keyof T]` over a naked `T`), which
 * is what makes it preserve optional keys (`k?: T` stays optional rather than
 * widening to `k: T | undefined`) and array/tuple-ness: mapping an array type
 * yields `readonly U[]`, and a tuple stays a tuple.
 *
 * The conditional distributes over unions, deliberately and unlike the
 * tuple-wrapped tests elsewhere in this module: a `A | B` field must become
 * `DeepReadonly<A> | DeepReadonly<B>`, since testing the union as a whole
 * would send a mixed `string | { … }` down the mapped-type branch and mangle
 * the string.
 */
export type DeepReadonly<T> = T extends Immutable
  ? T
  : { readonly [K in keyof T]: DeepReadonly<T[K]> };

/**
 * What `update` accepts: a partial of the stored data, minus the immutable
 * fields — and minus `keyof A`, because a computed field is derived, not
 * supplied. `update` re-runs every derivation like any other construction
 * path, so a patched value would only be overwritten by the next one.
 */
export type PatchOf<
  S extends Fields,
  A extends Fields,
  I extends readonly (keyof DecodedOf<S, A>)[],
> = Partial<Omit<DecodedOf<S, A>, I[number] | keyof A>>;

/**
 * The field *schemas* `updateInput` is built from: the decoded field map
 * (`S & A`, the same construction `EntityStatic["decoded"]`
 * uses), minus the immutable keys and minus `keyof A` — the computed fields are
 * implicitly immutable, see `PatchOf` — with every remaining schema wrapped in
 * `ZodOptional` — the type-level mirror of what `.omit(...).partial()`
 * produces at runtime. A mapped object type rather than the `Fields` index
 * signature, so `Organization.updateInput.shape.name` is a named property
 * access, not one this repo's `noPropertyAccessFromIndexSignature` rejects.
 */
export type UpdateInputShapeOf<
  S extends Fields,
  A extends Fields,
  I extends readonly (keyof DecodedOf<S, A>)[],
> = {
  [Key in Exclude<keyof (S & A), I[number] | keyof A>]: z.ZodOptional<(S & A)[Key]>;
};

/**
 * A type-level construction lock. `CtorKey` never leaves this module, so no
 * outside code can name it and therefore cannot produce a value assignable to
 * `Sealed<D>`. This closes the constructor without a runtime check, which
 * `unthrown/no-throw` forbids.
 *
 * A literal `protected constructor` was measured and does not work: TypeScript
 * refuses to assign a protected-constructor class to any construct signature,
 * so the statics could only return the base class rather than the subclass.
 *
 * Depends on `declaration: false` in the shared tsconfig: with declaration
 * emit on, TS4020 rejects an exported class whose `extends` clause uses this
 * private name.
 */
declare const CtorKey: unique symbol;
export type Sealed<D> = D & { readonly [CtorKey]: true };

/**
 * The instance-side shape every entity's `Base` class structurally has: the
 * three prototype methods that survive `Omit<Base, "update">`, plus `update`
 * itself. `update` is typed with polymorphic `this` — the same mechanism
 * `decode`/`make`/`create` use on the static side — so `org.update(...)`
 * yields the *subclass* (`Organization`, with its `_tag` and class-body
 * members intact), not the structural `BaseInstance` shape. Expressed
 * independently of any concrete `Base` class — see `EntityStatic` for why.
 */
// A `type` alias object literal does not qualify as "a class or interface" for
// TS2526 purposes, so `update`'s polymorphic `this` return (the same mechanism
// `ConstructedInstance` below relies on) requires a real `interface` here —
// converting this one to a `type` reintroduces exactly the TS2526 this
// package's other `interface`-avoidance already worked around elsewhere.
// oxlint-disable-next-line typescript/consistent-type-definitions
interface BaseInstance<
  S extends Fields,
  A extends Fields,
  I extends readonly (keyof DecodedOf<S, A>)[],
> {
  toJSON(): DecodedOf<S, A>;
  equals(other: unknown): boolean;
  update(patch: PatchOf<S, A, I>): Result<this, InvalidEntity>;
}

/**
 * The instance type a `new (...)` construct signature yields — `BaseInstance`
 * plus the data fields and the runtime-only `_tag`. Named as its own
 * interface (rather than inlined at the `new` signature) purely so `this` in
 * `update`'s inherited signature has "a non-static member of a class or
 * interface" to attach to: TypeScript rejects a polymorphic `this` inside an
 * anonymous type literal (TS2526), even one used as a construct signature's
 * return type.
 *
 * The data half is `DeepReadonly`, not `Readonly`: a shallow `Readonly` would
 * type an array field as a mutable `Tag[]`, so `entity.tags.push(…)` would
 * compile and — before the constructor started deep-freezing — mutate stored
 * data, defeating an invariant that had already been checked. `toJSON()` keeps
 * returning the plain `DecodedOf` shape: it builds a fresh object, so its own
 * keys really are assignable.
 */
type ConstructedInstance<
  Tag extends string,
  S extends Fields,
  A extends Fields,
  I extends readonly (keyof DecodedOf<S, A>)[],
> = BaseInstance<S, A, I> &
  DeepReadonly<DecodedOf<S, A>> & {
    readonly _tag: Tag;
  };

/**
 * The full static surface `Entity(tag)(fields, options?)` returns.
 *
 * Named here, in `entity.ts`'s companion types module, rather than left as
 * the inline `Base as unknown as {…}` cast at the end of the builder, so it
 * can double as the builder's *explicit* return-type annotation, and so the
 * package's exported helper types (`Encoded`, `Decoded`, `CreateInput`,
 * `Patch`) have a single surface to read the shapes off. This is why every
 * member below is expressed from `S`/`A`/`G`/`I`/`Tag` alone instead of
 * the builder's body-local `Base`/`encoded`/`decoded`/etc. — those aren't in
 * scope at the annotation position, before the body that declares them.
 */
export type EntityStatic<
  Tag extends string,
  S extends Fields,
  A extends Fields,
  G extends readonly (keyof S)[],
  I extends readonly (keyof DecodedOf<S, A>)[],
> = {
  new (d: Sealed<DecodedOf<S, A>>): ConstructedInstance<Tag, S, A, I>;
  readonly entityName: Tag;
  readonly encoded: z.ZodObject<S>;
  readonly decoded: z.ZodObject<S & A>;
  readonly createInput: z.ZodObject<Omit<S, G[number]>>;
  readonly updateInput: z.ZodObject<UpdateInputShapeOf<S, A, I>>;
  /**
   * At runtime `X.instance.parse(...)` yields an actual `X` — `attachInstance`
   * (see `instance.ts`) reads the receiver, which JS's prototype-based static
   * inheritance sets to whichever subclass `.instance` was read from. The type
   * cannot say that: unlike a *method*, a property can't take an explicit
   * `this` parameter to infer the receiver's type from the call site (the
   * trick `decode`/`make`/`create` and `update` use), and a `this` type
   * written directly in the property's type does not repolymorphize per
   * subclass on a *static* member the way it does for instance members — this
   * was measured, not assumed: `Y extends X {}` still narrows `Y.instance` to
   * `X`'s shape. So `instance` is typed as the base shape only; a caller who
   * needs the subclass's own members back must narrow explicitly (e.g.
   * `instanceof`) after parsing.
   */
  readonly instance: z.ZodType<BaseInstance<S, A, I> & DeepReadonly<DecodedOf<S, A>>>;
  readonly "~standard": z.ZodType<
    BaseInstance<S, A, I> & DeepReadonly<DecodedOf<S, A>>
  >["~standard"];
  /** phantom carriers, so consumers can recover the shapes for annotations */
  readonly __encoded: EncodedOf<S>;
  readonly __decoded: DecodedOf<S, A>;
  readonly __createInput: CreateInputOf<S, G>;
  readonly __patch: PatchOf<S, A, I>;
  decode<T>(this: new (d: Sealed<DecodedOf<S, A>>) => T, raw: unknown): Result<T, InvalidEntity>;
  make<T>(this: new (d: Sealed<DecodedOf<S, A>>) => T, state: unknown): Result<T, InvalidEntity>;
  factory<T>(
    this: new (d: Sealed<DecodedOf<S, A>>) => T,
    generators: Generators<S, G>,
  ): EntityFactory<T, S, G>;
  factoryAsync<T>(
    this: new (d: Sealed<DecodedOf<S, A>>) => T,
    generators: AsyncGenerators<S, G>,
  ): AsyncEntityFactory<T, S, G>;
};

/**
 * How a factory supplies each domain-generated field. Functions, never values:
 * each is called once per `create`, so a factory built at the composition root
 * yields a fresh id and timestamp every time.
 */
export type Generators<S extends Fields, G extends readonly (keyof S)[]> = {
  [K in keyof GeneratedOf<S, G>]: () => GeneratedOf<S, G>[K];
};

export type AsyncGenerators<S extends Fields, G extends readonly (keyof S)[]> = {
  [K in keyof GeneratedOf<S, G>]: () => PromiseLike<GeneratedOf<S, G>[K]>;
};

/** An entity bound to its effect sources. `create` is the only member: nothing
 * else consumes generators, and `make`/`decode` stay on the class. */
export type EntityFactory<T, S extends Fields, G extends readonly (keyof S)[]> = {
  create(input: CreateInputOf<S, G>): Result<T, InvalidEntity>;
};

export type AsyncEntityFactory<T, S extends Fields, G extends readonly (keyof S)[]> = {
  create(input: CreateInputOf<S, G>): AsyncResult<T, InvalidEntity>;
};
