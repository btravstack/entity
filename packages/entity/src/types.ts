import type { AsyncResult, Result } from "unthrown";
import type { z } from "zod";

import type { ComputedField as ComputedFieldOf } from "./computed.js";
import type { InvalidEntity } from "./errors.js";
import type { FieldSpec, Flags } from "./field.js";
import type { Invariant as InvariantOf } from "./invariant.js";
import type { OnlyNominal } from "./shape.js";

/**
 * A field-map entry: a schema, or `Entity.field`'s schema-plus-flags.
 *
 * `z.core.$ZodType`, not `z.ZodTypeAny`: an entity class carries only zod's
 * internal slots, not the full method surface, and must be usable as a field.
 * Anything zod accepts in an object shape is accepted here.
 */
export type Entry = z.core.$ZodType | FieldSpec<z.core.$ZodType, Flags>;
export type Fields = Record<string, Entry>;

/**
 * A plain schema map. The *computed* map stays this, never `Fields`: unwrapping
 * `A[K]` in inference position was measured to make `A` uninferrable, so it fell
 * back to its constraint and every computed key degraded to an index signature
 * (TS4111, `Property 'shout' comes from an index signature`). An inline
 * `Entity.field(...)` computed is impossible anyway — see `computed.ts`.
 */
export type Schemas = Record<string, z.core.$ZodType>;

/** The schema behind an entry, flagged or bare. */
export type SchemaOf<E> = E extends FieldSpec<infer T, Flags> ? T : E;
export type SchemasOf<S extends Fields> = { [K in keyof S]: SchemaOf<S[K]> };

/**
 * The keys whose entries carry each flag. Matched on the `flags` property
 * rather than on `FieldSpec<…, {…}>` — the `Flags` constraint rejects a
 * partial literal in extends position (measured, TS2344-class).
 *
 * These are computed INSIDE `EntityStatic`/`AbstractEntity`/`BaseInstance`,
 * never passed as type arguments: in argument position the printer re-carries
 * the whole field map (the spike's +58%), and de-aliasing is impossible —
 * alias annotation, defaulted parameter + `infer`, and mapped-object+`keyof`
 * were all measured to reconstitute the alias via union-origin tracking, on
 * both 7.0.2 and 5.9.3. Inside a body, `S` prints by name and the map appears
 * once. Do not move these into a parameter list.
 */
export type GeneratedKeys<S extends Fields> = {
  [K in keyof S]: S[K] extends { readonly flags: { readonly generated: true } } ? K : never;
}[keyof S] &
  PropertyKey;
export type ImmutableKeys<S extends Fields> = {
  [K in keyof S]: S[K] extends { readonly flags: { readonly immutable: true } } ? K : never;
}[keyof S] &
  PropertyKey;

/** The data an entity accepts on the wire. */
export type InputOf<S extends Fields> = z.infer<z.ZodObject<SchemasOf<S>>>;

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
export type ComputedOf<A extends Schemas> = [keyof A] extends [never]
  ? Record<never, never>
  : z.infer<z.ZodObject<A>>;

/**
 * What the entity stores and returns: the declared fields plus the computed
 * ones. There is deliberately no `_tag` — the tag is a
 * non-enumerable instance property and never part of the data.
 */
export type OutputOf<S extends Fields, A extends Schemas> = InputOf<S> & ComputedOf<A>;

