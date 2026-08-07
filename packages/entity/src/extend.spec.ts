import { P } from "unthrown";
import { expect, test } from "vitest";
import { z } from "zod";

import { Entity } from "./index.js";

const PersonId = z.uuid().brand("PersonId");
const Name = z.string().min(1).brand("Name");
const Age = z.number().int().min(0).brand("Age");
const Upper = z.string().min(1).brand("Upper");

class Person extends Entity("Person")(
  { id: PersonId, name: Name },
  {
    immutable: ["id"],
    computed: {
      shout: Entity.computed(Upper, (d) => d.name.toUpperCase() as z.infer<typeof Upper>),
    },
    invariants: (d) => (d.name.length <= 20 ? [] : ["name must be at most 20 chars"]),
  },
) {}

class PersonWithAge extends Person.extend("PersonWithAge")({ age: Age }) {
  get isAdult(): boolean {
    return this.age >= 18;
  }
}

const id = "0199b1f4-1b1e-7000-8000-000000000000";

test("an extension carries the parent's fields plus its own", () => {
  const p = PersonWithAge.make({ id, name: "ada", age: 36 }).getOrThrow();
  expect(p.name).toBe("ada");
  expect(p.age).toBe(36);
});

test("a class-body getter sees the extended fields", () => {
  const p = PersonWithAge.make({ id, name: "ada", age: 36 }).getOrThrow();
  expect(p.isAdult).toBe(true);
  expect(PersonWithAge.make({ id, name: "kid", age: 9 }).getOrThrow().isAdult).toBe(false);
});

test("the extension is its own entity, with its own tag", () => {
  const p = PersonWithAge.make({ id, name: "ada", age: 36 }).getOrThrow();
  expect(p._tag).toBe("PersonWithAge");
  expect(PersonWithAge.entityName).toBe("PersonWithAge");
  expect(p).not.toBeInstanceOf(Person);
});

test("the parent's computed fields carry over and still re-derive", () => {
  const p = PersonWithAge.make({ id, name: "ada", age: 36 }).getOrThrow();
  expect(p.shout).toBe("ADA");
  expect(p.update({ name: "grace" as z.infer<typeof Name> }).getOrThrow().shout).toBe("GRACE");
});

test("the parent's invariants carry over", () => {
  const long = "x".repeat(21);
  expect(PersonWithAge.make({ id, name: long, age: 36 }).isErr()).toBe(true);
});

test("the parent's immutable list carries over", () => {
  expect(Object.keys(PersonWithAge.updateInput.shape).toSorted()).toEqual(["age", "name"]);
});

test("a child option overrides the parent's for that key", () => {
  class Loose extends Person.extend("Loose")({ age: Age }, { invariants: () => [] }) {}
  expect(Loose.make({ id, name: "x".repeat(21), age: 1 }).isOk()).toBe(true);
});

test("the extension's own schemas include both halves", () => {
  expect(Object.keys(PersonWithAge.input.shape).toSorted()).toEqual(["age", "id", "name"]);
  expect(Object.keys(PersonWithAge.output.shape).toSorted()).toEqual([
    "age",
    "id",
    "name",
    "shout",
  ]);
});

test("parent and extension are never equal, even with matching data", () => {
  const parent = Person.make({ id, name: "ada" }).getOrThrow();
  const child = PersonWithAge.make({ id, name: "ada", age: 36 }).getOrThrow();
  expect(child.equals(parent)).toBe(false);
  expect(parent.equals(child)).toBe(false);
});

test("the extension is still sealed and still refuses a bare subclass", () => {
  class Sub extends PersonWithAge {}
  const outcome = Sub.make({ id, name: "ada", age: 36 }).match({
    ok: () => "WRONGLY ACCEPTED",
    errCases: (m) => m.with(P.tag("InvalidEntity"), () => "invalid"),
    defect: () => "defect",
  });
  expect(outcome).toBe("defect");
});

test("an extension can itself be extended", () => {
  const Nick = z.string().min(1).brand("Nick");
  class Deeper extends PersonWithAge.extend("Deeper")({ nickname: Nick }) {}
  const d = Deeper.make({ id, name: "ada", age: 36, nickname: "ace" }).getOrThrow();
  expect(d.nickname).toBe("ace");
  expect(d.age).toBe(36);
  expect(d._tag).toBe("Deeper");
});

test("extend carries declarations, not class-body members", () => {
  // `extend` rebuilds from the field map and options — a getter written in the
  // parent's class body is not part of either, so it does not come along.
  // Re-declare it, or put shared behaviour in a plain function.
  const Nick = z.string().min(1).brand("Nick");
  class Deeper extends PersonWithAge.extend("Deeper")({ nickname: Nick }) {}
  const d = Deeper.make({ id, name: "ada", age: 36, nickname: "ace" }).getOrThrow();
  expect("isAdult" in d).toBe(false);
});
