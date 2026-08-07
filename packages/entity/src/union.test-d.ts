import { match, P } from "unthrown";
import { test } from "vitest";
import { z } from "zod";

import { Entity, union } from "./index.js";

const UserId = z.uuid().brand("UserId");
const Email = z.email().brand("Email");
const Label = z.string().min(1).brand("Label");

class User extends Entity("User")({ kind: z.literal("user"), id: UserId, email: Email }) {}
class Svc extends Entity("Svc")({ kind: z.literal("svc"), id: UserId, label: Label }) {}

const Member = union("kind", [User, Svc]);

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
  union("kind", [User]);
});
