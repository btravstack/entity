import { test } from "vitest";
import { z } from "zod";

import { Entity } from "./index.js";

const Id = z.uuid().brand("Id");
const Tag = z.enum(["ARCHIVED", "PRIORITY"]);
type Tags = readonly ("ARCHIVED" | "PRIORITY")[];

// The idiom (issue #60): a deriver may call the entity's own statics, given an
// explicit return annotation. The self-reference is not what breaks — the
// deriver's *inferred* return type is: TypeScript resolves a context-sensitive
// arrow's return eagerly inside the heritage-clause call, and the body's
// `Doc.isActive` then needs the class type mid-resolution. The annotation
// preempts body inference; the body itself is checked later, once the class
// exists. Measured on 7.0.2 and 5.9.3; no library-side spelling rescues the
// unannotated form (NoInfer, `unknown` return position, currying — all fail).

class Doc extends Entity("Doc")(
  { id: Entity.field(Id, { immutable: true }), tags: z.array(Tag) },
  {
    computed: {
      active: Entity.computed(z.boolean(), (d): boolean => Doc.isActive(d.tags)),
    },
    invariants: [Entity.invariant((d): boolean => Doc.isActive(d.tags), "must be active")],
  },
) {
  static isActive(tags: Tags): boolean {
    return !tags.includes("ARCHIVED");
  }
}

abstract class Root extends Entity.abstract("Root")(
  { id: Entity.field(Id, { immutable: true }), tags: z.array(Tag) },
  {
    computed: {
      active: Entity.computed(z.boolean(), (d): boolean => Root.isActive(d.tags)),
    },
  },
) {
  static isActive(tags: Tags): boolean {
    return !tags.includes("ARCHIVED");
  }
}

class Variant extends Root.extend("Variant")(
  { note: z.string().brand("Note") },
  {
    computed: {
      // own static: annotated, like any self-reference
      loud: Entity.computed(z.boolean(), (d): boolean => Variant.isLoud(d.note)),
      // the ROOT's static: no annotation needed — the root is a settled class
      calm: Entity.computed(z.boolean(), (d) => !Root.isActive(d.tags)),
    },
  },
) {
  static isLoud(note: string): boolean {
    return note === note.toUpperCase();
  }
}

test("the computed field derived through the entity's own static reaches the instance", () => {
  const d = Doc.make({ id: "x", tags: [] }).getOrThrow();
  const active: boolean = d.active;
  void active;
  const v = Variant.make({ id: "x", tags: [], note: "n" }).getOrThrow();
  const both: [boolean, boolean] = [v.loud, v.calm];
  void both;
});

// The annotation is not an escape hatch — it is checked on both faces.

class WrongBody extends Entity("WrongBody")(
  { id: Entity.field(Id, { immutable: true }), tags: z.array(Tag) },
  {
    computed: {
      // @ts-expect-error the static's boolean is not assignable to the `string` annotation
      active: Entity.computed(z.boolean(), (d): string => WrongBody.isActive(d.tags)),
    },
  },
) {
  static isActive(tags: Tags): boolean {
    return !tags.includes("ARCHIVED");
  }
}

class WrongSchema extends Entity("WrongSchema")(
  { id: Entity.field(Id, { immutable: true }), tags: z.array(Tag) },
  {
    computed: {
      // @ts-expect-error a `string` deriver is not assignable to a boolean schema
      active: Entity.computed(z.boolean(), (d): string => WrongSchema.label(d.tags)),
    },
  },
) {
  static label(tags: Tags): string {
    return tags.join(",");
  }
}

class TooWide extends Entity("TooWide")(
  { id: Entity.field(Id, { immutable: true }), tags: z.array(Tag) },
  {
    computed: {
      // @ts-expect-error `unknown` is not assignable to a boolean schema
      active: Entity.computed(z.boolean(), (d): unknown => TooWide.isActive(d.tags)),
    },
  },
) {
  static isActive(tags: Tags): boolean {
    return !tags.includes("ARCHIVED");
  }
}

// The annotation does not loosen `d` — it stays contextually typed.

class StillTyped extends Entity("StillTyped")(
  { id: Entity.field(Id, { immutable: true }), tags: z.array(Tag) },
  {
    computed: {
      // @ts-expect-error `nope` is not a declared field
      active: Entity.computed(z.boolean(), (d): boolean => StillTyped.isActive(d.nope)),
    },
  },
) {
  static isActive(tags: Tags): boolean {
    return !tags.includes("ARCHIVED");
  }
}

// Dead-end ledger. Three measured spellings that cannot work; each suppression
// below is load-bearing — if one goes unused, the compiler's behaviour changed.

// Unannotated deriver: TS2506 on the class, TS7024 on the arrow.
// @ts-expect-error TS2506 — the class is referenced in its own base expression
class Unannotated extends Entity("Unannotated")(
  { id: Entity.field(Id, { immutable: true }), tags: z.array(Tag) },
  {
    computed: {
      // @ts-expect-error TS7024 — the deriver's return type cannot be inferred
      active: Entity.computed(z.boolean(), (d) => Unannotated.isActive(d.tags)),
    },
  },
) {
  static isActive(tags: Tags): boolean {
    return !tags.includes("ARCHIVED");
  }
}

// Unannotated invariant: same failure mode, same fix.
// @ts-expect-error TS2506 — the class is referenced in its own base expression
class BadRule extends Entity("BadRule")(
  { id: Entity.field(Id, { immutable: true }), tags: z.array(Tag) },
  {
    invariants: [
      // @ts-expect-error TS7024 — the predicate's return type cannot be inferred
      Entity.invariant((d) => BadRule.isActive(d.tags), "must be active"),
    ],
  },
) {
  static isActive(tags: Tags): boolean {
    return !tags.includes("ARCHIVED");
  }
}

// A `this` parameter is signature position — never deferred — so it is
// circular even with the return annotated, and the library cannot supply the
// type either: the statics live in a class body TypeScript has not formed yet.
// @ts-expect-error TS2506 — the class is referenced in its own base expression
class ViaThis extends Entity("ViaThis")(
  { id: Entity.field(Id, { immutable: true }), tags: z.array(Tag) },
  {
    computed: {
      // @ts-expect-error TS2502 — `this` is referenced in its own type annotation
      active: Entity.computed(z.boolean(), function (this: typeof ViaThis, d): boolean {
        return this.isActive(d.tags);
      }),
    },
  },
) {
  static isActive(tags: Tags): boolean {
    return !tags.includes("ARCHIVED");
  }
}

test("the dead-end classes still type as entities where suppressed", () => {
  void [Unannotated, BadRule, ViaThis, WrongBody, WrongSchema, TooWide, StillTyped];
});
