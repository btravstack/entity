import { fromSchema, type SchemaIssues } from "@unthrown/standard-schema";
import { Err, P, all, fromThrowable, type Result } from "unthrown";
import type { z } from "zod";

import type { ComputedField } from "./computed.js";
import { InvalidEntity } from "./errors.js";
import { isFieldSpec } from "./field.js";
import type { Invariant } from "./invariant.js";
import { keysOf, renderIssue } from "./issues.js";
import type { OnlyNominal } from "./shape.js";
import type {
  AggregateStatic,
  EventNamed,
  Events,
  Fields,
  IdentityKeys,
  InputOf,
  RecordOf,
  Schemas,
} from "./types.js";

/** The entity builder, loosened — passed in, as `base.ts` does, so there is no cycle. */
export type BuildEntityClass = (
  tag: string,
) => (fields: Fields, options?: Record<string, unknown>) => object;

type Event = { readonly type: string };
type Handlers = Record<string, (...args: never[]) => unknown>;
type Maker = { make: (state: unknown) => Result<object, InvalidEntity> };

/**
 * `class X extends Entity.aggregate("X")(fields)({ events, opens, evolve })`
 *
 * An aggregate root: an entity whose state changes only through events. It is
 * built *as* an entity — the same `Base` class, so finality, the construction
 * seal, freezing, `make`, `inspect`, `toJSON` and identity are the entity's
 * own — with `update` and the factories taken off it and `emit`/`start`/
 * `replay` put on. Not a subclass of the entity's base: an entity is final,
 * and a second `extends` is a defect at construction.
 *
 * Fields and handlers are two calls, not one, so the field map is fixed before
 * the handlers are checked. In one call the handlers' return type is computed
 * from a field map TypeScript is still inferring, and every fresh literal a
 * handler returns widens — `status: "open"` became `string` and failed against
 * `"open" | "closed"`. Measured on 7.0.2 with `NoInfer`, a constrained return
 * parameter and an intersection-free signature: all widened; only a field map
 * fixed by an earlier call kept the literal.
 */
