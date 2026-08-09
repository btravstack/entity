import { P } from "unthrown";
import { expect, test } from "vitest";
import { z } from "zod";

import { Entity } from "./index.js";

const AccountId = z.uuid().brand("AccountId");
const Label = z.string().min(1).brand("Label");
const Upper = z.string().min(1).brand("Upper");

abstract class AccountBase extends Entity.abstract("Account")(
  { id: AccountId, label: Label },
  {
    immutable: ["id"],
    computed: {
      shout: Entity.computed(Upper, (d) => d.label.toUpperCase() as z.infer<typeof Upper>),
    },
    invariants: [Entity.invariant((d) => d.label.length <= 20, "label must be at most 20 chars")],
  },
) {
  abstract describe(): string;
  get slug(): string {
    return this.label.toLowerCase();
  }
}

/** Behaviour-only intermediate root: adds no fields, only methods. */
abstract class Auditable extends AccountBase {
  audit(): string {
    return `${this._tag}:${this.id}`;
  }
}

class Personal extends AccountBase.extend("Personal")({ kind: z.literal("personal") }) {
  override describe(): string {
    return `personal ${this.slug}`;
  }
}

class Business extends Auditable.extend("Business")({
  kind: z.literal("business"),
  vat: Label,
}) {
  override describe(): string {
    return `business ${this.vat}`;
  }
}

const id = "0199b1f4-1b1e-7000-8000-000000000000";
const personal = () => Personal.make({ id, label: "Ada", kind: "personal" }).getOrThrow();

test("a variant carries the root's fields plus its own", () => {
  const p = personal();
  expect(p.id).toBe(id);
  expect(p.label).toBe("Ada");
  expect(p.kind).toBe("personal");
  expect(p._tag).toBe("Personal");
});

test("the root's behaviour runs on a variant instance", () => {
  expect(personal().slug).toBe("ada");
  expect(personal().describe()).toBe("personal ada");
});

test("a variant is an instance of its root", () => {
  // chaining, not copying: the root is a real runtime supertype, so
  // `instanceof` narrows and a shared base can be tested against
  expect(personal()).toBeInstanceOf(AccountBase);
  expect(personal()).not.toBeInstanceOf(Business);
});

test("a behaviour-only intermediate root is picked up", () => {
  const b = Business.make({ id, label: "Acme", kind: "business", vat: "FR1" }).getOrThrow();
  expect(b.audit()).toBe("Business:" + id);
  expect(b.slug).toBe("acme");
  // the variant's own body reads a field from its own `extend()` call
  expect(b.describe()).toBe("business FR1");
});

test("two sibling variants of one root are never equal, even with matching data", () => {
  // Deliberately indistinguishable *as data*: one root, two variants adding the
  // same field under the same schema, and identical values. Both projections
  // are `{ id, label, note }` with equal contents, so `deepEqual` says yes and
  // only `equals`' `instanceof Base` guard can say no. That guard is the whole
  // subject here — prototype rewiring makes both `instanceof Twinned`, so
  // without it a sibling variant would pass as the same entity.
  abstract class Twinned extends Entity.abstract("Twinned")({
    id: AccountId,
    label: Label,
  }) {}
  class Left extends Twinned.extend("Left")({ note: Label }) {}
  class Right extends Twinned.extend("Right")({ note: Label }) {}

  const left = Left.make({ id, label: "Ada", note: "n" }).getOrThrow();
  const right = Right.make({ id, label: "Ada", note: "n" }).getOrThrow();

  // the data really is identical — this is what makes the assertions below bite
  expect(left.toJSON()).toEqual(right.toJSON());
  expect(left).toBeInstanceOf(Twinned);
  expect(right).toBeInstanceOf(Twinned);

  expect(left.equals(right)).toBe(false);
  expect(right.equals(left)).toBe(false);
});

test("a root's class-body *field* is never initialised", () => {
  abstract class WithField extends Entity.abstract("WithField")({ id: AccountId }) {
    counter = 0;
  }
  class Counted extends WithField.extend("Counted")({ label: Label }) {}
  const c = Counted.make({ id, label: "Ada" }).getOrThrow();
  // `extend` rewires the *instance prototype* only, and the variant's generated
  // base extends nothing — so the root's constructor never runs and a field
  // initialiser never fires. Typed `number`, absent at runtime. Use a getter or
  // a method on a root; a field cannot be prevented at the type level, because
  // mapping `BehaviourOf` is what TS2425 forbids.
  expect("counter" in c).toBe(false);
  expect((c as unknown as { counter: unknown }).counter).toBeUndefined();
});

