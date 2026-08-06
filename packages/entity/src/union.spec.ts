import { match, P } from "unthrown";
import { expect, test } from "vitest";
import { z } from "zod";

import { Entity } from "./index.js";

const UserId = z.uuid().brand("UserId");
const SvcId = z.uuid().brand("SvcId");
const Email = z.email().brand("Email");
const Label = z.string().min(1).brand("Label");

// the discriminant is a declared DOMAIN field, because _tag never reaches the wire
class User extends Entity("User")({
  kind: z.literal("user"),
  id: UserId,
  email: Email,
}) {}
class ServiceAccount extends Entity("ServiceAccount")({
  kind: z.literal("service_account"),
  id: SvcId,
  label: Label,
}) {}

const Member = z.discriminatedUnion("kind", [User.decoded, ServiceAccount.decoded]);

const userRow = {
  kind: "user",
  id: "0199b1f4-1b1e-7000-8000-000000000000",
  email: "a@b.com",
};
const svcRow = {
  kind: "service_account",
  id: "0199b1f4-1b1e-7000-8000-000000000001",
  label: "deploy-bot",
};

test("the discriminated union parses both members", () => {
  expect(Member.parse(userRow).kind).toBe("user");
  expect(Member.parse(svcRow).kind).toBe("service_account");
});

test("the union rejects an unknown discriminant", () => {
  expect(Member.safeParse({ ...userRow, kind: "nope" }).success).toBe(false);
});

test("the union generates JSON Schema in BOTH directions, one branch per member", () => {
  for (const io of ["input", "output"] as const) {
    const js = z.toJSONSchema(Member, { io }) as { anyOf?: unknown[]; oneOf?: unknown[] };
    expect((js.anyOf ?? js.oneOf ?? []).length).toBe(2);
  }
});

test("a union of instance surfaces yields the right class", () => {
  const Instances = z.union([User.instance, ServiceAccount.instance]);
  expect(Instances.parse(userRow)).toBeInstanceOf(User);
  expect(Instances.parse(svcRow)).toBeInstanceOf(ServiceAccount);
});

const describe = (m: User | ServiceAccount) =>
  match(m)
    .with(P.tag("User"), (u) => `user:${u.email}`)
    .with(P.tag("ServiceAccount"), (s) => `svc:${s.label}`)
    .exhaustive();

test("entities match with P.tag on the runtime tag", () => {
  expect(describe(User.decode(userRow).getOrThrow())).toBe("user:a@b.com");
  expect(describe(ServiceAccount.decode(svcRow).getOrThrow())).toBe("svc:deploy-bot");
});
