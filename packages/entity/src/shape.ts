import { z } from "zod";

/** A field is nominal if its inferred type is branded, or is already non-interchangeable. */
type Nominal = z.core.$brand<string | symbol> | boolean;

/**
 * True when `Wide` is assignable to `Candidate` — i.e. `Candidate` is at
 * least as wide as `Wide`. Wrapped in a tuple so union `Candidate`s are
 * compared as a whole rather than distributed member-by-member.
 */
type IsAtLeastAsWideAs<Candidate, Wide> = [Wide] extends [Candidate] ? true : false;

/**
 * A string/number literal union (e.g. a `z.enum(...)`) is narrow: the wide
 * primitive it's drawn from is not assignable to it. Bare `string`/`number`
 * are the wide primitives themselves and are rejected.
 */
type IsNarrowLiteral<T> = T extends string
  ? IsAtLeastAsWideAs<T, string> extends true
    ? false
    : true
  : T extends number
    ? IsAtLeastAsWideAs<T, number> extends true
      ? false
      : true
    : false;

type StripUndefined<T> = T extends undefined ? never : T;

/**
 * Another entity. The class is itself a schema, so it appears in a field
 * map directly.
 *
 * Checked structurally rather than against `BaseInstance` itself: that
 * interface is generic in the entity's own shape, and there is no argument
 * that matches every entity — `never` is too narrow to match any, and the
 * field map has no way to name the specific one. These three members are what
 * every entity instance has and nothing else in a field map does.
 */
type IsEntity<T> = T extends {
  readonly toJSON: () => unknown;
  readonly equals: (other: unknown) => boolean;
  readonly update: (patch: never) => unknown;
}
  ? true
  : false;

type IsNominalScalar<T> = T extends Nominal
  ? true
  : IsEntity<T> extends true
    ? true
    : IsNarrowLiteral<T> extends true
      ? true
      : false;

/** Strips `undefined` (for `.optional()`) and unwraps one array level before checking. */
type IsNominalField<T> =
  StripUndefined<T> extends readonly (infer Element)[]
    ? IsNominalScalar<StripUndefined<Element>>
    : IsNominalScalar<StripUndefined<T>>;

/**
 * The rejection types. Named rather than tuples of strings: a tuple prints as
 * `& [...]` once TypeScript truncates, hiding the advice, whereas a name
 * survives truncation and *is* the message.
 */
type DomainFieldMustBeBrandedOrAnEntity = {
  readonly __domainFieldMustBeBrandedOrAnEntity: never;
};

type FieldNameIsReservedByEntity = {
  readonly __fieldNameIsReservedByEntity: never;
};

/**
 * Names an entity installs on every instance. A data field taking one of these
 * would shadow it silently — measured: a field called `update` leaves
 * `entity.update` holding a string, with the method simply gone and no error
 * anywhere. Rejecting the name is the only signal available, since the clash
 * is invisible at runtime.
 *
 * Statics (`input`, `make`, …) are deliberately absent: shadowing one takes a
 * `static` declaration the author wrote themselves, so it is visible in a way
 * this is not.
 */
type ReservedFieldName = "_tag" | "equals" | "toJSON" | "update";

type OnlyNominal<T extends Record<string, z.core.$ZodType>> = {
  [K in keyof T]: K extends ReservedFieldName
    ? FieldNameIsReservedByEntity
    : IsNominalField<z.infer<T[K]>> extends true
      ? T[K]
      : DomainFieldMustBeBrandedOrAnEntity;
};

/** The only sanctioned way to declare a domain shape. */
export function shape<T extends Record<string, z.core.$ZodType>>(
  fields: T & OnlyNominal<T>,
): z.ZodObject<T> {
  return z.object(fields as T);
}

export type { OnlyNominal };