export const createAggregate =
  (buildEntity: BuildEntityClass) =>
  <Tag extends string>(tag: Tag) =>
  <S extends Fields>(
    // An aggregate root has an identity: it is what other aggregates reference
    // and what a repository loads by. Without one, the field map is rejected
    // here — an inline literal, so TypeDoc has no internal name to report —
    // and `sameIdentityAs` is always callable on an aggregate.
    fields: S &
      OnlyNominal<S> &
      ([IdentityKeys<S>] extends [never]
        ? { readonly __anAggregateRootNeedsAnIdentityField: never }
        : unknown),
  ) =>
  <
    Ev extends Events,
    O extends z.output<Ev>["type"],
    A extends Schemas = Record<never, never>,
  >(options: {
    /** every event this aggregate can produce, as one discriminated union on `type` */
    readonly events: Ev;
    /** the creation events, each to the first record */
    readonly opens: { readonly [K in O]: (event: EventNamed<Ev, K>) => RecordOf<S> };
    /** every other event, each folding one record into the next — all of them, or it does not compile */
    readonly evolve: {
      readonly [K in Exclude<z.output<Ev>["type"], O>]: (
        record: RecordOf<S>,
        event: EventNamed<Ev, K>,
      ) => RecordOf<S>;
    };
    readonly computed?: { [K in keyof A]: ComputedField<A[K], InputOf<S>> };
    readonly invariants?: readonly Invariant<InputOf<S>>[];
  }): AggregateStatic<Tag, S, A, Ev, O> => {
    // The same rule at runtime, for a caller the types did not reach — the
    // precedent is a root's redeclared field: a compile error, and a defect
    // while the declaration is on the stack.
    if (
      !Object.values(fields as Fields).some(
        (v) => isFieldSpec(v) && (v.flags as { identity?: true }).identity === true,
      )
    ) {
      // oxlint-disable-next-line unthrown/no-throw
      throw new Error(
        `${tag}: an aggregate root needs an identity — flag at least one field \`identity: true\`.`,
      );
    }
    const { events, opens, evolve, ...entityOptions } = options;
    const Base = buildEntity(tag)(fields as Fields, entityOptions) as Record<string, unknown> & {
      readonly prototype: Record<string, unknown>;
      readonly input: z.ZodObject;
    };

    // State changes only through events, and `start` is creation.
    Reflect.deleteProperty(Base.prototype, "update");
    Reflect.deleteProperty(Base, "factory");
    Reflect.deleteProperty(Base, "factoryAsync");

    const parseEvent = fromSchema(events);
    const openers = opens as unknown as Handlers;
    const folders = evolve as unknown as Handlers;
    const recordKeys = Object.keys(Base.input.shape);
    // The entity's own projection, never a subclass override of `toJSON`.
    const project = Base.prototype["toJSON"] as (this: object) => Record<string, unknown>;

    /**
     * The current state as a fresh, shallow record of the declared fields:
     * what a handler folds over. Shallow on purpose — a nested value keeps its
     * reference (frozen, so a handler mutating it throws, which is a defect),
     * and a `z.custom` instance survives the fold intact for `make` to check.
     */
    const recordOf = (self: object): Record<string, unknown> => {
      const data = project.call(self);
      return Object.fromEntries(recordKeys.map((k) => [k, data[k]]));
    };

    const bug = (detail: string) => new Error(`${tag}: ${detail}`);

    /** The decision: the verified state, and the parsed events that produced it. */
    const decide = (Ctor: Maker, record: unknown, decided: readonly Event[]) =>
      Ctor.make(record)
        .mapErrCases((m, defect) =>
          m.with(P.tag("InvalidEntity"), (invalid) =>
            defect(bug(`the decision breaks the aggregate: ${invalid.message}`)),
          ),
        )
        .map((state) => Object.freeze({ state, events: Object.freeze([...decided]) }));

    /** Events from domain code: a schema failure is a bug in the command, so a defect. */
    const parseDecided = (raw: readonly unknown[]) =>
      all(raw.map((e) => parseEvent(e) as Result<Event, SchemaIssues>)).mapErrCases((m, defect) =>
        // SchemaIssues is `readonly Issue[]` — a single non-union type, nothing to enumerate
        // oxlint-disable-next-line unthrown/no-catch-all-pattern
        m.with(P._, (issues) =>
          defect(bug(`an emitted event fails its schema: ${issues.map(renderIssue).join("; ")}`)),
        ),
      );

    /**
     * One handler call per event. A missing handler throws: the types make every
     * declared event either an opener or a folder, so reaching it means an
     * opening event emitted mid-life, or an untyped call — both bugs.
     */
    const fold = (record: unknown, decided: readonly Event[]) =>
      decided.reduce<unknown>((current, e) => {
        const handler = folders[e.type];
        if (handler === undefined) {
          // oxlint-disable-next-line unthrown/no-throw
          throw bug(`"${e.type}" opens an aggregate; it cannot be emitted by one`);
        }
        return (handler as (r: unknown, e: Event) => unknown)(current, e);
      }, record);

    function emit(this: object, ...raw: unknown[]) {
      const Ctor = this.constructor as unknown as Maker;
      return parseDecided(raw).flatMap((decided) =>
        fromThrowable(
          () => fold(recordOf(this), decided),
          (cause, defect) => defect(cause),
        )().flatMap((record) => decide(Ctor, record, decided)),
      );
    }

    function start(this: Maker, raw: unknown) {
      return parseDecided([raw]).flatMap((decided) => {
        const [event] = decided as [Event];
        return fromThrowable(
          () => {
            const opener = openers[event.type];
            if (opener === undefined) {
              // oxlint-disable-next-line unthrown/no-throw
              throw bug(`"${event.type}" is not an opening event`);
            }
            return (opener as (e: Event) => unknown)(event);
          },
          (cause, defect) => defect(cause),
        )().flatMap((record) => decide(this, record, decided));
      });
    }

    const invalid = (issues: SchemaIssues) => Err(new InvalidEntity({ entity: tag, issues }));

    /**
     * A stored stream → the aggregate. Stored events are untrusted, like a row
     * handed to `make`, so every one is parsed and a bad one is an
     * `InvalidEntity` at its index. Upcasting an old event version is the
     * adapter's job, before this. The final `make` is strict: a stream that
     * breaks a rule added since is refused like a row would be (#71).
     */
    function replay(this: Maker, raw: unknown): Result<object, InvalidEntity> {
      if (!Array.isArray(raw) || raw.length === 0) {
        return invalid([{ message: "a stream is a non-empty array of events" }]);
      }
      const parsed = raw.map((e) => parseEvent(e) as Result<Event, SchemaIssues>);
      const issues = parsed.flatMap((result, i) =>
        result.match({
          ok: () => [],
          errCases: (m) =>
            // oxlint-disable-next-line unthrown/no-catch-all-pattern
            m.with(P._, (found) =>
              found.map((issue) => ({ message: issue.message, path: [i, ...keysOf(issue)] })),
            ),
          defect: () => [],
        }),
      );
      if (issues.length > 0) return invalid(issues);

      return all(parsed).flatMap(([first, ...rest]) => {
        const opening = first as Event;
        if (openers[opening.type] === undefined) {
          return invalid([
            {
              message: `a stream starts with an opening event (${Object.keys(openers).join(", ")})`,
              path: [0, "type"],
            },
          ]);
        }
        const reopened = rest.findIndex((e) => openers[e.type] !== undefined);
        if (reopened !== -1) {
          return invalid([
            { message: "an opening event can only start a stream", path: [reopened + 1, "type"] },
          ]);
        }
        return fromThrowable(
          () => fold((openers[opening.type] as (e: Event) => unknown)(opening), rest),
          (cause, defect) => defect(cause),
        )().flatMap((record) => this.make(record));
      }) as Result<object, InvalidEntity>;
    }

    for (const [key, value] of Object.entries({ emit })) {
      Object.defineProperty(Base.prototype, key, { value, writable: true, configurable: true });
    }
    for (const [key, value] of Object.entries({ start, replay, events })) {
      Object.defineProperty(Base, key, { value, writable: true, configurable: true });
    }

    return Base as unknown as AggregateStatic<Tag, S, A, Ev, O>;
  };
