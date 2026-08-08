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

test("a variant option overrides the root's for that key", () => {
  class Loose extends AccountBase.extend("Loose")({ note: Label }, { immutable: [] }) {
    override describe(): string {
      return "loose";
    }
  }
  expect(Object.keys(Loose.updateInput.shape).toSorted()).toEqual(["id", "label", "note"]);
});

test("invariants are the exception: a variant adds to the root's, never replaces", () => {
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
  }
  class Shadowed extends Shadowing.extend("Shadowed")({ label: Label }) {}
  const a = Shadowed.make({ id, label: "a" }).getOrThrow();
  const b = Shadowed.make({ id, label: "b" }).getOrThrow();
  // the root sits *below* the entity's own prototype in the chain, so a root
  // can call these three but never override them
  expect(a.equals(b)).toBe(false);
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
