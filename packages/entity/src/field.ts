import type { z } from "zod";

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

/** The rejection type for a misspelled flag name — named so it survives truncation and *is* the message, `shape.ts`'s trick. */
type UnknownFlagIsRejected = { readonly __unknownFlagIsRejected: never };

/** A widened (non-literal) `boolean` satisfies `Partial<Flags>` too, so it needs the same rejection — see `field()`'s flags comment. */
type RejectWidenedBoolean<V> = boolean extends V ? UnknownFlagIsRejected : V;

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
  // Bare `T`, not `T & OnlyNominal<{ value: T }>["value"]`: the intersection at an
  // inference site measurably breaks zod's alias preservation. An unbranded schema
  // intersected this way still resolved and was rejected, but every *branded* one paid
  // for it too — `$ZodBranded<ZodString, "Slug", "out">` expanded to
  // `ZodString & { _zod: { output: string & $brand<"Slug"> } }` in the emitted `.d.ts`,
  // ~42 bytes per appearance (measured: -874 B / 21 flagged-field appearances in the
  // billing-domain fixture's emitted .d.ts, removing this intersection), for a check
  // that never had anything left to reject once the map-level check below ran.
  // The map-level `OnlyNominal<S>` (`shape.ts`, applied at every `Entity(...)`/`extend`
  // call site) already unwraps `FieldSpec` through `SchemaOf` before judging nominality,
  // so an unbranded schema placed in `Entity.field(...)` is still rejected — the error
  // just surfaces at the field-map key instead of at this call. See the map-position
  // pin in `field.test-d.ts`.
  schema: T,
  // Not bare `F`: a constraint is not an excess-property check, so
  // `{ generated: true, imutable: true }` satisfied `Partial<Flags>` and
  // compiled clean — measured, and the misspelled field was silently mutable.
  // The intersection maps every unknown key to the rejection type instead.
  // The second mapped type closes a matching gap: `{ generated: someBoolean }`
  // also satisfies `Partial<Flags>` and widens `generated` to `false` at the
  // type level while the runtime read would honour whatever `someBoolean` is
  // — measured — so a non-literal `boolean` arm is rejected the same way.
  flags: F &
    Record<Exclude<keyof F, keyof Flags>, UnknownFlagIsRejected> & {
      readonly [K in keyof F & keyof Flags]: RejectWidenedBoolean<F[K]>;
    },
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
