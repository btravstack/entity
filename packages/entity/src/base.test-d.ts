import { match, P } from "unthrown";
import { test } from "vitest";
import { z } from "zod";

import { Entity } from "./index.js";

const AccountId = z.uuid().brand("AccountId");
const Label = z.string().min(1).brand("Label");

abstract class AccountBase extends Entity.abstract("Account")(
  { id: AccountId, label: Label },
  { immutable: ["id"] },
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

void Business;
