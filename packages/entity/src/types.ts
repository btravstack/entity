import type { AsyncResult, Result } from "unthrown";
import type { z } from "zod";

import type { ComputedField as ComputedFieldOf } from "./computed.js";
import type { InvalidEntity } from "./errors.js";
import type { Invariant as InvariantOf } from "./invariant.js";
import type { OnlyNominal } from "./shape.js";

/**
 * A field map's values. `z.core.$ZodType`, not `z.ZodTypeAny`: an entity class
 * carries only zod's internal slots, not the full method surface, and must be
 * usable as a field. Anything zod accepts in an object shape is accepted here.
 */
export type Fields = Record<string, z.core.$ZodType>;

/** The data an entity accepts on the wire. */
export type InputOf<S extends Fields> = z.infer<z.ZodObject<S>>;

/**
 * The values the computed fields contribute.
 *
 * Zod's `$InferObjectOutput` special-cases an *empty* shape to
 * `Record<string, never>` — a real index signature, not `{}`. Unguarded, that
 * makes an option-less entity's output type read as "any string key, valued
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
export type OutputOf<S extends Fields, A extends Fields> = InputOf<S> & ComputedOf<A>;

/** What `create` accepts from a caller: everything the domain does not generate. */
export type CreateInputOf<S extends Fields, G extends PropertyKey> = Omit<InputOf<S>, G>;

/**
 * What `create` requires the use case to supply.
 *
 * `Pick` constrains its second parameter to `keyof T`, and TypeScript cannot
 * prove `G` — which is `keyof S` — satisfies `keyof InputOf<S>`
 * through zod's inference chain. This mapped type with key remapping achieves
 * the same semantics. `CreateInputOf` uses `Omit` (no such constraint);
 * `GeneratedOf` uses this mapped form for that reason. The same unprovable
 * subset relation is why `G` is a key union and not a tuple: the accumulating
 * `readonly [...G, ...G2]` spelling is rejected with `TS2344`.
 */
