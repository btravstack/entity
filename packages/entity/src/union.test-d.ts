import { match, P } from "unthrown";
import { test } from "vitest";
import { z } from "zod";

import { Entity } from "./index.js";

const UserId = z.uuid().brand("UserId");
const Email = z.email().brand("Email");
const Label = z.string().min(1).brand("Label");

class User extends Entity("User")({ kind: z.literal("user"), id: UserId, email: Email }) {}
class Svc extends Entity("Svc")({ kind: z.literal("svc"), id: UserId, label: Label }) {}

const Member = Entity.union("kind", [User, Svc]);

test("make yields the member union, not unknown", () => {
  const m = Member.make({}).getOrThrow();
  // reachable only if the union type is precise
  const email: z.infer<typeof Email> | undefined =
    "kind" in m && m.kind === "user" ? m.email : undefined;
  void email;
  // @ts-expect-error `label` is not on the `user` branch
  const wrong = m.kind === "user" ? m.label : undefined;
  void wrong;
});

test("the union is exhaustively matchable on the runtime tag", () => {
  const m = Member.make({}).getOrThrow();
  const described: string = match(m)
    .with(P.tag("User"), (u) => u.email as string)
    .with(P.tag("Svc"), (s) => s.label as string)
    .exhaustive();
  void described;
});

test("a union needs at least two members", () => {
  // @ts-expect-error one member is not a union
  Entity.union("kind", [User]);
});

const AcctId = z.uuid().brand("AcctId");

abstract class AccountBase extends Entity.abstract("Account")({ id: AcctId, label: Label }) {
  abstract describe(): string;
}
class Personal extends AccountBase.extend("Personal")({ kind: z.literal("personal") }) {
  override describe(): string {
    return "personal";
  }
}
class Business extends AccountBase.extend("Business")({ kind: z.literal("business") }) {
  override describe(): string {
    return "business";
  }
}

const Account = Entity.union("kind", [Personal, Business]);
type Account = Entity.Instance<typeof Account>;

declare const p: Account;

test("a union has no class form", () => {
  // The class form typed as the members' shared root and could not narrow
  // (#57). `TS2507` is what fires below; `TS2509` is why it is unfixable — a
  // class's instance type cannot be a union at all — so the value plus
  // `Entity.Instance` is the only honest spelling.
  // @ts-expect-error a union is a value, not a constructor
  class Nope extends Entity.union("kind", [Personal, Business]) {}
  void Nope;
});

test("the const plus Entity.Instance pair narrows to a member", () => {
  // narrowing on `_tag` reaches the member's own literal `kind` value —
  // without it, `p.kind` stays the two-member union and the annotation fails
  const onTag: "personal" = p._tag === "Personal" ? p.kind : "personal";
  void onTag;
  // narrowing on the declared discriminant reaches the member's own `_tag` —
  // without it, `p._tag` stays "Personal" | "Business" and the annotation fails
  const onDiscriminant: "Personal" = p.kind === "personal" ? p._tag : "Personal";
  void onDiscriminant;
});

test("a union's instance type still carries the root's behaviour", () => {
  // pins, at the type level, that Account (Personal | Business) keeps
  // AccountBase's abstract `describe` — the class-form test for this was
  // deleted with #57; `union.spec.ts` only exercises it at runtime
  const described: string = p.describe();
  void described;
});
