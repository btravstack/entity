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
 * id: Entity.field(OrgId, { identity: true, generated: true }),
 * ```
 *
 * `generated` drops the key from `createInput` and hands it to a factory
 * generator; `immutable` drops it from `updateInput` so `update` refuses it.
 *
 * `identity` makes the field part of the entity's business identity, which
 * `sameIdentityAs` compares (#38). Several flagged fields form a composite
 * identity. It implies `immutable` — an entity cannot `update` itself into a
 * different one — and the value must be a required primitive, since identity
 * is compared with `Object.is`.
 *
 * `unbranded` exempts this one field from the rule that every field be
 * branded, an entity or a narrow literal — for a descriptive leaf (a label, a
 * free-text note) with no second value it could be confused with, whose brand
 * would only leak into every consumer of the derived schemas (#73). It is a
 * deliberate, visible opt-out per field, never a default.
 *
 * The flags argument is required — the function exists to flag; an empty
 * object is legal and does nothing.
 */
// `identity` and `unbranded` sit apart from `Flags` and appear on `FieldSpec`'s
// flags only when `true`, so the declarations of every other flagged field do
// not grow by keys they never asked for. The accepted keys are spelled inline
// rather than through a named alias, which TypeDoc would report as an
// undocumented reference.
export function field<
  T extends z.core.$ZodType,
  const F extends Partial<Flags & { readonly identity: boolean; readonly unbranded: boolean }>,
>(
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
  // The identity check sits on the flags, not the schema, for the alias reason
  // above. An identity is compared with `Object.is`, so its value must be a
  // primitive that is always present: an object would compare by reference,
  // and an optional one would make two entities with no id "the same".
  flags: F &
    Record<Exclude<keyof F, keyof Flags | "identity" | "unbranded">, UnknownFlagIsRejected> & {
      readonly [K in keyof F & (keyof Flags | "identity" | "unbranded")]: RejectWidenedBoolean<
        F[K]
      >;
    } & (F extends { identity: true }
      ? z.output<T> extends string | number | bigint | boolean
        ? unknown
        : { readonly __identityFieldMustBeARequiredPrimitive: never }
      : unknown),
): FieldSpec<
  T,
  {
    generated: F extends { generated: true } ? true : false;
    immutable: F extends { immutable: true } ? true : F extends { identity: true } ? true : false;
  } & (F extends { identity: true } ? { identity: true } : unknown) &
    (F extends { unbranded: true } ? { unbranded: true } : unknown)
> {
  const identity = flags.identity === true;
  return {
    schema: schema as T,
    flags: {
      generated: flags.generated === true,
      immutable: flags.immutable === true || identity,
      ...(identity ? { identity: true } : {}),
      ...(flags.unbranded === true ? { unbranded: true } : {}),
    } as {
      generated: F extends { generated: true } ? true : false;
      immutable: F extends { immutable: true } ? true : F extends { identity: true } ? true : false;
    } & (F extends { identity: true } ? { identity: true } : unknown) &
      (F extends { unbranded: true } ? { unbranded: true } : unknown),
  };
}

/**
 * A field-map entry is a schema, or a schema with flags. The two positive
 * checks are `Object.hasOwn` so a polluted `Object.prototype` cannot make an
 * arbitrary object classify as a spec; the negative `_zod` check deliberately
 * stays `in` — anything carrying zod's slot anywhere on its chain is
 * schema-shaped, and excluding broadly is the safe direction.
 */
export const isFieldSpec = (v: unknown): v is FieldSpec<z.core.$ZodType, Flags> =>
  typeof v === "object" &&
  v !== null &&
  Object.hasOwn(v, "schema") &&
  Object.hasOwn(v, "flags") &&
  !("_zod" in v);
