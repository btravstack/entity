// One name to write against. `computed`, `union`, `InvalidEntity` and every
// type hang off it — see the grouping comment in entity.ts.
export { Entity } from "./entity.js";

// Not part of the API you write against, and not reachable as `Entity.*` for
// this purpose: a downstream library compiling with `declaration: true` emits
// `class X extends Entity("X")(…)`, and TypeScript writes the *underlying*
// type into that declaration rather than the namespace path that aliases it.
// Unexported, they are private names, and the consumer fixture fails with
// `TS4020` / `TS4094`. They must stay top-level exports of the built `d.mts`.
// `Entity.BaseInstance` and friends exist too, for anyone annotating by hand.
//
// `EntityStatic` is here for the same reason and one more: it is what the whole
// builder returns, so with no name to write, TypeScript serialises the entire
// static surface — construct signature, four `ZodObject`s, both zod slots, four
// phantom carriers, `make`/`extend`/`factory` — structurally into every
// consumer's `.d.ts`, repeating the field map a dozen times over. Measured: a
// **one-field** entity emitted a 274,048-byte declaration; exporting the name
// took it to 240. That expansion was two reported build failures, not a size
// curiosity — a realistic domain enum crossed TypeScript's serialisation
// ceiling (`TS7056`, #31), and a branded *object* field was expanded through
// `DeepReadonly` until zod's module-private `$brand` symbol reached
// computed-key position and could not be named (`TS4020`, #32). Emitting
// `EntityStatic<…>` by reference fixes both. Do not un-export it.
//
// `MergedComputed` joins them for a narrower reason, measured the same way: it
// is the third type argument `extend` hands to `EntityStatic`, and written
// inline as `Omit<A, keyof A2> & A2` the 5.9.3 emitter copied the type parameter
// `A2` through unsubstituted, leaving `TS2304: Cannot find name 'A2'` in the
// consumer's own `.d.ts`. 7.0.2 substitutes the same position correctly, so only
// downstream builds saw it. **Both halves are load bearing, and the export is
// not the cosmetic half.** Measured by unexporting it and re-running the fixture
// against a root declaring no `computed`: the emitter expands the alias
// structurally again and the identical dangling `A2` comes back, `TS2304` and
// all. Naming it without exporting it fixes nothing. Do not un-export it.
//
// `MergedFields` is that alias for the *field* map — the second type argument —
// and carries the identical hazard with `S2` in place of `A2`. It was named and
// exported from the start rather than measured into existence a second time.
export type {
  BaseInstance,
  ConstructionKey,
  EntityStatic,
  MergedComputed,
  MergedFields,
  Sealed,
} from "./types.js";

// Same story as `EntityStatic`: a consumer writing
// `abstract class X extends Entity.abstract("X")(…) {}` emits the *underlying*
// name into its declarations, not the `Entity.Abstract` path that aliases it.
export type { AbstractEntity } from "./types.js";

// `Entity.union(...)` assigned to an exported `const` is the same story one
// type further along: with no top-level name for what it returns, TypeScript
// expands the union's members structurally and reaches zod's module-private
// `$brand` through any branded field, failing with `TS4023: Exported variable
// 'X' has or is using name '$brand' … but cannot be named`. `UnionMember`
// travels with it — it is `EntityUnion`'s own constraint, so the reference is
// unusable without it.
export type { EntityUnion, UnionMember } from "./union.js";
