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

type IsNominalScalar<T> = T extends Nominal ? true : IsNarrowLiteral<T> extends true ? true : false;

/** Strips `undefined` (for `.optional()`) and unwraps one array level before checking. */
type IsNominalField<T> =
  StripUndefined<T> extends readonly (infer Element)[]
    ? IsNominalScalar<StripUndefined<Element>>
    : IsNominalScalar<StripUndefined<T>>;

type OnlyNominal<T extends Record<string, z.ZodTypeAny>> = {
  [K in keyof T]: IsNominalField<z.infer<T[K]>> extends true
    ? T[K]
    : ["ERROR: domain fields must be branded", K];
};

/** The only sanctioned way to declare a domain shape. */
export function shape<T extends Record<string, z.ZodTypeAny>>(
  fields: T & OnlyNominal<T>,
): z.ZodObject<T> {
  return z.object(fields as T);
}

export type { OnlyNominal };
