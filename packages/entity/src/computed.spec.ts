import { P } from "unthrown";
import { expect, test } from "vitest";
import { z } from "zod";

import { Entity, computed } from "./index.js";

const PersonId = z.uuid().brand("PersonId");
const NamePart = z.string().min(1).brand("NamePart");
const FullName = z.string().min(1).brand("FullName");

class Person extends Entity("Person")(
  { id: PersonId, first: NamePart, last: NamePart },
  {
    immutable: ["id"],
    computed: computed({ fullName: FullName }, (d) => ({
      fullName: `${d.first} ${d.last}` as z.infer<typeof FullName>,
    })),
  },
) {}

const raw = { id: "0199b1f4-1b1e-7000-8000-000000000000", first: "Ada", last: "Lovelace" };

test("a computed field reaches the entity and its stored output", () => {
  const p = Person.decode(raw).getOrThrow();
  expect(p.fullName).toBe("Ada Lovelace");
  expect(p.toJSON().fullName).toBe("Ada Lovelace");
});

test("a computed field is in decoded but not in encoded", () => {
  expect(Person.decoded.shape).toHaveProperty("fullName");
  expect(Person.encoded.shape).not.toHaveProperty("fullName");
});

test("update re-derives the computed field instead of leaving it stale", () => {
  const p = Person.decode(raw).getOrThrow();
  const renamed = p.update({ last: "Byron" as z.infer<typeof NamePart> }).getOrThrow();
  expect(renamed.last).toBe("Byron");
  expect(renamed.fullName).toBe("Ada Byron");
  expect(p.fullName).toBe("Ada Lovelace");
});

test("make re-derives rather than trusting a stale stored value", () => {
  const p = Person.make({ ...raw, fullName: "Whatever Was Written Before" }).getOrThrow();
  expect(p.fullName).toBe("Ada Lovelace");
});

test("a computed field is absent from updateInput and dropped if smuggled in", () => {
  expect(Object.keys(Person.updateInput.shape).toSorted()).toEqual(["first", "last"]);
  const p = Person.decode(raw).getOrThrow();
  const lied = p.update({ fullName: "LIES" } as never).getOrThrow();
  expect(lied.fullName).toBe("Ada Lovelace");
});

test("a computed field round-trips through decode(toJSON()) unchanged", () => {
  const p = Person.decode(raw).getOrThrow();
  expect(Person.decode(p.toJSON()).getOrThrow().fullName).toBe("Ada Lovelace");
  expect(Person.make(p.toJSON()).getOrThrow().fullName).toBe("Ada Lovelace");
});

test("invariants see the computed field", () => {
  class Checked extends Entity("Checked")(
    { id: PersonId, first: NamePart, last: NamePart },
    {
      computed: computed({ fullName: FullName }, (d) => ({
        fullName: `${d.first} ${d.last}` as z.infer<typeof FullName>,
      })),
      invariants: (d) => (d.fullName.length <= 20 ? [] : ["fullName must be at most 20 chars"]),
    },
  ) {}
  expect(Checked.decode(raw).isOk()).toBe(true);
  expect(Checked.decode({ ...raw, last: "Lovelace-Byron-Of-Somewhere" }).isErr()).toBe(true);
});

test("computed output failing its own schema is a defect, not bad input", () => {
  class Broken extends Entity("Broken")(
    { id: PersonId, first: NamePart },
    {
      // FullName requires at least 1 char; this returns an empty string
      computed: computed({ fullName: FullName }, () => ({
        fullName: "" as z.infer<typeof FullName>,
      })),
    },
  ) {}
  const outcome = Broken.decode({ id: raw.id, first: "Ada" }).match({
    ok: () => "WRONGLY ACCEPTED",
    errCases: (m) => m.with(P.tag("InvalidEntity"), () => "invalid"),
    defect: () => "defect",
  });
  expect(outcome).toBe("defect");
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
  Once.decode({ id: raw.id, first: "Ada" }).getOrThrow();
  expect(calls).toBe(1);
});
