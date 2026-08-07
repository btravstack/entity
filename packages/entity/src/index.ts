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
export type { BaseInstance, ConstructionKey, Sealed } from "./types.js";