/** What `create` accepts from a caller: everything the domain does not generate. */
export type CreateInputOf<S extends Fields, G extends PropertyKey> = Omit<InputOf<S>, G>;

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
export type PatchOf<S extends Fields, A extends Schemas, I extends PropertyKey> = Partial<
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
export type UpdateInputShapeOf<S extends Fields, A extends Schemas, I extends PropertyKey> = {
  [Key in Exclude<keyof (S & A), I | keyof A>]: z.ZodOptional<SchemaOf<(S & A)[Key]>>;
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
export interface BaseInstance<S extends Fields, A extends Schemas> {
  toJSON(): DeepReadonly<OutputOf<S, A>>;
  equals(other: unknown): boolean;
  update(patch: PatchOf<S, A, ImmutableKeys<S>>): Result<this, InvalidEntity>;
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
type ConstructedInstance<Tag extends string, S extends Fields, A extends Schemas> = BaseInstance<
  S,
  A
> &
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
export type RootInstance<S extends Fields, A extends Schemas> = ConstructedInstance<string, S, A>;

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
 * A root's computed map merged with a variant's — what `extend` hands
 * `EntityStatic` as its `A`.
 *
 * `Omit<A, keyof A2> & A2`, never `A & A2`: the runtime spread lets a variant's
 * computed key win, and a plain intersection would type a redefined key as
 * `Upper & Lower` while the value is `Lower`.
 *
 * Named rather than written inline at `extend`'s return type, which was measured
 * to emit a dangling reference: with `A = Record<never, never>` — a root
 * declaring no `computed`, which is the default — TypeScript 5.9.3 wrote the
 * *unsubstituted* `Omit<Record<never, never>, keyof A2> & Record<never, never>`
 * into the consumer's `.d.ts`, where the consumer's own compiler rejected it
 * with `TS2304: Cannot find name 'A2'`. TypeScript 7.0.2 substitutes the same
 * position correctly. Naming it is only half the fix: the emitter writes the
 * *name* only because `index.ts` exports it, and unexporting it was measured to
 * expand the alias structurally and bring the identical dangling `A2` straight
 * back. See the export list there, and do not un-export it.
 *
 * The *fields* half of the same merge is `MergedFields`, below.
 */
export type MergedComputed<A extends Schemas, A2 extends Schemas> = Omit<A, keyof A2> & A2;

/**
 * A root's field map merged with a variant's — what `extend` hands
 * `EntityStatic` as its `S`.
 *
 * `Omit<S, keyof S2> & S2`, never `S & S2`, for `MergedComputed`'s reason one
 * map over: the runtime spread is `{ ...parent.fields, ...nextFields }`, so a
 * variant redeclaring an inherited field wins, and a plain intersection would
 * type that key as `ZodBranded<Parent> & ZodBranded<Child>` while the schema
 * held is the child's alone.
 *
 * Named and exported from the start for the reason **measured** on
 * `MergedComputed`: written inline, the 5.9.3 emitter copied that alias's `A2`
 * through unsubstituted and consumers failed with `TS2304`. This is the same
 * alias in the same position, so it was never written inline here and the
 * `S2` spelling of that failure has not been observed — it is inferred from the
 * `A2` one, not a second measurement. See the export list in `index.ts`, and do
 * not un-export it.
 *
 * Serialised width was the recorded reason this half was deferred, since every
 * variant pays it where `MergedComputed` is paid only by one declaring
 * `computed`. Measured rather than assumed: the emitter writes the alias **by
 * reference**, so the billing fixture's `index.d.ts` grew 10,061 → 10,145 bytes
 * — 42 per variant, against the 274,048 an unnamed type expands to — and all
 * four `typecheck` steps stayed clean on both compilers. The `TS7056` budget is
 * serialised characters, and a named alias barely spends it.
 *
 * `NoRedeclaredKeys` now forbids `keyof S ∩ keyof S2` outright, so the
 * child-wins branch here is unreachable at compile time; the alias stays as
 * the runtime-honest spelling, and `base.test-d.ts` guards the rejection
 * itself rather than the merge's resolution, in case the forbid ever loosens.
 */
export type MergedFields<S extends Fields, S2 extends Fields> = Omit<S, keyof S2> & S2;

/** The error message is the type name, same trick as `shape.ts`'s rejections. */
type FieldAlreadyDeclaredByTheRoot = { readonly __fieldAlreadyDeclaredByTheRoot: never };

/** Rejects any `S2` key the root `S` already declares, flagged or not. */
type NoRedeclaredKeys<S extends Fields, S2 extends Fields> = {
  [K in keyof S2]: K extends keyof S ? FieldAlreadyDeclaredByTheRoot : S2[K];
};

/**
 * What `Entity.abstract(name)(fields, options?)` returns.
 *
 * Deliberately not an entity: no `make`, no `factory`, no schema members. The
 * absence of a tag is what lets `extend` intersect the receiver's instance type
 * unmapped — see `RootInstance`. `name` labels the root in its defect message
 * and never reaches an instance.
 */
export type AbstractEntity<Name extends string, S extends Fields, A extends Schemas> = {
  new (d: Sealed<OutputOf<S, A>>): RootInstance<S, A>;
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
  ): <S2 extends Fields, A2 extends Schemas = Record<never, never>>(
    fields: S2 & OnlyNominal<S2> & NoRedeclaredKeys<S, S2>,
    options?: {
      readonly computed?: {
        [K in keyof A2]: ComputedFieldOf<A2[K], InputOf<MergedFields<S, S2>>>;
      };
      readonly invariants?: readonly InvariantOf<InputOf<MergedFields<S, S2>>>[];
    },
  ) => EntityStatic<Tag2, MergedFields<S, S2>, MergedComputed<A, A2>, BehaviourOf<This>>;
};

/**
 * The full static surface `Entity(tag)(fields, options?)` returns.
 *
 * Named here, in `entity.ts`'s companion types module, rather than left as
 * the inline `Base as unknown as {…}` cast at the end of the builder, so it
 * can double as the builder's *explicit* return-type annotation, and so the
 * package's exported helper types (`Input`, `Output`, `CreateInput`,
 * `Patch`) have a single surface to read the shapes off. This is why every
 * member below is expressed from `S`/`A`/`Tag` alone instead of
 * the builder's body-local `Base`/`input`/`output`/etc. — those aren't in
 * scope at the annotation position, before the body that declares them.
 *
 * There are no `G`/`I` parameters: the key unions are computed inside the
 * body from the flags `S` carries — see `GeneratedKeys` for why they must
 * never move into a parameter list.
 */
export type EntityStatic<
  Tag extends string,
  S extends Fields,
  A extends Schemas,
  // What the abstract root's class body contributed, or nothing. Defaulted so
  // the plain `Entity(tag)(fields)` spelling stays three arguments.
  //
  // A fourth parameter lengthens every serialised instance type, which is the
  // `TS7056` budget — the ceiling `index.ts` records two shipped build failures
  // against, and the one 5.9.3 hits sooner than 7.0.2 does. The clean
  // two-compiler pass on `examples/billing-domain` was measured at the old
  // six-parameter arity; this four-parameter shape must be re-measured by that
  // same gate before it counts as clean. The headroom it spends is the
  // `_zod` / `~standard` slots below naming `ConstructedInstance<Tag, S, A> & B`
  // instead of spelling that intersection out a second and third time — same
  // type, fewer serialised characters. Widening this further means re-running
  // that pass.
  B = Record<never, never>,
> = {
  new (d: Sealed<OutputOf<S, A>>): ConstructedInstance<Tag, S, A> & B;
  readonly entityName: Tag;
  readonly input: z.ZodObject<SchemasOf<S>>;
  readonly output: z.ZodObject<SchemasOf<S> & A>;
  readonly createInput: z.ZodObject<Omit<SchemasOf<S>, GeneratedKeys<S>>>;
  readonly updateInput: z.ZodObject<UpdateInputShapeOf<S, A, ImmutableKeys<S>>>;
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
  readonly _zod: z.ZodType<ConstructedInstance<Tag, S, A> & B>["_zod"];
  readonly "~standard": z.ZodType<ConstructedInstance<Tag, S, A> & B>["~standard"];
  /** phantom carriers, so consumers can recover the shapes for annotations */
  readonly __input: InputOf<S>;
  readonly __output: OutputOf<S, A>;
  readonly __createInput: CreateInputOf<S, GeneratedKeys<S>>;
  readonly __patch: PatchOf<S, A, ImmutableKeys<S>>;
  /** the instance type, read by `Entity.Instance` */
  readonly __instance: ConstructedInstance<Tag, S, A> & B;
  make<T>(this: new (d: Sealed<OutputOf<S, A>>) => T, state: unknown): Result<T, InvalidEntity>;
  // No `extend`. An entity is final — extension lives on `AbstractEntity`,
  // which is tagless and can therefore carry behaviour. See `BehaviourOf`.
  factory<T>(
    this: new (d: Sealed<OutputOf<S, A>>) => T,
    generators: Generators<S, GeneratedKeys<S>>,
  ): EntityFactory<T, S, GeneratedKeys<S>>;
  factoryAsync<T>(
    this: new (d: Sealed<OutputOf<S, A>>) => T,
    generators: AsyncGenerators<S, GeneratedKeys<S>>,
  ): AsyncEntityFactory<T, S, GeneratedKeys<S>>;
};

/**
 * How a factory supplies each domain-generated field. Functions, never
 * values: each is called once per `create`, so a factory built at the
 * composition root yields a fresh id and timestamp every time.
 *
 * Each generator returns the field schema's **`z.input`**, not the parsed
 * output (`InputOf` — despite its name — is `z.infer`, the branded shape):
 * generated values are spread into `make`, which validates them like any
 * other caller data, so demanding the branded form only forced an `as` cast
 * that `make` then re-proved.
 *
 * Mapped with key remapping rather than `Pick`, because TypeScript cannot
 * prove `G` satisfies `keyof S` through zod's inference chain — the builders
 * constrain the real call sites, and this type only has to survive them.
 */
export type Generators<S extends Fields, G extends PropertyKey> = {
  [K in keyof S as K extends G ? K : never]: () => z.input<SchemaOf<S[K]>>;
};

export type AsyncGenerators<S extends Fields, G extends PropertyKey> = {
  [K in keyof S as K extends G ? K : never]: () => PromiseLike<z.input<SchemaOf<S[K]>>>;
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
