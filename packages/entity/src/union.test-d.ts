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
  get slug(): string {
    return this.label.toLowerCase();
  }
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

class Account extends Entity.union("kind", [Personal, Business]) {}
class Mixed extends Entity.union("kind", [User, Personal]) {}

// `declare` is illegal inside a function body, so both annotations live here.
declare const anyAccount: Account;
declare const anyMixed: Mixed;

test("a union class is usable as a type — the members' shared root", () => {
  const described: string = anyAccount.describe();
  const slug: string = anyAccount.slug;
  void described;
  void slug;
  // @ts-expect-error the supertype is the shared root, not either variant
  void anyAccount.kind;
});

test("Entity.Instance recovers the exact member union", () => {
  const x = Account.make({}).getOrThrow();
  const y: Entity.Instance<typeof Account> = x;
  const described: string = match(y)
    .with(P.tag("Personal"), (p) => p.describe())
    .with(P.tag("Business"), (b) => b.describe())
    .exhaustive();
  void described;
});

test("members from different roots claim no shared supertype", () => {
  // `User` is declared straight from `Entity(...)`, so its `__base` is the
  // empty type; `Personal`'s is `AccountBase`. Two different types is a union,
  // which `SoleType` refuses to claim.
  // @ts-expect-error nothing is shared, so nothing is claimed
  void anyMixed.describe();
});
