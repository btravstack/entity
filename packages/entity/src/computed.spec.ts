import { P } from "unthrown";
import { expect, test } from "vitest";
import { z } from "zod";

import { Entity } from "./index.js";

const PersonId = z.uuid().brand("PersonId");
const NamePart = z.string().min(1).brand("NamePart");
const FullName = z.string().min(1).brand("FullName");
const Initials = z.string().min(1).brand("Initials");

class Person extends Entity("Person")(
  { id: PersonId, first: NamePart, last: NamePart },
  {
    immutable: ["id"],
    computed: {
      fullName: Entity.computed(FullName, (d) => `${d.first} ${d.last}`),
      initials: Entity.computed(Initials, (d) => `${d.first[0]}${d.last[0]}`),
    },
  },
) {}

const raw = { id: "0199b1f4-1b1e-7000-8000-000000000000", first: "Ada", last: "Lovelace" };

test("every computed field reaches the entity and its stored output", () => {
  const p = Person.make(raw).getOrThrow();
  expect(p.fullName).toBe("Ada Lovelace");
  expect(p.initials).toBe("AL");
  expect(p.toJSON()).toMatchObject({ fullName: "Ada Lovelace", initials: "AL" });
});

test("computed fields are in output but not in input", () => {
  expect(Object.keys(Person.output.shape).toSorted()).toEqual([
    "first",
    "fullName",
    "id",
    "initials",
    "last",
  ]);
  expect(Person.input.shape).not.toHaveProperty("fullName");
});

test("update re-derives every computed field instead of leaving them stale", () => {
  const p = Person.make(raw).getOrThrow();
  const renamed = p.update({ last: "Byron" as z.infer<typeof NamePart> }).getOrThrow();
  expect(renamed.fullName).toBe("Ada Byron");
  expect(renamed.initials).toBe("AB");
  expect(p.fullName).toBe("Ada Lovelace");
});

test("make re-derives rather than trusting a stale stored value", () => {
  const p = Person.make({ ...raw, fullName: "Whatever Was Written Before" }).getOrThrow();
  expect(p.fullName).toBe("Ada Lovelace");
});

test("make heals a row whose stored computed value is invalid", () => {
  // "" would fail FullName's own min(1); validating it would reject the very
  // row this is meant to repair
  const p = Person.make({ ...raw, fullName: "", initials: "" }).getOrThrow();
  expect(p.fullName).toBe("Ada Lovelace");
});

test("make heals a row written before the computed field existed", () => {
  const p = Person.make(raw).getOrThrow();
  expect(p.fullName).toBe("Ada Lovelace");
  expect(p.initials).toBe("AL");
});

test("computed fields are absent from updateInput and rejected if smuggled in", () => {
  expect(Object.keys(Person.updateInput.shape).toSorted()).toEqual(["first", "last"]);
  const p = Person.make(raw).getOrThrow();
  // patching a derived value is a contradiction — it would be overwritten by
  // the next derivation — so it is reported rather than quietly discarded
  const messages = p.update({ fullName: "LIES" } as never).match({
    ok: () => ["WRONGLY ACCEPTED"],
    errCases: (m) => m.with(P.tag("InvalidEntity"), (e) => e.issues.map((i) => i.message)),
    defect: () => ["DEFECT"],
  });
  expect(messages).toEqual([
    "Computed field — cannot be patched, it is re-derived from its sources",
  ]);
  expect(p.fullName).toBe("Ada Lovelace");
});

test("make still ignores extra keys, so a stored row round-trips", () => {
  // `update` is strict about caller intent; `make` stays lenient about stored
  // data, which carries computed columns and may predate a field
  expect(Person.make({ ...raw, legacyColumn: "x" }).getOrThrow().fullName).toBe("Ada Lovelace");
});

test("toJSON round-trips through make", () => {
  const p = Person.make(raw).getOrThrow();
  expect(Person.make(p.toJSON()).getOrThrow().fullName).toBe("Ada Lovelace");
});

test("an invariant constrains a computed value through its sources", () => {
  // A rule reads the *declared* fields, never a computed one. Every computed
  // value is a function of declared data, so the rule is expressed over the
  // sources it derives from — here, the length `fullName` will end up with.
  class Checked extends Entity("Checked")(
    { id: PersonId, first: NamePart, last: NamePart },
    {
      computed: {
        fullName: Entity.computed(FullName, (d) => `${d.first} ${d.last}`),
      },
      invariants: [
        Entity.invariant(
          (d) => d.first.length + 1 + d.last.length <= 20,
          "fullName must be at most 20 chars",
        ),
      ],
    },
  ) {}
  expect(Checked.make(raw).isOk()).toBe(true);
  expect(Checked.make({ ...raw, last: "Lovelace-Byron-Of-Somewhere" }).isErr()).toBe(true);
});

const outcomeOf = (r: ReturnType<typeof Person.make>) =>
  r.match({
    ok: () => "WRONGLY ACCEPTED",
    errCases: (m) => m.with(P.tag("InvalidEntity"), () => "invalid"),
    defect: () => "defect",
  });

test("computed output failing its own schema is a defect, not bad input", () => {
  class Broken extends Entity("Broken")(
    { id: PersonId, first: NamePart, last: NamePart },
    {
      // FullName requires at least 1 char; this returns an empty string
      computed: {
        fullName: Entity.computed(FullName, () => ""),
      },
    },
  ) {}
  expect(outcomeOf(Broken.make(raw) as never)).toBe("defect");
});

test("a throwing derivation is a defect, not an escaped exception", () => {
  class Throws extends Entity("Throws")(
    { id: PersonId, first: NamePart, last: NamePart },
    {
      computed: {
        fullName: Entity.computed(FullName, () => {
          // oxlint-disable-next-line unthrown/no-throw
          throw new Error("boom");
        }),
      },
    },
  ) {}
  // the point is that this does NOT throw out of decode()
  expect(outcomeOf(Throws.make(raw) as never)).toBe("defect");
});

test("a defect names the field that produced it", () => {
  class Broken extends Entity("Broken")(
    { id: PersonId, first: NamePart, last: NamePart },
    {
      computed: {
        initials: Entity.computed(Initials, () => ""),
      },
    },
  ) {}
  let message = "";
  try {
    Broken.make(raw).getOrThrow();
  } catch (e) {
    message = (e as Error).message;
  }
  expect(message).toContain("Broken.computed.initials");
});

test("a field transform is applied exactly once, not once per validation pass", () => {
  let calls = 0;
  const Counted = z
    .string()
    .transform((s) => {
      calls += 1;
      return s;
    })
    .brand("NamePart");
  class Once extends Entity("Once")({ id: PersonId, first: Counted }) {}
  Once.make({ id: raw.id, first: "Ada" }).getOrThrow();
  expect(calls).toBe(1);
});
