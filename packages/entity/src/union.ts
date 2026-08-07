import { Err, type Result } from "unthrown";
import { z } from "zod";

import { InvalidEntity } from "./errors.js";

/**
 * The part of an entity a union needs. Typed loosely — `EntityStatic` is
 * generic in the entity's own shape, and a union has to accept any of them.
 */
type UnionMember = {
  readonly entityName: string;
  readonly input: z.ZodObject<z.core.$ZodLooseShape>;
  readonly output: z.ZodObject<z.core.$ZodLooseShape>;
  readonly instance: z.ZodType;
  make(state: unknown): Result<unknown, InvalidEntity>;
};

/**
 * The member's instance type, read off `instance` rather than off `make`.
 * `make` is generic in a `this` parameter, which cannot be inferred through a
 * loosened member type; `instance` states the same type plainly.
 */
type InstanceOf<M extends UnionMember> = z.infer<M["instance"]>;

export type EntityUnion<K extends string, M extends readonly UnionMember[]> = {
  readonly discriminant: K;
  readonly members: M;
  readonly input: z.ZodType<unknown>;
  readonly output: z.ZodType<unknown>;
  readonly instance: z.ZodType<InstanceOf<M[number]>>;
  make(state: unknown): Result<InstanceOf<M[number]>, InvalidEntity>;
};

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
    members.map((m) => [(m.input.shape[discriminant] as z.ZodLiteral<string>).value, m]),
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
    const parsed = member.instance.safeParse(raw);
    if (!parsed.success) {
      for (const issue of parsed.error.issues) {
        ctx.addIssue({ code: "custom", message: issue.message, path: [...issue.path] });
      }
      return z.NEVER;
    }
    return parsed.data as InstanceOf<M[number]>;
  }) as unknown as z.ZodType<InstanceOf<M[number]>>;

  return { discriminant, members, input, output, instance, make };
}
