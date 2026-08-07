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

const Member = Entity.union("kind", [User, ServiceAccount]);

const userRow = { kind: "user", id: "0199b1f4-1b1e-7000-8000-000000000000", email: "a@b.com" };
const svcRow = {
  kind: "service_account",
  id: "0199b1f4-1b1e-7000-8000-000000000001",
  label: "deploy-bot",
};

test("make yields the right class for each member", () => {
  expect(Member.make(userRow).getOrThrow()).toBeInstanceOf(User);
  expect(Member.make(svcRow).getOrThrow()).toBeInstanceOf(ServiceAccount);
});

test("the resulting instance keeps its behaviour and tag", () => {
  const m = Member.make(userRow).getOrThrow();
  const described = match(m)
    .with(P.tag("User"), (u) => `user:${u.email}`)
    .with(P.tag("ServiceAccount"), (s) => `svc:${s.label}`)
    .exhaustive();
  expect(described).toBe("user:a@b.com");
});

test("an unknown discriminant fails with the key and the options", () => {
  const issues = Member.make({ ...userRow, kind: "nope" }).match({
    ok: () => [] as readonly string[],
    errCases: (m) => m.with(P.tag("InvalidEntity"), (e) => e.issues.map((i) => i.message)),
    defect: () => ["DEFECT"],
  });
  expect(issues[0]).toContain('Invalid discriminant "nope"');
  expect(issues[0]).toContain('"user"');
  expect(issues[0]).toContain('"service_account"');
});

test("a member's own validation failure reports only that member's issues", () => {
  // dispatching on the discriminant is what keeps this from reporting every
  // branch's complaints, which is what a plain z.union would do
  const issues = Member.make({ ...userRow, email: "not-an-email" }).match({
    ok: () => [] as readonly string[],
    errCases: (m) =>
      m.with(P.tag("InvalidEntity"), (e) => e.issues.map((i) => String(i.path?.[0]))),
    defect: () => ["DEFECT"],
  });
  expect(issues).toEqual(["email"]);
});

test("input and output generate JSON Schema in both directions, one branch per member", () => {
  for (const io of ["input", "output"] as const) {
    for (const schema of [Member.input, Member.output]) {
      const js = z.toJSONSchema(schema, { io }) as { anyOf?: unknown[]; oneOf?: unknown[] };
      expect((js.anyOf ?? js.oneOf ?? []).length).toBe(2);
    }
  }
});

test("the union is a schema too, parsing to the member class and nesting", () => {
  expect(z.array(Member).parse([userRow])[0]).toBeInstanceOf(User);
  const Wrapper = z.object({ member: Member });
  expect(Wrapper.parse({ member: svcRow }).member).toBeInstanceOf(ServiceAccount);
});

test("a nested member failure keeps the outer path", () => {
  const result = z.object({ member: Member }).safeParse({ member: { ...userRow, email: "nope" } });
  expect(result.success).toBe(false);
  if (!result.success) {
    expect(result.error.issues[0]?.path).toEqual(["member", "email"]);
  }
});

test("the members are reachable, for exhaustiveness and registries", () => {
  expect(Member.discriminant).toBe("kind");
  expect(Member.members.map((m) => m.entityName)).toEqual(["User", "ServiceAccount"]);
});

test("a union member can itself be a field of another entity", () => {
  class Audit extends Entity("Audit")({ id: UserId, actor: Member }) {}
  const a = Audit.make({ id: userRow.id, actor: svcRow }).getOrThrow();
  expect(a.actor).toBeInstanceOf(ServiceAccount);
});

/**
 * A member's discriminant may be an enum or a multi-value literal, not only a
 * single `z.literal`. `shape.ts` blesses `z.enum([...])` as nominal and
 * `z.discriminatedUnion` dispatches on it, so reading a singular `.value` made
 * `input` and `make` disagree — and registered the member under `undefined`,
 * which swallowed every payload that omitted the discriminant.
 */
const Tier = z.enum(["silver", "gold"]);

class Member2Free extends Entity("Member2Free")({ plan: z.literal("free"), id: UserId }) {}
class Member2Paid extends Entity("Member2Paid")({ plan: Tier, id: UserId, label: Label }) {}
const Plan = Entity.union("plan", [Member2Free, Member2Paid]);

const paidRow = { id: "0199b1f4-1b1e-7000-8000-000000000000", label: "x" };

test("an enum discriminant routes on every one of its values", () => {
  expect(Plan.make({ ...paidRow, plan: "silver" }).getOrThrow()).toBeInstanceOf(Member2Paid);
  expect(Plan.make({ ...paidRow, plan: "gold" }).getOrThrow()).toBeInstanceOf(Member2Paid);
  expect(Plan.make({ id: paidRow.id, plan: "free" }).getOrThrow()).toBeInstanceOf(Member2Free);
});

test("`input` and `make` agree on an enum discriminant", () => {
  const row = { ...paidRow, plan: "silver" };
  expect(Plan.input.safeParse(row).success).toBe(true);
  expect(Plan.make(row).isOk()).toBe(true);
});

test("a payload missing the discriminant is not misrouted to a member", () => {
  const message = Plan.make({ id: paidRow.id }).match({
    ok: () => "WRONGLY ACCEPTED",
    errCases: (m) => m.with(P.tag("InvalidEntity"), (e) => e.issues[0]?.message ?? ""),
    defect: () => "DEFECT",
  });
  expect(message).toBe('Invalid discriminant undefined; expected one of "free", "silver", "gold"');
});

test("a multi-value literal discriminant does not throw at construction", () => {
  class Wide extends Entity("Wide")({ plan: z.literal(["bronze", "tin"]), id: UserId }) {}
  const U = Entity.union("plan", [Member2Free, Wide]);
  expect(U.make({ id: paidRow.id, plan: "tin" }).getOrThrow()).toBeInstanceOf(Wide);
});
