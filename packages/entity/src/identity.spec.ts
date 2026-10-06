import { expect, test } from "vitest";
import { z } from "zod";

import { Entity } from "./index.js";

const OrgId = z.uuid().brand("OrgId");
const Name = z.string().min(1).brand("Name");
const Region = z.enum(["EU", "US"]);
const Seq = z.number().int().brand("Seq");

const a = "0199b1f4-1b1e-7000-8000-000000000000";
const b = "0199b1f4-1b1e-7000-8000-000000000001";

class Org extends Entity("Org")({
  id: Entity.field(OrgId, { identity: true }),
  name: Name,
}) {}

test("same identity with different attributes is the same entity", () => {
  const acme = Org.make({ id: a, name: "Acme" }).getOrThrow();
  const renamed = acme.update({ name: Name.parse("Acme SAS") }).getOrThrow();
  expect(renamed.sameIdentityAs(acme)).toBe(true);
  expect(renamed.toJSON()).not.toEqual(acme.toJSON());
});

test("a different id is a different entity, whatever else matches", () => {
  const one = Org.make({ id: a, name: "Acme" }).getOrThrow();
  const other = Org.make({ id: b, name: "Acme" }).getOrThrow();
  expect(one.sameIdentityAs(other)).toBe(false);
  expect(one.sameIdentityAs(one)).toBe(true);
});

test("unrelated entities with equal ids are never the same entity", () => {
  class Team extends Entity("Team")({
    id: Entity.field(OrgId, { identity: true }),
    name: Name,
  }) {}
  const org = Org.make({ id: a, name: "Acme" }).getOrThrow();
  const team = Team.make({ id: a, name: "Acme" }).getOrThrow();
  expect(org.sameIdentityAs(team)).toBe(false);
  expect(team.sameIdentityAs(org)).toBe(false);
});

test("a non-entity is never the same entity, and comparing does not throw", () => {
  const org = Org.make({ id: a, name: "Acme" }).getOrThrow();
  expect(org.sameIdentityAs({ id: a, name: "Acme" })).toBe(false);
  expect(org.sameIdentityAs(null)).toBe(false);
  expect(org.sameIdentityAs(undefined)).toBe(false);
});

test("a composite identity needs every part to match", () => {
  class Ticket extends Entity("Ticket")({
    region: Entity.field(Region, { identity: true }),
    seq: Entity.field(Seq, { identity: true }),
    title: Name,
  }) {}
  const t = (region: string, seq: number, title = "x") =>
    Ticket.make({ region, seq, title }).getOrThrow();
  expect(t("EU", 1).sameIdentityAs(t("EU", 1, "renamed"))).toBe(true);
  expect(t("EU", 1).sameIdentityAs(t("US", 1))).toBe(false);
  expect(t("EU", 1).sameIdentityAs(t("EU", 2))).toBe(false);
});

test("an identity field is immutable: update refuses it at runtime too", () => {
  expect(Object.keys(Org.updateInput.shape)).toEqual(["name"]);
  const org = Org.make({ id: a, name: "Acme" }).getOrThrow();
  expect(org.update({ id: b } as never).isErr()).toBe(true);
});

/* ── Lifecycle variants ─────────────────────────────────────────────── */

const DocumentBase = Entity.abstract("Document")({
  id: Entity.field(OrgId, { identity: true }),
  title: Name,
});
class Draft extends DocumentBase.extend("Draft")({ status: z.literal("DRAFT") }) {}
class Published extends DocumentBase.extend("Published")({ status: z.literal("PUBLISHED") }) {}

test("identity declared on a root spans its variants: a draft and what it became", () => {
  const draft = Draft.make({ id: a, title: "Plan", status: "DRAFT" }).getOrThrow();
  const published = Published.make({ id: a, title: "Plan v2", status: "PUBLISHED" }).getOrThrow();
  expect(draft.sameIdentityAs(published)).toBe(true);
  expect(published.sameIdentityAs(draft)).toBe(true);
  const another = Published.make({ id: b, title: "Plan", status: "PUBLISHED" }).getOrThrow();
  expect(draft.sameIdentityAs(another)).toBe(false);
});

test("identity declared per variant stays within that variant", () => {
  const Root = Entity.abstract("Root")({ title: Name });
  class Left extends Root.extend("Left")({ id: Entity.field(OrgId, { identity: true }) }) {}
  class Right extends Root.extend("Right")({ id: Entity.field(OrgId, { identity: true }) }) {}
  const left = Left.make({ id: a, title: "x" }).getOrThrow();
  const right = Right.make({ id: a, title: "x" }).getOrThrow();
  expect(left.sameIdentityAs(right)).toBe(false);
  expect(left.sameIdentityAs(Left.make({ id: a, title: "y" }).getOrThrow())).toBe(true);
});

test("a variant may not add identity fields to a root that already declares them", () => {
  expect(() => DocumentBase.extend("Odd")({ seq: Entity.field(Seq, { identity: true }) })).toThrow(
    /Odd: .*root.*identity/u,
  );
});

test("union members compare through their shared root", () => {
  const Doc = Entity.union("status", [Draft, Published]);
  const draft = Doc.make({ id: a, title: "Plan", status: "DRAFT" }).getOrThrow();
  const published = Doc.make({ id: a, title: "Plan", status: "PUBLISHED" }).getOrThrow();
  expect(draft.sameIdentityAs(published)).toBe(true);
});
