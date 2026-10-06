import { P } from "unthrown";
import { expect, test } from "vitest";
import { z } from "zod";

import { Entity } from "./index.js";

const Step = z.enum(["RUNNING", "ERROR"]);
const Reason = z.string().min(1).brand("Reason");
const Label = z.string().min(1).brand("Label");
const Upper = z.string().min(1).brand("Upper");

const fields = { kind: z.literal("mission"), step: Step, reason: Reason.optional(), label: Label };

/** Monday's model: a failed mission may or may not say why. */
class MissionV1 extends Entity("Mission")(fields) {}

/** Tuesday's model: the same fields, and a rule the stored rows predate. */
class Mission extends Entity("Mission")(fields, {
  computed: { shout: Entity.computed(Upper, (d) => d.label.toUpperCase()) },
  invariants: [
    Entity.invariant({
      code: "MISSING_FAILURE_REASON",
      ensure: (d) => d.step !== "ERROR" || d.reason !== undefined,
      message: "a mission in step ERROR must carry the reason it failed",
    }),
  ],
}) {}

/** Written under Monday's rules, and still sitting in the table. */
const legacy = { kind: "mission", step: "ERROR", label: "relocation" };

const codesOf = (result: ReturnType<typeof Mission.make>) =>
  result.match({
    ok: () => [],
    errCases: (m) => m.with(P.tag("InvalidEntity"), (e) => e.issues.map(Entity.codeOf)),
    defect: () => ["DEFECT"],
  });

test("a worked rollout: the old row stays readable, and the new rule still governs commands", () => {
  // the row was valid when it was written
  expect(MissionV1.make(legacy).isOk()).toBe(true);

  // the strict door refuses it, naming the rule
  expect(codesOf(Mission.make(legacy))).toEqual(["MISSING_FAILURE_REASON"]);

  // the inspection door hands back its data and the same violation
  const { data, violations } = Mission.inspect(legacy).getOrThrow();
  expect(data).toEqual({
    kind: "mission",
    step: "ERROR",
    reason: undefined,
    label: "relocation",
    shout: "RELOCATION",
  });
  expect(violations).toEqual([
    {
      message: "a mission in step ERROR must carry the reason it failed",
      params: { code: "MISSING_FAILURE_REASON" },
    },
  ]);
  expect(violations.map(Entity.codeOf)).toEqual(["MISSING_FAILURE_REASON"]);

  // a new transition into ERROR is still held to the current rule
  const running = Mission.make({ ...legacy, step: "RUNNING" }).getOrThrow();
  const failed = running.update({ step: Step.parse("ERROR") });
  expect(
    failed.match({
      ok: () => [],
      errCases: (m) => m.with(P.tag("InvalidEntity"), (e) => e.issues.map(Entity.codeOf)),
      defect: () => ["DEFECT"],
    }),
  ).toEqual(["MISSING_FAILURE_REASON"]);

  // and the only way back to the command model is a migration, then `make`
  const migrated = { ...data, reason: "unknown, predates the rule" };
  expect(Mission.make(migrated).isOk()).toBe(true);
});

test("a row that satisfies every rule inspects to exactly what make stores", () => {
  const row = { ...legacy, reason: "lost keys" };
  const { data, violations } = Mission.inspect(row).getOrThrow();
  expect(violations).toEqual([]);
  expect(data).toEqual(Mission.make(row).getOrThrow().toJSON());
});

test("the data is plain and frozen: no tag, no class, no methods", () => {
  const { data } = Mission.inspect(legacy).getOrThrow();
  expect(Object.getPrototypeOf(data)).toBe(Object.prototype);
  expect(data).not.toBeInstanceOf(Mission);
  expect("_tag" in data).toBe(false);
  expect("update" in data).toBe(false);
  expect(Object.isFrozen(data)).toBe(true);
});

test("a field-schema failure is InvalidEntity, not a violation", () => {
  const result = Mission.inspect({ ...legacy, label: "" });
  const outcome = result.match({
    ok: () => "OK",
    errCases: (m) =>
      m.with(P.tag("InvalidEntity"), (e) => e.issues.map((i) => Entity.keysOf(i).join("."))),
    defect: () => "DEFECT",
  });
  expect(outcome).toEqual(["label"]);
});

test("a predicate that throws is a defect, as it is under make", () => {
  class Fragile extends Entity("Fragile")(
    { label: Label },
    {
      invariants: [
        Entity.invariant({
          code: "BROKEN_RULE",
          ensure: () => {
            // oxlint-disable-next-line unthrown/no-throw -- the bug under test
            throw new Error("bug in the rule");
          },
          message: "never rendered",
        }),
      ],
    },
  ) {}
  expect(Fragile.inspect({ label: "x" }).isDefect()).toBe(true);
  expect(Fragile.make({ label: "x" }).isDefect()).toBe(true);
});

test("a nested entity is inspected strictly: its own broken rule fails the parent", () => {
  class Crew extends Entity("Crew")({ mission: Mission, label: Label }) {}
  const outcome = Crew.inspect({ mission: legacy, label: "night shift" }).match({
    ok: () => [],
    errCases: (m) =>
      m.with(P.tag("InvalidEntity"), (e) =>
        e.issues.map((i) => [Entity.keysOf(i), Entity.codeOf(i)]),
      ),
    defect: () => ["DEFECT"],
  });
  expect(outcome).toEqual([[["mission"], "MISSING_FAILURE_REASON"]]);
});

test("a variant reports the rules it inherits from its root", () => {
  const Root = Entity.abstract("Job")(fields, {
    invariants: [
      Entity.invariant({
        code: "MISSING_FAILURE_REASON",
        ensure: (d) => d.step !== "ERROR" || d.reason !== undefined,
        message: "a job in step ERROR must carry the reason it failed",
      }),
    ],
  });
  class Export extends Root.extend("Export")({ target: Label }) {}
  const { violations } = Export.inspect({ ...legacy, target: "s3" }).getOrThrow();
  expect(violations.map(Entity.codeOf)).toEqual(["MISSING_FAILURE_REASON"]);
});

test("a union dispatches inspect on its discriminant, like make", () => {
  class Note extends Entity("Note")({ kind: z.literal("note"), label: Label }) {}
  const Item = Entity.union("kind", [Mission, Note]);

  const mission = Item.inspect(legacy).getOrThrow();
  expect(mission.violations.map(Entity.codeOf)).toEqual(["MISSING_FAILURE_REASON"]);

  const note = Item.inspect({ kind: "note", label: "x" }).getOrThrow();
  expect(note).toEqual({ data: { kind: "note", label: "x" }, violations: [] });

  expect(Item.inspect({ kind: "nope" }).isErr()).toBe(true);
});
