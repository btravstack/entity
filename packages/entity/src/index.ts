export { Entity, type CreateInput, type Input, type Output, type Patch } from "./entity.js";
export { computed, type ComputedField } from "./computed.js";
export { InvalidEntity } from "./errors.js";
// Exported only so a consumer's emitted declarations can name them — none of
// the three is part of the API you write against. See `Sealed` in types.ts.
export type { BaseInstance, ConstructionKey, Sealed } from "./types.js";
