import type { z } from "zod";

import type { OnlyNominal } from "./shape.js";

export type Flags = { readonly generated: boolean; readonly immutable: boolean };

/**
 * One flagged field: the schema, held — never impersonated. Anything standing
 * in front of an entity-class field breaks `make`, which constructs through
 * `this` (`TypeError: Ctor is not a constructor` — measured), so the spec
 * object is the only shape a marker may take.
 */
export type FieldSpec<T extends z.core.$ZodType, F extends Flags> = {
  readonly schema: T;
  readonly flags: F;
};

/**
 * Declares a field with modifiers, public as `Entity.field`:
 *
 * ```ts
 * id: Entity.field(OrgId, { generated: true, immutable: true }),
 * ```
 *
 * `generated` drops the key from `createInput` and hands it to a factory
 * generator; `immutable` drops it from `updateInput` so `update` refuses it.
 * The flags argument is required — the function exists to flag; an empty
 * object is legal and does nothing.
 */
export function field<T extends z.core.$ZodType, const F extends Partial<Flags>>(
  schema: T & OnlyNominal<{ value: T }>["value"],
  flags: F,
): FieldSpec<
  T,
  {
    generated: F extends { generated: true } ? true : false;
    immutable: F extends { immutable: true } ? true : false;
  }
> {
  return {
    schema: schema as T,
    flags: {
      generated: flags.generated === true,
      immutable: flags.immutable === true,
    } as {
      generated: F extends { generated: true } ? true : false;
      immutable: F extends { immutable: true } ? true : false;
    },
  };
}

/** A field-map entry is a schema, or a schema with flags. */
export const isFieldSpec = (v: unknown): v is FieldSpec<z.core.$ZodType, Flags> =>
  typeof v === "object" && v !== null && "schema" in v && "flags" in v && !("_zod" in v);

export const schemaOf = (entry: unknown): unknown => (isFieldSpec(entry) ? entry.schema : entry);
