import type { Result } from "unthrown";
import type { z } from "zod";

import type { InvalidEntity } from "./errors.js";

export type Fields = Record<string, z.ZodTypeAny>;

/** The data an entity accepts on the wire. */
export type EncodedOf<S extends Fields> = z.infer<z.ZodObject<S>>;

/**
 * The fields `add` contributes.
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
export type AddedOf<A extends Fields> = [keyof A] extends [never]
  ? Record<never, never>
  : z.infer<z.ZodObject<A>>;

/**
 * What the entity stores and returns: encoded, minus the omitted fields, plus
 * the added ones. There is deliberately no `_tag` — the tag is a
 * non-enumerable instance property and never part of the data.
 */
export type DecodedOf<S extends Fields, A extends Fields, K extends readonly (keyof S)[]> = Omit<
  EncodedOf<S>,
  K[number]
> &
  AddedOf<A>;

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

/** What `update` accepts: a partial of the stored data, minus the immutable fields. */
export type PatchOf<
  S extends Fields,
  A extends Fields,
  K extends readonly (keyof S)[],
  I extends readonly (keyof DecodedOf<S, A, K>)[],
> = Partial<Omit<DecodedOf<S, A, K>, I[number]>>;

/**
 * The field *schemas* `updateInput` is built from: the decoded field map
 * (`Omit<S, K[number]> & A`, the same construction `EntityStatic["decoded"]`
 * uses), minus the immutable keys, with every remaining schema wrapped in
 * `ZodOptional` — the type-level mirror of what `.omit(...).partial()`
 * produces at runtime. A mapped object type rather than the `Fields` index
 * signature, so `Organization.updateInput.shape.name` is a named property
 * access, not one this repo's `noPropertyAccessFromIndexSignature` rejects.
 */
export type UpdateInputShapeOf<
  S extends Fields,
  A extends Fields,
  K extends readonly (keyof S)[],
  I extends readonly (keyof DecodedOf<S, A, K>)[],
> = {
  [Key in Exclude<keyof (Omit<S, K[number]> & A), I[number]>]: z.ZodOptional<
    (Omit<S, K[number]> & A)[Key]
  >;
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
  K extends readonly (keyof S)[],
  I extends readonly (keyof DecodedOf<S, A, K>)[],
> {
  encode(): DecodedOf<S, A, K>;
  toJSON(): DecodedOf<S, A, K>;
  equals(other: unknown): boolean;
  update(patch: PatchOf<S, A, K, I>): Result<this, InvalidEntity>;
}

/**
 * The instance type a `new (...)` construct signature yields — `BaseInstance`
 * plus the data fields and the runtime-only `_tag`. Named as its own
 * interface (rather than inlined at the `new` signature) purely so `this` in
 * `update`'s inherited signature has "a non-static member of a class or
 * interface" to attach to: TypeScript rejects a polymorphic `this` inside an
 * anonymous type literal (TS2526), even one used as a construct signature's
 * return type.
 */
type ConstructedInstance<
  Tag extends string,
  S extends Fields,
  A extends Fields,
  K extends readonly (keyof S)[],
  I extends readonly (keyof DecodedOf<S, A, K>)[],
> = BaseInstance<S, A, K, I> &
  Readonly<DecodedOf<S, A, K>> & {
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
 * member below is expressed from `S`/`A`/`K`/`G`/`I`/`Tag` alone instead of
 * the builder's body-local `Base`/`encoded`/`decoded`/etc. — those aren't in
 * scope at the annotation position, before the body that declares them.
 */
export type EntityStatic<
  Tag extends string,
  S extends Fields,
  A extends Fields,
  K extends readonly (keyof S)[],
  G extends readonly (keyof S)[],
  I extends readonly (keyof DecodedOf<S, A, K>)[],
> = {
  new (d: Sealed<DecodedOf<S, A, K>>): ConstructedInstance<Tag, S, A, K, I>;
  readonly entityName: Tag;
  readonly encoded: z.ZodObject<S>;
  readonly decoded: z.ZodObject<Omit<S, K[number]> & A>;
  readonly createInput: z.ZodObject<Omit<S, G[number]>>;
  readonly updateInput: z.ZodObject<UpdateInputShapeOf<S, A, K, I>>;
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
  readonly instance: z.ZodType<BaseInstance<S, A, K, I> & Readonly<DecodedOf<S, A, K>>>;
  readonly "~standard": z.ZodType<
    BaseInstance<S, A, K, I> & Readonly<DecodedOf<S, A, K>>
  >["~standard"];
  /** phantom carriers, so consumers can recover the shapes for annotations */
  readonly __encoded: EncodedOf<S>;
  readonly __decoded: DecodedOf<S, A, K>;
  readonly __createInput: CreateInputOf<S, G>;
  readonly __patch: PatchOf<S, A, K, I>;
  decode<T>(this: new (d: Sealed<DecodedOf<S, A, K>>) => T, raw: unknown): Result<T, InvalidEntity>;
  make<T>(this: new (d: Sealed<DecodedOf<S, A, K>>) => T, state: unknown): Result<T, InvalidEntity>;
  create<T>(
    this: new (d: Sealed<DecodedOf<S, A, K>>) => T,
    input: CreateInputOf<S, G>,
    generated: GeneratedOf<S, G>,
  ): Result<T, InvalidEntity>;
};
