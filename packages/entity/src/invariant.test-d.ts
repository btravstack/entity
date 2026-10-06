import { Entity } from "./index.js";

type Data = { a: string };

// the three parts are named, and `d` is typed from the rule's own annotation here
Entity.invariant({ code: "A_EMPTY", ensure: (d: Data) => d.a.length > 0, message: "a is empty" });

// @ts-expect-error the code is required: every rule has a stable identity
Entity.invariant({ ensure: (d: Data) => d.a.length > 0, message: "a is empty" });

Entity.invariant({
  code: "A_EMPTY",
  ensure: (d: Data) => d.a.length > 0,
  message: "a is empty",
  // @ts-expect-error a misspelled key is an excess-property error, not a silently dropped part
  mesage: "a is empty",
});

// @ts-expect-error the code is a string, so a client can switch on it
Entity.invariant({ code: 1, ensure: (d: Data) => d.a.length > 0, message: "a is empty" });

// codeOf reads any issue, schema or invariant, and may find nothing
const code: string | undefined = Entity.codeOf({ message: "m" });
void code;
