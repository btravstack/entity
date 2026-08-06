/**
 * A stand-in for a downstream *library*: it exports an entity subclass **and**
 * emits its own declarations. That combination is what regressed before — a
 * module-private `unique symbol` in the seal made every such consumer fail
 * with TS4020, while this repo's own build (which does not emit declarations
 * through `tsc`) stayed green. Compiled by `tsconfig.consumer.json` against
 * the built `dist/*.d.mts`, so it exercises the published types, not `src`.
 */
import { Entity, computed } from "@btravstack/entity";
import type { ConstructionKey } from "@btravstack/entity";
import { z } from "zod";

const OrgId = z.uuid().brand("OrgId");
const Slug = z.string().min(1).brand("Slug");
const Upper = z.string().min(1).brand("Upper");

export class Organization extends Entity("Organization")(
  { id: OrgId, slug: Slug },
  {
    immutable: ["id"],
    computed: { shout: computed(Upper, (d) => d.slug.toUpperCase() as z.infer<typeof Upper>) },
  },
) {}

/** The statics must still yield the subclass, not the structural base. */
export const load = (raw: unknown): Organization => Organization.make(raw).getOrThrow();

/** Nesting must still work from outside the package. */
export const Aggregate = z.object({ owner: Organization.instance });

// @ts-expect-error construction stays sealed for a consumer
new Organization({ id: "x" as never, slug: "y" as never });

// @ts-expect-error the construction key cannot be forged structurally
const forged: ConstructionKey = {} as { seal: never };
void forged;