test("a private field on a root fails where it is read, not where it is declared", () => {
  abstract class Cached extends Entity.abstract("Cached")({ id: AccountId }) {
    private cache = new Map<string, string>();
    peek(): number {
      return this.cache.size;
    }
  }
  class Peeking extends Cached.extend("Peeking")({ label: Label }) {}
  const p = Peeking.make({ id, label: "Ada" }).getOrThrow();
  // `private` changes nothing: it compiles in the root and in the variant, and
  // the field is still never initialised. The declaration is silent; the read
  // is not. This is what `docs/reference/declaration.md` pins.
  expect("cache" in p).toBe(false);
  expect(() => p.peek()).toThrow(TypeError);
});

test("a root's statics are not inherited by a variant", () => {
  abstract class WithStatic extends Entity.abstract("WithStatic")({ id: AccountId }) {
    static hello(): string {
      return "hi";
    }
  }
  class Quiet extends WithStatic.extend("Quiet")({ label: Label }) {}
  // instance-prototype rewiring only: the *static* chain is untouched, so a
  // root's statics stay on the root. The type side agrees, so this surfaces as
  // a compile error rather than a crash.
  expect(Object.getPrototypeOf(Quiet)).not.toBe(WithStatic);
  expect((Quiet as unknown as { hello?: unknown }).hello).toBeUndefined();
});

test("the root's options carry over", () => {
  expect(Object.keys(Personal.updateInput.shape).toSorted()).toEqual(["kind", "label"]);
  expect(personal().shout).toBe("ADA");
  expect(Personal.make({ id, label: "x".repeat(21), kind: "personal" }).isErr()).toBe(true);
});

test("the root's computed fields carry over and still re-derive", () => {
  const updated = personal()
    .update({ label: "grace" as z.infer<typeof Label> })
    .getOrThrow();
  expect(updated.shout).toBe("GRACE");
});

test("a variant's own schemas include both halves", () => {
  expect(Object.keys(Personal.input.shape).toSorted()).toEqual(["id", "kind", "label"]);
  expect(Object.keys(Personal.output.shape).toSorted()).toEqual(["id", "kind", "label", "shout"]);
});

test("a variant's option adds to the root's, it does not replace", () => {
  class Loose extends AccountBase.extend("Loose")({ note: Label }, { immutable: [] }) {
    override describe(): string {
      return "loose";
    }
  }
  // the root declared `id` immutable; declaring an empty list cannot shed it
  expect(Object.keys(Loose.updateInput.shape).toSorted()).toEqual(["label", "note"]);
});

test("a variant declaring computed keeps the root's", () => {
  class Quiet extends AccountBase.extend("Quiet")(
    { note: Label },
    {
      computed: {
        murmur: Entity.computed(Label, (d) => d.label.toLowerCase() as z.infer<typeof Label>),
      },
    },
  ) {
    override describe(): string {
      return "quiet";
    }
  }
  // `computed` is a map, so it merges per key — the root's `shout` survives
  expect(Object.keys(Quiet.output.shape).toSorted()).toEqual([
    "id",
    "label",
    "murmur",
    "note",
    "shout",
  ]);
});

test("a variant adds to the root's invariants, never replaces", () => {
  const Score = z.number().int().brand("Score");
  class Stricter extends AccountBase.extend("Stricter")(
    { score: Score },
    { invariants: [Entity.invariant((d) => d.score >= 18, "score must be at least 18")] },
  ) {
    override describe(): string {
      return "stricter";
    }
  }
  // the variant's own rule applies
  expect(Stricter.make({ id, label: "Ada", score: 1 }).isErr()).toBe(true);
  // and the root's still does — declaring invariants must not shed them
  expect(Stricter.make({ id, label: "x".repeat(21), score: 30 }).isErr()).toBe(true);
});

test("a variant cannot relax the root by declaring an empty invariants list", () => {
  class Loose extends AccountBase.extend("LooseInvariants")({ note: Label }, { invariants: [] }) {
    override describe(): string {
      return "loose";
    }
  }
  expect(Loose.make({ id, label: "x".repeat(21), note: "n" }).isErr()).toBe(true);
});

