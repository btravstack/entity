import { z } from "zod";

import { isFieldSpec } from "./field.js";
import type { Fields, SchemaOf, SchemasOf } from "./types.js";

/** A field is nominal if its inferred type is branded, or is already non-interchangeable. */
type Nominal = z.core.$brand<string | symbol> | boolean;

/**
 * A string/number literal union (e.g. a `z.enum(...)`) is narrow: the wide
 * primitive it's drawn from is not assignable to it. Bare `string`/`number`
 * are the wide primitives themselves and are rejected. Each test is
 * tuple-wrapped so a union `T` is compared as a whole rather than distributed.
 */
type IsNarrowLiteral<T> = T extends string
  ? [string] extends [T]
    ? false
    : true
  : T extends number
    ? [number] extends [T]
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
  readonly sameIdentityAs: unknown;
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
type ReservedFieldName = "_tag" | "sameIdentityAs" | "toJSON" | "update";

// Judges the *unwrapped* schema: an inline `Entity.field(...)` spec is nominal
// exactly when the schema it carries is — unless the spec says
// `unbranded: true`, the one sanctioned per-field opt-out (#73).
type OnlyNominal<T extends Fields> = {
  [K in keyof T]: K extends ReservedFieldName
    ? FieldNameIsReservedByEntity
    : T[K] extends { readonly flags: { readonly unbranded: true } }
      ? T[K]
      : IsNominalField<z.infer<SchemaOf<T[K]>>> extends true
        ? T[K]
        : DomainFieldMustBeBrandedOrAnEntity;
};

/** The only sanctioned way to declare a domain shape. */
export function shape<T extends Fields>(fields: T & OnlyNominal<T>): z.ZodObject<SchemasOf<T>> {
  const unwrapped = Object.fromEntries(
    Object.entries(fields).map(([k, v]) => [k, isFieldSpec(v) ? v.schema : v]),
  );
  return z.object(unwrapped as SchemasOf<T>);
}

/**
 * An entity class or an `Entity.union(...)` value: a schema that carries its
 * own plain `input` and `output`. Tested before anything reads `_zod`, which on
 * a class builds its transform schema.
 */
const isEntityLike = (s: unknown): s is Record<"input" | "output", z.core.$ZodType> =>
  (typeof s === "function" || (typeof s === "object" && s !== null)) &&
  typeof (s as { readonly make?: unknown }).make === "function" &&
  "input" in s &&
  "output" in s;

/**
 * The plain stand-in for one field schema (#72): a nested entity or union is
 * replaced by its own `input` or `output`, through `z.array`, `z.optional` and
 * `z.nullable`. The class is a zod schema with a `.transform()`, so a member
 * embedding it could not reach JSON Schema in either direction — `io: "input"`
 * threw `Cannot set properties of undefined (setting 'ref')` and
 * `io: "output"` threw `Transforms cannot be represented in JSON Schema`,
 * measured on zod 4.6.5. A nested entity's members are already plain, so one
 * substitution per level reaches any depth.
 *
 * A wrapper is cloned only when something under it changed, so a field with no
 * entity in it stays the very same object. The clone is made **without** zod's
 * `parent` link: JSON Schema generation follows `parent` and would walk back
 * into the class. That also leaves behind any `.meta()`/`.describe()` on the
 * wrapper itself.
 * ponytail: other containers (`z.record`, `z.tuple`, `.default()`, `.readonly()`
 * and an inline object) are not walked; an entity inside one still blocks
 * conversion. Walk them when a declaration needs it.
 */
export const plain = (schema: z.core.$ZodType, side: "input" | "output"): z.core.$ZodType => {
  if (isEntityLike(schema)) return schema[side];
  const def = schema._zod.def;
  if (def.type === "array") {
    const { element } = def as z.core.$ZodArrayDef;
    const next = plain(element, side);
    return next === element
      ? schema
      : z.core.util.clone(schema, { ...def, element: next } as typeof def);
  }
  if (def.type === "optional" || def.type === "nullable") {
    const { innerType } = def as z.core.$ZodOptionalDef;
    const next = plain(innerType, side);
    return next === innerType
      ? schema
      : z.core.util.clone(schema, { ...def, innerType: next } as typeof def);
  }
  return schema;
};

/** Every field of `object` swapped for its plain stand-in. */
export const plainShape = (
  object: z.ZodObject,
  side: "input" | "output",
): Record<string, z.core.$ZodType> =>
  Object.fromEntries(Object.entries(object.shape).map(([k, s]) => [k, plain(s, side)]));

export type { OnlyNominal };
