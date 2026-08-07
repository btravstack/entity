import { test } from "vitest";
import { z } from "zod";

import { Entity } from "./index.js";

const Id = z.uuid().brand("Id");
const Name = z.string().min(1).brand("Name");
const Age = z.number().int().brand("Age");

class Person extends Entity("Person")({ id: Id, name: Name }) {}

test("extend enforces the same field rules as a fresh declaration", () => {
  Person.extend("Ok")({ age: Age });

  // @ts-expect-error an unbranded field is rejected, exactly as in Entity(...)
  Person.extend("Unbranded")({ plain: z.string() });

  // @ts-expect-error a reserved name is rejected, exactly as in Entity(...)
  Person.extend("Reserved")({ update: Name });
});

test("an extension's instance carries both halves of the shape", () => {
  class WithAge extends Person.extend("WithAge")({ age: Age }) {}
  const p = WithAge.make({}).getOrThrow();
  const name: z.infer<typeof Name> = p.name;
  const age: z.infer<typeof Age> = p.age;
  const tag: "WithAge" = p._tag;
  void name;
  void age;
  void tag;
  // @ts-expect-error the extension's data is still read-only
  p.age = age;
});
