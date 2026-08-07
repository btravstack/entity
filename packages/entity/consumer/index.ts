/**
 * A stand-in for a downstream *library*: it exports an entity subclass **and**
 * emits its own declarations. That combination is what regressed before — a
 * module-private `unique symbol` in the seal made every such consumer fail
 * with TS4020, while this repo's own build (which does not emit declarations
 * through `tsc`) stayed green.
 *
 * `tsconfig.consumer.json` compiles this, and both of its overrides are load
 * bearing: it turns `noEmit` off because declaration emit is what surfaces a
 * leaked private name, and points `paths` at `dist/*.d.mts` so this exercises
 * the published types rather than `src`.
 *
 * It is also what guards the namespace: every member of `Entity` is reached
 * through the built `d.mts` below, because a member emitted as a circular
 * self-alias still *compiles* and only shows up as a `@ts-expect-error` here
 * going unused. See the `Src` comment in `entity.ts`. An unused directive in
 * this file is a failure, not noise.
 */
import { Entity } from "@btravstack/entity";
import { z } from "zod";

const OrgId = z.uuid().brand("OrgId");
const Slug = z.string().min(1).brand("Slug");
const Upper = z.string().min(1).brand("Upper");

export class Organization extends Entity("Organization")(
  { id: OrgId, slug: Slug },
  {
    immutable: ["id"],
    computed: {
      shout: Entity.computed(Upper, (d) => d.slug.toUpperCase() as z.infer<typeof Upper>),
    },
  },
) {}

/** The statics must still yield the subclass, not the structural base. */
export const load = (raw: unknown): Organization => Organization.make(raw).getOrThrow();

/** The class must still compose as a schema from outside the package. */
export const Aggregate = z.object({ owner: Organization });

// @ts-expect-error construction stays sealed for a consumer
new Organization({ id: "x" as never, slug: "y" as never });

// @ts-expect-error the construction key cannot be forged structurally
const forged: Entity.ConstructionKey = {} as { seal: never };
void forged;

/**
 * Every remaining namespace member, named from outside the package. A member
 * emitted as a circular self-alias degenerates silently, so each one has to be
 * *used* somewhere declaration emit will walk it.
 */
export type Row = Entity.Output<typeof Organization>;
export type Wire = Entity.Input<typeof Organization>;
export type NewOrg = Entity.CreateInput<typeof Organization>;
export type OrgPatch = Entity.Patch<typeof Organization>;
export type Derived = Entity.ComputedField<typeof Upper, { slug: z.infer<typeof Slug> }>;
export type Sealed = Entity.Sealed<Row>;
export type Base = Entity.BaseInstance<{ id: typeof OrgId }, Record<never, never>, []>;

/** The error is reachable as both a value and a type. */
export const isInvalid = (e: unknown): e is Entity.InvalidEntity =>
  e instanceof Entity.InvalidEntity;

const Member = Entity.union("kind", [Organization, Organization] as const);
export type MemberUnion = Entity.Union<"kind", [typeof Organization, typeof Organization]>;
void Member;
