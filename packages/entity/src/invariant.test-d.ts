import { Entity } from "./index.js";

// a code is a string: the option is checked like any object literal
Entity.invariant((d: { a: string }) => d.a.length > 0, "a is empty", { code: "A_EMPTY" });

// @ts-expect-error a misspelled option is a compile error, not a silently dropped code
Entity.invariant((d: { a: string }) => d.a.length > 0, "a is empty", { cod: "A_EMPTY" });

// @ts-expect-error the code is a string, so a client can switch on it
Entity.invariant((d: { a: string }) => d.a.length > 0, "a is empty", { code: 1 });

// codeOf reads any issue, schema or invariant, and may find nothing
const code: string | undefined = Entity.codeOf({ message: "m" });
void code;
