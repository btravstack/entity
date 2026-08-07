import { Err, P, type Result } from "unthrown";
import { z } from "zod";

import { InvalidEntity } from "./errors.js";
import { keysOf } from "./issues.js";

/**
 * The part of an entity a union needs. Typed loosely — `EntityStatic` is
 * generic in the entity's own shape, and a union has to accept any of them.
 */
export type UnionMember = {
  readonly entityName: string;
  readonly input: z.ZodObject<z.core.$ZodLooseShape>;
  readonly output: z.ZodObject<z.core.$ZodLooseShape>;
  make(state: unknown): Result<unknown, InvalidEntity>;
} & z.core.$ZodType;

/**
 * The member's instance type, read off the member itself — an entity class is
 * a schema, so `z.infer` gives what parsing it yields. Not read off `make`,
 * which is generic in a `this` parameter and cannot be inferred through a
 * loosened member type.
 */
type InstanceOf<M extends UnionMember> = z.infer<M>;

export type EntityUnion<K extends string, M extends readonly UnionMember[]> = {
  readonly discriminant: K;
  readonly members: M;
  readonly input: z.ZodType<unknown>;
  readonly output: z.ZodType<unknown>;
  make(state: unknown): Result<InstanceOf<M[number]>, InvalidEntity>;
} & Pick<z.ZodType<InstanceOf<M[number]>>, "_zod" | "~standard">;

/**
 * `z.discriminatedUnion` constrains its branches to `$ZodTypeDiscriminable<K>`,
 * which asserts the branch's *input* carries the key. A member's schema is
 * generic here, so TypeScript cannot see that it does — the runtime check in
 * `byValue` below reads the very literal that proves it. Cast rather than
 * fight a constraint the construction already satisfies.
 */
type Branches = readonly [z.core.$ZodTypeDiscriminable, ...z.core.$ZodTypeDiscriminable[]];

/**
 * A union of entities that is itself usable like one: it validates, it makes
 * the right class, and it hands a contract layer plain schemas.
 *
 * ```ts
 * const Member = union("kind", [User, ServiceAccount]);
 * Member.make(row).getOrThrow(); // User | ServiceAccount
 * ```
 *
 * `discriminant` names a **declared domain field**, not the entity's `_tag`.
 * The tag is non-enumerable and absent after serialisation, so a union built
 * on it could not survive a JSON round trip. The two mechanisms are not
 * redundant: the field discriminates *data*, the tag matches an *instance*
 * with `P.tag(...)`.
 *
 * `input` and `output` are real discriminated unions, so a contract layer gets
 * one branch per member and JSON Schema in both directions.
 */
/**
 * Every value of a member's discriminant field.
 *
 * Reading `.value` off the schema — which this did — assumes a single-valued
 * `z.literal`, and that assumption is narrower than what the rest of the
 * package accepts. `shape.ts`'s `IsNarrowLiteral` blesses `z.enum([...])` as a
 * nominal field and `z.discriminatedUnion` (used above) dispatches on enums
 * happily, so an enum discriminant is an expected declaration — but `ZodEnum`
 * has no `.value`, so the member registered under `undefined`. Measured
 * consequences: `input.safeParse` accepted a payload `make` then rejected, a
 * payload *missing* the discriminant was misrouted to whichever member held the
 * `undefined` key, and the "expected one of …" message rendered it as empty.
 * A multi-value `z.literal(["a","b"])` was worse still — `.value` throws
 * `This schema contains multiple valid literal values`, at union construction.
 *
 * `.values` and `.options` are the plural accessors zod v4 provides for exactly
 * this, and both are sets of the *same* shape, so a member can legitimately
 * claim several discriminant values.
 */
const discriminantValues = (member: UnionMember, discriminant: string): readonly unknown[] => {
  const schema = member.input.shape[discriminant] as
    | { readonly values?: unknown; readonly options?: unknown }
    | undefined;

  // `z.literal(...)` — `.values` is a Set in zod v4, and covers the multi-value
  // form that makes the singular `.value` getter throw.
  const values: unknown = schema?.values;
  if (values instanceof Set) return [...values];
  if (Array.isArray(values)) return values;

  // `z.enum([...])` — `.options` is the declared member list.
  const options: unknown = schema?.options;
  if (Array.isArray(options)) return options;

  // Nothing nameable. Registering under no key is what keeps a malformed
  // declaration from silently capturing every payload that omits the
  // discriminant; `make` then reports "Invalid discriminant" as it should.
  return [];
};

export function union<
  const K extends string,
  const M extends readonly [UnionMember, UnionMember, ...UnionMember[]],
>(discriminant: K, members: M): EntityUnion<K, M> {
  const input = z.discriminatedUnion(
    discriminant,
    members.map((m) => m.input) as unknown as Branches,
  );
  const output = z.discriminatedUnion(
    discriminant,
    members.map((m) => m.output) as unknown as Branches,
  );

  const byValue = new Map<unknown, UnionMember>(
    members.flatMap((m) => discriminantValues(m, discriminant).map((v) => [v, m] as const)),
  );

  const entity = members.map((m) => m.entityName).join(" | ");
  const known = [...byValue.keys()].map((k) => JSON.stringify(k)).join(", ");

  /** Dispatch on the discriminant rather than trying each branch in turn, so a
   * failing member reports *its* issues instead of every branch's. */
  const lookup = (state: unknown): UnionMember | undefined =>
    byValue.get((state as Record<string, unknown> | null | undefined)?.[discriminant]);

  const unknownDiscriminant = (state: unknown) => ({
    path: [discriminant] as readonly PropertyKey[],
    message: `Invalid discriminant ${JSON.stringify(
      (state as Record<string, unknown> | null | undefined)?.[discriminant],
    )}; expected one of ${known}`,
  });

  const make = (state: unknown): Result<InstanceOf<M[number]>, InvalidEntity> => {
    const member = lookup(state);
    return member === undefined
      ? Err(new InvalidEntity({ entity, issues: [unknownDiscriminant(state)] }))
      : (member.make(state) as Result<InstanceOf<M[number]>, InvalidEntity>);
  };

  const instance = z.unknown().transform((raw, ctx) => {
    const member = lookup(raw);
    if (member === undefined) {
      const issue = unknownDiscriminant(raw);
      ctx.addIssue({ code: "custom", message: issue.message, path: [discriminant] });
      return z.NEVER;
    }
    // through `make`, not a parse method: a member is an entity class, which
    // carries zod's slots rather than its methods. Mirrors `instance.ts` — a
    // Defect is left unrecovered so it panics rather than becoming an issue.
    return member
      .make(raw)
      .recoverErrCases((m) =>
        m.with(P.tag("InvalidEntity"), (invalid) => {
          for (const issue of invalid.issues) {
            ctx.addIssue({ code: "custom", message: issue.message, path: keysOf(issue) });
          }
          return z.NEVER;
        }),
      )
      .get() as InstanceOf<M[number]>;
  }) as unknown as z.ZodType<InstanceOf<M[number]>>;

  // the same two slots an entity carries, so a union composes identically —
  // `z.object({ member: Member })`, or as a field of another entity
  const slots = instance as unknown as Record<string, unknown>;
  return {
    discriminant,
    members,
    input,
    output,
    make,
    _zod: slots["_zod"],
    "~standard": slots["~standard"],
  } as EntityUnion<K, M>;
}
