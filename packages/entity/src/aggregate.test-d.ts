import { z } from "zod";

import { Entity } from "./index.js";

const Id = z.uuid().brand("Id");
const Label = z.string().min(1).brand("Label");

const Event = z.discriminatedUnion("type", [
  z.object({ type: z.literal("Opened"), id: z.uuid() }),
  z.object({ type: z.literal("Renamed"), label: z.string() }),
  z.object({ type: z.literal("Closed") }),
]);
type Event = z.output<typeof Event>;

class Doc extends Entity.aggregate("Doc")({
  id: Entity.field(Id, { identity: true }),
  label: Label.optional(),
})({
  events: Event,
  opens: { Opened: (e) => ({ id: e.id }) },
  evolve: {
    // the record is unvalidated input: a plain string goes where `Label` will be
    Renamed: (r, e) => ({ ...r, label: e.label }),
    Closed: (r) => r,
  },
}) {}

declare const doc: Doc;

// @ts-expect-error an aggregate has no update: state changes only through events
doc.update({ label: Label.parse("x") });

// @ts-expect-error nor a factory: `start` is creation
Doc.factory({});

// emit returns a decision over this very class
const decision: Entity.Decision<Doc, Event> = doc.emit({ type: "Renamed", label: "x" }).get();
void decision;

// @ts-expect-error an event outside the declared union does not compile
doc.emit({ type: "Deleted" });

// @ts-expect-error an existing aggregate cannot be created again: emit refuses a creation event
doc.emit({ type: "Opened", id: "0199b1f4-1b1e-7000-8000-000000000000" });

// @ts-expect-error start only accepts an opening event
Doc.start({ type: "Renamed", label: "x" });

// @ts-expect-error a decision cannot be built by hand: only emit and start make one
const forged: Entity.Decision<Doc, Event> = { state: doc, events: [] };
void forged;

// the event union is recoverable from the class
const event: Entity.Event<typeof Doc> = { type: "Closed" };
void event;

Entity.aggregate("Missing")({ id: Entity.field(Id, { identity: true }) })({
  events: Event,
  opens: { Opened: (e) => ({ id: e.id }) },
  // @ts-expect-error omitting a handler for a declared event type does not compile
  evolve: { Renamed: (r) => r },
});

Entity.aggregate("Extra")({ id: Entity.field(Id, { identity: true }) })({
  events: Event,
  opens: { Opened: (e) => ({ id: e.id }) },
  evolve: {
    Renamed: (r) => r,
    Closed: (r) => r,
    // @ts-expect-error an opening event is not folded by evolve
    Opened: (r) => r,
  },
});

// @ts-expect-error an aggregate is a root: it cannot be nested as another entity's field
Entity("Holder")({ id: Id, doc: Doc });

// The point of the two-call shape: the record a handler returns is checked exactly.
const Status = z.enum(["open", "closed"]);
Entity.aggregate("Exact")({ id: Entity.field(Id, { identity: true }), status: Status })({
  events: Event,
  // a fresh literal keeps its type: "open" is a status, not a string
  opens: { Opened: (e) => ({ id: e.id, status: "open" }) },
  evolve: {
    Renamed: (r) => r,
    // @ts-expect-error a literal outside the enum does not compile
    Closed: (r) => ({ ...r, status: "shut" }),
  },
});

Entity.aggregate("Incomplete")({ id: Entity.field(Id, { identity: true }), status: Status })({
  events: Event,
  // @ts-expect-error a handler must return every declared field
  opens: { Opened: (e) => ({ id: e.id }) },
  evolve: { Renamed: (r) => r, Closed: (r) => r },
});

// @ts-expect-error an aggregate root has an identity: it is how others reference it and how it is loaded
Entity.aggregate("Anonymous")({ label: Label })({
  events: Event,
  opens: { Opened: () => ({ label: "x" }) },
  evolve: { Renamed: (r) => r, Closed: (r) => r },
});

// @ts-expect-error a loaded aggregate says which version it was loaded at
Doc.make({ id: "0199b1f4-1b1e-7000-8000-000000000000" });
Doc.make({ id: "0199b1f4-1b1e-7000-8000-000000000000" }, { version: 3 });

// the decision names the version a repository must still find
const expected: number = decision.expectedVersion;
void expected;