export type GeneratedOf<S extends Fields, G extends PropertyKey> = {
  [K in keyof InputOf<S> as K extends G ? K : never]: InputOf<S>[K];
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
export type PatchOf<S extends Fields, A extends Fields, I extends PropertyKey> = Partial<
  Omit<OutputOf<S, A>, I | keyof A>
>;

/**
 * The field *schemas* `updateInput` is built from: the output field map
 * (`S & A`, the same construction `EntityStatic["output"]`
 * uses), minus the immutable keys and minus `keyof A` — the computed fields are
 * implicitly immutable, see `PatchOf` — with every remaining schema wrapped in
 * `ZodOptional` — the type-level mirror of what `.omit(...).partial()`
 * produces at runtime. A mapped object type rather than the `Fields` index
 * signature, so `Organization.updateInput.shape.name` is a named property
 * access, not one this repo's `noPropertyAccessFromIndexSignature` rejects.
 */
export type UpdateInputShapeOf<S extends Fields, A extends Fields, I extends PropertyKey> = {
  [Key in Exclude<keyof (S & A), I | keyof A>]: z.ZodOptional<(S & A)[Key]>;
};

/**
 * A type-level construction lock: no outside code can produce a value
 * assignable to `Sealed<D>`, so `new SomeEntity(...)` does not compile. It
 * closes the constructor without a runtime check, which `unthrown/no-throw`
 * forbids.
 *
 * `ConstructionKey` is **exported but unconstructable** — a private
 * constructor and a private field make it unforgeable structurally, and it has
 * no runtime existence at all. Exporting it is what lets a *consumer* compile:
 *
 * A `declare const CtorKey: unique symbol` kept module-private was measured to
 * break every downstream library that emits declarations —
 * `TS4020: 'extends' clause of exported class 'Organization' has or is using
 * private name 'CtorKey'` — because a `unique symbol` in computed-key position
 * cannot be named across a module boundary even when exported. An ordinary
 * named property whose *type* is an exported class can, so the emitted `.d.ts`
 * references it as `import("@btravstack/entity").Sealed<…>`.
 *
 * A literal `protected constructor` was measured and does not work either:
 * TypeScript refuses to assign a protected-constructor class to any construct
 * signature (TS2684), so the statics could only return the base class rather
 * than the subclass. `private` is worse still — TS2675, the declaration form
 * `class X extends Entity("X")(...)` stops compiling outright.
 */
export declare class ConstructionKey {
  private constructor();
  private readonly seal: never;
}
// The property name is the error message: `new SomeEntity(…)` fails with
// "Property '__useMakeOrFactoryInstead' is missing…", which tells the reader
// what to do — the same trick `shape.ts` plays with its rejection type names.
export type Sealed<D> = D & { readonly __useMakeOrFactoryInstead: ConstructionKey };

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
export interface BaseInstance<S extends Fields, A extends Fields, I extends PropertyKey> {
  toJSON(): DeepReadonly<OutputOf<S, A>>;
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
 * data, defeating an invariant that had already been checked. `toJSON()` is
 * `DeepReadonly` too: its top-level object is fresh, but the projection is
 * shallow, so every nested container is one of these same frozen fields.
 */
type ConstructedInstance<
  Tag extends string,
  S extends Fields,
  A extends Fields,
  I extends PropertyKey,
> = BaseInstance<S, A, I> &
  DeepReadonly<OutputOf<S, A>> & {
    readonly _tag: Tag;
  };

/**
 * The instance an `Entity.abstract(...)` root describes.
 *
 * `_tag` is widened to `string` rather than omitted, so shared behaviour can
 * read it — and widening is what makes the root work at all. A `Tag` literal
 * here collapses `extend`'s intersection: `"Account" & "Personal"` reduces to
 * `never`, and TypeScript then rejects the whole base-constructor return type
 * (TS2509). `string & "Personal"` reduces to `"Personal"`, which is exactly
 * what the variant needs.
 */
export type RootInstance<S extends Fields, A extends Fields, I extends PropertyKey> = BaseInstance<
  S,
  A,
  I
> &
  DeepReadonly<OutputOf<S, A>> & { readonly _tag: string };

/**
 * Whatever the receiver's own class body added, carried **unmapped**.
 *
 * Unmapped is load bearing. `Omit<R, …>` and the key-remapped
 * `{ [K in keyof R as …]: R[K] }` both turn a method into a function-typed
 * property, and a variant implementing an abstract method then fails with
 * `TS2425: … defines instance member property 'describe', but extended class
 * 'Personal' defines it as instance member function`. Both spellings were
 * measured. Nothing may be subtracted here — the root is tagless precisely so
 * that nothing needs to be.
 */
export type BehaviourOf<This> = This extends abstract new (...args: never[]) => infer R
  ? R
  : Record<never, never>;

/**
 * What `Entity.abstract(name)(fields, options?)` returns.
 *
 * Deliberately not an entity: no `make`, no `factory`, no schema members. The
 * absence of a tag is what lets `extend` intersect the receiver's instance type
 * unmapped — see `RootInstance`. `name` labels the root in its defect message
 * and never reaches an instance.
 */
export type AbstractEntity<
  Name extends string,
  S extends Fields,
  A extends Fields,
  G extends PropertyKey,
  I extends PropertyKey,
> = {
  new (d: Sealed<OutputOf<S, A>>): RootInstance<S, A, I>;
  readonly entityName: Name;
  /**
   * A new entity carrying this root's fields plus more, under its own tag, and
   * inheriting the **instance** half of the class body of whatever it was
   * called on: its methods and accessors, but not its statics and not its field
   * initialisers. `extend` rewires the instance prototype and nothing else, so
   * a root's constructor never runs — see `docs/reference/declaration.md`.
   *
   * The `this` parameter is what picks up a behaviour-only intermediate root:
   * `abstract class Auditable extends AccountBase { … }` then
   * `Auditable.extend(...)` carries both bodies.
   */
  extend<This, Tag2 extends string>(
    this: This,
    tag: Tag2,
  ): <
    S2 extends Fields,
    A2 extends Fields = Record<never, never>,
    const G2 extends readonly (keyof (S & S2))[] = [],
    const I2 extends readonly (keyof OutputOf<S & S2, Omit<A, keyof A2> & A2>)[] = [],
  >(
    fields: S2 & OnlyNominal<S2>,
    options?: {
      readonly generated?: G2;
      readonly immutable?: I2;
      readonly computed?: { [K in keyof A2]: ComputedFieldOf<A2[K], InputOf<S & S2>> };
      readonly invariants?: readonly InvariantOf<InputOf<S & S2>>[];
    },
    // `Omit<A, keyof A2> & A2`, never `A & A2`: the runtime spread lets a
    // variant's computed key win, and a plain intersection would type a
    // redefined key as `Upper & Lower` while the value is `Lower`.
  ) => EntityStatic<
    Tag2,
    S & S2,
    Omit<A, keyof A2> & A2,
    G | G2[number],
    I | I2[number],
    BehaviourOf<This>
  >;
};

/**
 * The full static surface `Entity(tag)(fields, options?)` returns.
 *
 * Named here, in `entity.ts`'s companion types module, rather than left as
 * the inline `Base as unknown as {…}` cast at the end of the builder, so it
 * can double as the builder's *explicit* return-type annotation, and so the
 * package's exported helper types (`Input`, `Output`, `CreateInput`,
 * `Patch`) have a single surface to read the shapes off. This is why every
 * member below is expressed from `S`/`A`/`G`/`I`/`Tag` alone instead of
 * the builder's body-local `Base`/`input`/`output`/etc. — those aren't in
 * scope at the annotation position, before the body that declares them.
 */
export type EntityStatic<
  Tag extends string,
  S extends Fields,
  A extends Fields,
  // `G`/`I` are unions of keys, not tuples. The tuple form cannot express the
  // merge: `readonly [...I, ...I2]` is rejected with `TS2344`, because
  // TypeScript will not prove the parent's key set is a subset of the child's
  // through zod's inference chain. Measured — see `GeneratedOf` for the same
  // failure in its `Pick` form.
  G extends PropertyKey,
  I extends PropertyKey,
  // What the abstract root's class body contributed, or nothing. Defaulted so
  // every existing five-argument spelling keeps compiling.
  //
  // A sixth parameter lengthens every serialised instance type, which is the
  // `TS7056` budget — the ceiling `index.ts` records two shipped build failures
  // against, and the one 5.9.3 hits sooner than 7.0.2 does. It was measured,
  // not assumed: `examples/billing-domain`'s two-compiler declaration pass
  // emits clean on both TypeScript 7.0.2 and 5.9.3 with this arity, no
  // `TS7056` from either. The headroom it spends is the `_zod` / `~standard`
  // slots below naming `ConstructedInstance<Tag, S, A, I> & B` instead of
  // spelling that intersection out a second and third time — same type, fewer
  // serialised characters. Widening this further means re-running that pass.
  B = Record<never, never>,
> = {
  new (d: Sealed<OutputOf<S, A>>): ConstructedInstance<Tag, S, A, I> & B;
  readonly entityName: Tag;
  readonly input: z.ZodObject<S>;
  readonly output: z.ZodObject<S & A>;
  readonly createInput: z.ZodObject<Omit<S, G>>;
  readonly updateInput: z.ZodObject<UpdateInputShapeOf<S, A, I>>;
  /**
   * The zod slots that make the class itself a schema, so it composes
   * directly: `z.object({ owner: Organization })`, `z.array(Organization)`,
   * or as a field of another entity. Parsing yields a real instance.
   *
   * Only these two are declared, never the full `ZodType`: that would put a
   * throwing `.parse()` on every entity beside `make`, which is the opposite
   * of what this package is for. Wrapping still works through zod's function
   * forms — `z.optional(Organization)` rather than `Organization.optional()`.
   *
   * The runtime binds to whichever class the slot is read from, so a schema
   * built from a subclass yields that subclass. The type cannot say so — a
   * property, unlike a method, takes no `this` parameter to infer the receiver
   * from — so it states the base shape and a caller narrows with `instanceof`.
   */
  readonly _zod: z.ZodType<ConstructedInstance<Tag, S, A, I> & B>["_zod"];
  readonly "~standard": z.ZodType<ConstructedInstance<Tag, S, A, I> & B>["~standard"];
  /** phantom carriers, so consumers can recover the shapes for annotations */
  readonly __input: InputOf<S>;
  readonly __output: OutputOf<S, A>;
  readonly __createInput: CreateInputOf<S, G>;
  readonly __patch: PatchOf<S, A, I>;
  /** the *instance type* of the abstract root this was extended from, read by `Entity.union` */
  readonly __base: B;
  /** the instance type, read by `Entity.Instance` */
  readonly __instance: ConstructedInstance<Tag, S, A, I> & B;
  make<T>(this: new (d: Sealed<OutputOf<S, A>>) => T, state: unknown): Result<T, InvalidEntity>;
  // No `extend`. An entity is final — extension lives on `AbstractEntity`,
  // which is tagless and can therefore carry behaviour. See `BehaviourOf`.
  factory<T>(
    this: new (d: Sealed<OutputOf<S, A>>) => T,
    generators: Generators<S, G>,
  ): EntityFactory<T, S, G>;
  factoryAsync<T>(
    this: new (d: Sealed<OutputOf<S, A>>) => T,
    generators: AsyncGenerators<S, G>,
  ): AsyncEntityFactory<T, S, G>;
};

/**
 * How a factory supplies each domain-generated field. Functions, never values:
 * each is called once per `create`, so a factory built at the composition root
 * yields a fresh id and timestamp every time.
 */
export type Generators<S extends Fields, G extends PropertyKey> = {
  [K in keyof GeneratedOf<S, G>]: () => GeneratedOf<S, G>[K];
};

export type AsyncGenerators<S extends Fields, G extends PropertyKey> = {
  [K in keyof GeneratedOf<S, G>]: () => PromiseLike<GeneratedOf<S, G>[K]>;
};

/**
 * An entity bound to its effect sources: call it with the caller's fields.
 *
 * A plain function rather than an object with one method — nothing else
 * consumes generators, so `.create` was ceremony around the only thing a
 * factory does. `make` stays on the class.
 */
export type EntityFactory<T, S extends Fields, G extends PropertyKey> = (
  input: CreateInputOf<S, G>,
) => Result<T, InvalidEntity>;

export type AsyncEntityFactory<T, S extends Fields, G extends PropertyKey> = (
  input: CreateInputOf<S, G>,
) => AsyncResult<T, InvalidEntity>;
