import { match, P } from "unthrown";
import { test } from "vitest";
import { z } from "zod";

import { Entity } from "./index.js";

const AccountId = z.uuid().brand("AccountId");
const Label = z.string().min(1).brand("Label");
const Upper = z.string().min(1).brand("Upper");

abstract class AccountBase extends Entity.abstract("Account")(
  { id: Entity.field(AccountId, { immutable: true }), label: Label },
  {
    computed: {
      shout: Entity.computed(Upper, (d) => d.label.toUpperCase()),
    },
  },
) {
  abstract describe(): string;
  get slug(): string {
    return this.label.toLowerCase();
  }
  relabel(next: z.infer<typeof Label>) {
    return this.update({ label: next });
  }
}

class Personal extends AccountBase.extend("Personal")({ kind: z.literal("personal") }) {
  // An `override` of an abstract member is the M3 regression guard: if the
  // behaviour type is ever built with `Omit` or a key-remapped mapped type,
  // `describe` arrives as a function-typed *property* and this line fails with
  // TS2425.
  override describe(): string {
    return `personal ${this.slug}`;
  }
}

class Business extends AccountBase.extend("Business")({
  kind: z.literal("business"),
  vat: Label,
}) {
  override describe(): string {
    return `business ${this.vat}`;
  }
}

test("a variant's instance carries the root's behaviour and its own fields", () => {
  const p = Personal.make({}).getOrThrow();
  const slug: string = p.slug;
  const described: string = p.describe();
  const label: z.infer<typeof Label> = p.label;
  const kind: "personal" = p.kind;
  const tag: "Personal" = p._tag;
  void slug;
  void described;
  void label;
  void kind;
  void tag;
  // @ts-expect-error the variant's data is still read-only
  p.label = label;
});

test("update from the root's body and from outside both yield the variant", () => {
  const p = Personal.make({}).getOrThrow();
  const renamed: typeof p = p.relabel("x" as z.infer<typeof Label>).getOrThrow();
  const patched: typeof p = p.update({ label: "x" as z.infer<typeof Label> }).getOrThrow();
  void renamed;
  void patched;
  // @ts-expect-error `id` is immutable on the root, and the variant inherits that
  p.update({ id: p.id });
});

test("Entity.Instance recovers the instance type", () => {
  const p: Entity.Instance<typeof Personal> = Personal.make({}).getOrThrow();
  const described: string = match(p)
    .with(P.tag("Personal"), (x) => x.describe())
    .exhaustive();
  void described;
});

test("a root is not an entity", () => {
  // @ts-expect-error a root has no `make` — it is not an entity
  AccountBase.make({});
  // @ts-expect-error a root has no schema members either
  void AccountBase.input;
});

test("a root's abstract member is an obligation on every variant", () => {
  // @ts-expect-error TS2515: `Forgot` does not implement inherited abstract member `describe`
  class Forgot extends AccountBase.extend("Forgot")({ note: Label }) {}
  void Forgot;
});

test("a root enforces the same field rules as a fresh declaration", () => {
  AccountBase.extend("Ok")({ ok: Label });
  // @ts-expect-error an unbranded field is rejected, exactly as in Entity(...)
  AccountBase.extend("Unbranded")({ plain: z.string() });
  // @ts-expect-error a reserved name is rejected, exactly as in Entity(...)
  AccountBase.extend("Reserved")({ update: Label });
});

test("a variant cannot shed the root's immutable keys", () => {
  class Noted extends AccountBase.extend("Noted")({
    note: Entity.field(Label, { immutable: true }),
  }) {
    override describe(): string {
      return "noted";
    }
  }
  const n = Noted.make({}).getOrThrow();
  n.update({ label: "x" as z.infer<typeof Label> });
  // @ts-expect-error `id` is the root's immutable flag, and flagging our own cannot shed it
  n.update({ id: n.id });
  // @ts-expect-error `note` is the variant's own immutable flag
  n.update({ note: n.note });
});

test("a redefined computed key takes the variant's type, not an intersection", () => {
  class Louder extends AccountBase.extend("Louder")(
    { note: Label },
    {
      computed: {
        shout: Entity.computed(Label, (d) => d.label.toLowerCase()),
      },
    },
  ) {
    override describe(): string {
      return "louder";
    }
  }
  // Read off `Entity.Output`, which is `OutputOf<S, A>` alone. An *instance* is
  // that intersected with `BehaviourOf<This>`, and a root's instance type
  // carries the root's data as well as its behaviour — so `l.shout` is measured
  // as `Label & Upper` whatever the computed merge says, and subtracting the
  // data is what TS2425 forbids (see `BehaviourOf` in `types.ts`). Every surface
  // reading `A` on its own — `__output`, `toJSON()`, `output.shape` — is clean.
  type Out = Entity.Output<typeof Louder>;
  // the root typed `shout` as Upper; the variant retypes it as Label. The
  // negative below is the whole guard: under a plain `A & A2` this key would be
  // `Upper & Label`, an intersection is assignable to *either* constituent, so
  // both lines would still compile and the failure would surface as the
  // directive going **unused** (`TS2578`) — not as the positive line breaking.
  const asLabel: z.infer<typeof Label> = null as unknown as Out["shout"];
  void asLabel;
  // @ts-expect-error the root's `Upper` brand is gone, not intersected in
  const asUpper: z.infer<typeof Upper> = null as unknown as Out["shout"];
  void asUpper;

  // The instance-level residue the comment above describes, asserted rather
  // than only narrated: `l.shout` satisfies *both* brands, so the day the
  // intersection stops surviving `BehaviourOf`, this stops compiling.
  const l = null as unknown as Entity.Instance<typeof Louder>;
  const instanceAsLabel: z.infer<typeof Label> = l.shout;
  const instanceAsUpper: z.infer<typeof Upper> = l.shout;
  void instanceAsLabel;
  void instanceAsUpper;
});

test("a variant cannot redeclare an inherited field with a different brand", () => {
  // The old semantics here were "the variant's brand wins, not an
  // intersection" — moot now that redeclaring `label` at all is rejected.
  // @ts-expect-error `label` is already declared by the root
  AccountBase.extend("Retyped")({ label: Upper });
});

test("a variant cannot redeclare an inherited field, flagged or not", () => {
  // AccountBase declares `label` — reuse the file's existing root fixture
  // @ts-expect-error `label` is already declared by the root
  AccountBase.extend("Clash")({ label: Label });
  // @ts-expect-error flagged redeclaration is equally rejected
  AccountBase.extend("Clash2")({ label: Entity.field(Label, { immutable: true }) });
});

void Business;
