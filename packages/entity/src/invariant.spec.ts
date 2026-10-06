import { P } from "unthrown";
import { expect, test } from "vitest";
import { z } from "zod";

import { Entity } from "./index.js";

const Step = z.enum(["RUNNING", "ERROR"]);
const Reason = z.string().min(1).brand("Reason");
const Label = z.string().min(1).brand("Label");

class Mission extends Entity("Mission")(
  { kind: z.literal("mission"), step: Step, reason: Reason.optional(), label: Label },
  {
    invariants: [
      Entity.invariant(
        (d) => d.step !== "ERROR" || d.reason !== undefined,
        (d) => `a mission in step ${d.step} must carry the reason it failed`,
        { code: "MISSING_FAILURE_REASON" },
      ),
      Entity.invariant((d) => d.label !== "forbidden", "label is forbidden", {
        code: "FORBIDDEN_LABEL",
      }),
      Entity.invariant((d) => d.label.length <= 20, "label must be at most 20 chars"),
    ],
  },
) {}

class Note extends Entity("Note")({ kind: z.literal("note"), label: Label }) {}

const broken = { kind: "mission", step: "ERROR", label: "forbidden" };

/** Every issue as `[path, code]`, the shape a client keys behaviour off. */
const issuesOf = (result: ReturnType<typeof Mission.make>) =>
  result.match({
    ok: () => [],
    errCases: (m) =>
      m.with(P.tag("InvalidEntity"), (e) =>
        e.issues.map((issue) => [Entity.keysOf(issue), Entity.codeOf(issue)] as const),
      ),
    defect: () => [],
  });

test("every failing rule reports its own stable code", () => {
  expect(issuesOf(Mission.make(broken))).toEqual([
    [[], "MISSING_FAILURE_REASON"],
    [[], "FORBIDDEN_LABEL"],
  ]);
});

test("the message varies with the data; the code does not", () => {
  const rendered = Mission.make(broken).match({
    ok: () => [],
    errCases: (m) => m.with(P.tag("InvalidEntity"), (e) => e.issues.map((i) => i.message)),
    defect: () => [],
  });
  expect(rendered[0]).toBe("a mission in step ERROR must carry the reason it failed");
  expect(issuesOf(Mission.make(broken))[0]?.[1]).toBe("MISSING_FAILURE_REASON");
});

test("a message-only rule keeps its exact issue shape and has no code", () => {
  const result = Mission.make({ kind: "mission", step: "RUNNING", label: "x".repeat(21) });
  const issues = result.match({
    ok: () => [],
    errCases: (m) => m.with(P.tag("InvalidEntity"), (e) => e.issues),
    defect: () => [],
  });
  expect(issues).toEqual([{ message: "label must be at most 20 chars" }]);
  expect(Entity.codeOf(issues[0]!)).toBeUndefined();
});

test("a schema-validation issue carries no domain code", () => {
  const [issue] = issuesOf(Mission.make({ ...broken, label: "" }));
  expect(issue).toEqual([["label"], undefined]);
});

test("a code survives a nested entity, at the field's path", () => {
  class Holder extends Entity("Holder")({ mission: Mission }) {}
  const issues = Holder.make({ mission: broken }).match({
    ok: () => [],
    errCases: (m) =>
      m.with(P.tag("InvalidEntity"), (e) =>
        e.issues.map((issue) => [Entity.keysOf(issue), Entity.codeOf(issue)]),
      ),
    defect: () => [],
  });
  expect(issues).toEqual([
    [["mission"], "MISSING_FAILURE_REASON"],
    [["mission"], "FORBIDDEN_LABEL"],
  ]);
});

test("a code survives an array of entities, two levels down", () => {
  class Holder extends Entity("Holder")({ missions: z.array(Mission) }) {}
  class Outer extends Entity("Outer")({ holder: Holder }) {}
  const issues = Outer.make({ holder: { missions: [{ ...broken, step: "RUNNING" }] } }).match({
    ok: () => [],
    errCases: (m) =>
      m.with(P.tag("InvalidEntity"), (e) =>
        e.issues.map((issue) => [Entity.keysOf(issue), Entity.codeOf(issue)]),
      ),
    defect: () => [],
  });
  expect(issues).toEqual([[["holder", "missions", 0], "FORBIDDEN_LABEL"]]);
});

test("a code survives a union, directly and as a field", () => {
  const Item = Entity.union("kind", [Mission, Note]);
  const direct = Item.make(broken).match({
    ok: () => [],
    errCases: (m) => m.with(P.tag("InvalidEntity"), (e) => e.issues.map(Entity.codeOf)),
    defect: () => [],
  });
  expect(direct).toEqual(["MISSING_FAILURE_REASON", "FORBIDDEN_LABEL"]);

  class Holder extends Entity("Holder")({ item: Item }) {}
  const nested = Holder.make({ item: broken }).match({
    ok: () => [],
    errCases: (m) =>
      m.with(P.tag("InvalidEntity"), (e) =>
        e.issues.map((issue) => [Entity.keysOf(issue), Entity.codeOf(issue)]),
      ),
    defect: () => [],
  });
  expect(nested).toEqual([
    [["item"], "MISSING_FAILURE_REASON"],
    [["item"], "FORBIDDEN_LABEL"],
  ]);
});

test("update reports the same codes as make", () => {
  const fine = Mission.make({ kind: "mission", step: "RUNNING", label: "ok" }).getOrThrow();
  const issues = fine.update({ step: "ERROR" }).match({
    ok: () => [],
    errCases: (m) => m.with(P.tag("InvalidEntity"), (e) => e.issues.map(Entity.codeOf)),
    defect: () => [],
  });
  expect(issues).toEqual(["MISSING_FAILURE_REASON"]);
});

test("codeOf reads a field schema's own refine params too, and ignores a non-string", () => {
  expect(Entity.codeOf({ message: "m", params: { code: "X" } } as never)).toBe("X");
  expect(Entity.codeOf({ message: "m", params: { code: 1 } } as never)).toBeUndefined();
  expect(Entity.codeOf({ message: "m" })).toBeUndefined();
});
