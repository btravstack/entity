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
export type { BaseInstance, ConstructionKey, EntityStatic, Sealed } from "./types.js";