test("an entity's own toJSON/equals/update shadow a root's", () => {
  abstract class Shadowing extends Entity.abstract("Shadowing")({ id: AccountId }) {
    override equals(): boolean {
      return true;
    }
    override toJSON(): never {
      return "hijacked" as never;
    }
    override update(): never {
      return "hijacked" as never;
    }
  }
  class Shadowed extends Shadowing.extend("Shadowed")({ label: Label }) {}
  const a = Shadowed.make({ id, label: "a" }).getOrThrow();
  const b = Shadowed.make({ id, label: "b" }).getOrThrow();
  // the root sits *below* the entity's own prototype in the chain, so a root
  // can call these three but never override them
  expect(a.equals(b)).toBe(false);
  expect(a.toJSON()).toEqual({ id, label: "a" });
  expect(a.update({ label: "c" as z.infer<typeof Label> }).getOrThrow().label).toBe("c");
});

test("a root has no instances", () => {
  const Ctor = AccountBase as unknown as new () => unknown;
  expect(() => new Ctor()).toThrow(/no instances/);
});

test("a variant is still sealed and still refuses a bare subclass", () => {
  class Sub extends Personal {}
  const outcome = Sub.make({ id, label: "Ada", kind: "personal" }).match({
    ok: () => "WRONGLY ACCEPTED",
    errCases: (m) => m.with(P.tag("InvalidEntity"), () => "invalid"),
    defect: () => "defect",
  });
  expect(outcome).toBe("defect");
});

test("immutable accumulates through a behaviour-only intermediate root", () => {
  // Entities are final, so options never chain root → variant → variant. The
  // only multi-level shape is root → intermediate root → variant, and
  // `Auditable` is already declared above as exactly that.
  class Audited extends Auditable.extend("Audited")({ note: Label }, { immutable: ["note"] }) {
    override describe(): string {
      return "audited";
    }
  }
  // `id` from AccountBase, `note` from here — `label` is all that is left
  expect(Object.keys(Audited.updateInput.shape).toSorted()).toEqual(["label"]);
});

test("generated accumulates, so a variant cannot make a root's key caller-supplied", () => {
  abstract class Stamped extends Entity.abstract("Stamped")(
    { id: AccountId, at: Label },
    { generated: ["at"] },
  ) {}
  class Doc extends Stamped.extend("Doc")({ note: Label }, { generated: ["id"] }) {}
  // `at` is the root's, `id` is the variant's — `createInput` keeps neither
  expect(Object.keys(Doc.createInput.shape).toSorted()).toEqual(["note"]);
});

test("a variant redeclaring a field replaces the root's schema for that key", () => {
  // The two schemas accept overlapping but neither-contains-the-other sets, so
  // all three candidate merges are told apart rather than only two of them.
  const Code5 = z.string().length(5).brand("Code5");
  const Digits = z.string().regex(/^\d+$/).brand("Digits");
  abstract class Coded extends Entity.abstract("Coded")({ id: AccountId, code: Code5 }) {}
  class Numbered extends Coded.extend("Numbered")({ code: Digits }) {}

  // accepted by the root, rejected by the variant — rules out parent-wins
  expect(Numbered.make({ id, code: "abcde" }).isErr()).toBe(true);
  // rejected by the root, accepted by the variant — rules out an intersection,
  // which is the merge this key's *type* used to claim
  expect(Numbered.make({ id, code: "42" }).getOrThrow().code).toBe("42");
  // accepted by both, so the key is not simply dropped
  expect(Numbered.make({ id, code: "12345" }).getOrThrow().code).toBe("12345");
  expect(Object.keys(Numbered.output.shape).toSorted()).toEqual(["code", "id"]);
});

test("a variant redefining one computed key overrides that entry only", () => {
  class Louder extends AccountBase.extend("Louder")(
    { note: Label },
    {
      computed: {
        shout: Entity.computed(Upper, (d) => `${d.label}!`.toUpperCase() as z.infer<typeof Upper>),
      },
    },
  ) {
    override describe(): string {
      return "louder";
    }
  }
  const l = Louder.make({ id, label: "Ada", note: "n" }).getOrThrow();
  expect(l.shout).toBe("ADA!");
  expect(Object.keys(Louder.output.shape).toSorted()).toEqual(["id", "label", "note", "shout"]);
});
