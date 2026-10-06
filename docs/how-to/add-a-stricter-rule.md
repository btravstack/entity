---
title: Add a stricter rule without an outage
description: Introduce a new invariant when stored rows already break it. Decide whether it is a state invariant or a rule for new commands, find the rows that break it with inspect, migrate them, and stop retrying failures that will never succeed.
---

# Add a stricter rule without an outage

**Problem:** you want a new rule, such as "a mission in step `ERROR` carries
the reason it failed". Rows written before the rule existed may already break
it. `make` checks every invariant on every row it reads, so an invariant added
today rejects those rows from the moment it ships. No compiler error or unit
test warns you.

> Snippets below assume these imports:
>
> ```ts
> import { z } from "zod";
> import { Err, Ok, P, TaggedError, type Result } from "unthrown";
> import { Entity } from "@btravstack/entity";
> ```
>
> Domain vocabulary — entities, brands, factories — is whatever your own
> domain declares.

The steps run in this order: decide what kind of rule it is, measure the rows
that break it, migrate them, then ship the rule. The last two sections cover
reading legacy rows in the meantime, and making sure a rejected row fails once
instead of forever.

## Decide whether the rule is about states or about commands

Ask whether the rule must hold for **every** stored state, including ones
written years ago, or only for what happens **from now on**.

A rule about what happens from now on is a transition rule, and it belongs in
a command, not in `invariants`
([Invariants and transitions](/explanation/invariants-and-transitions#three-kinds-of-rule)).
A command runs only when someone calls it, so old rows never meet the rule.
The rollout is then just a deploy:

```ts
const Reason = z.string().min(1).brand("Reason");

class Mission extends Entity("Mission")({
  step: z.enum(["RUNNING", "ERROR"]),
  reason: Reason.optional(),
  label: Label,
}) {
  /** From now on, a mission cannot fail without saying why. */
  fail(reason: z.infer<typeof Reason>): Result<Mission, Entity.InvalidEntity> {
    return this.update({ step: "ERROR", reason });
  }
}
```

Here the rule costs nothing at runtime: `fail` requires a `reason` in its
signature. Rows that failed without one still load, and code that wants to
treat them differently can check `reason === undefined`.
[Write commands and events](/how-to/write-commands#refuse-a-forbidden-transition-with-a-typed-error)
covers commands that refuse with a typed error.

Choose an invariant only if a stored state that breaks the rule should not
exist at all. Then continue with the steps below.

## Find the rows that break it

Declare the invariant, then run `inspect` over the stored rows **before** you
deploy. Run it as a one-off script against a replica or a snapshot. `inspect`
validates the field schemas and re-derives `computed` exactly like `make`.
Instead of failing on an invariant, it reports every rule the row breaks:

```ts
class Mission extends Entity("Mission")(
  { step: Step, reason: Reason.optional(), label: Label },
  {
    invariants: [
      Entity.invariant({
        code: "MISSING_FAILURE_REASON",
        ensure: (d) => d.step !== "ERROR" || d.reason !== undefined,
        message: "a mission in step ERROR must carry the reason it failed",
      }),
    ],
  },
) {}

for (const row of await db.select("missions")) {
  Mission.inspect(row).match({
    ok: ({ violations }) => {
      for (const issue of violations) report(row.id, Entity.codeOf(issue));
    },
    errCases: (m) =>
      m.with(P.tag("InvalidEntity"), (e) => reportCorrupt(row.id, e.issues)),
    defect: (cause) => {
      throw cause;
    },
  });
}
```

The two channels mean different things:

- **`violations`**: the field shapes are fine, and the row breaks a rule.
  Each issue is exactly what `make` would have failed with, so
  [`Entity.codeOf`](/reference/errors#entity-codeof-issue) reads the rule's
  code.
- **`InvalidEntity`**: a field fails its own schema. `inspect` never relaxes
  that. Either the row is corrupt or its shape changed, and both need a
  migration, not a report.

Neither channel tells you **why** the data is the way it is. A broken
invariant can be history (the rule did not exist yet) or real corruption (a
bug wrote it). Decide per code, and look at a sample of the rows.

## Migrate the rows at the repository boundary

If a safe value exists for the old rows, fix them before the strict rule
applies. Either backfill the table, or rewrite each row inside the repository,
before it reaches `make`:

```ts
const migrate = (row: MissionRow): MissionRow =>
  row.step === "ERROR" && row.reason === null
    ? { ...row, reason: "unknown, recorded before reasons were required" }
    : row;

const load = (row: MissionRow) => Mission.make(migrate(row));
```

Keep the migration in the persistence layer, where the knowledge of old row
formats belongs. The entity stays a description of the current model. Issue
[#37](https://github.com/btravstack/entity/issues/37) tracks a worked
repository example with versioned rows.

Rerun the inspection job. Ship the invariant once it reports no violations.
From then on, `make` refuses any new row that breaks the rule, and so does
every command, because `update` runs the invariants too.

## Read legacy rows through inspect

Some rows cannot honestly be migrated: no value would be true. A read model,
an export or a support screen can still show them through `inspect`:

```ts
const missionView = (row: unknown) =>
  Mission.inspect(row).map(({ data, violations }) => ({
    ...data,
    warnings: violations.map(Entity.codeOf),
  }));
```

`data` is plain, frozen data, not a `Mission`. It has no `_tag`, no `update`,
no commands and no `sameIdentityAs`, and its type is not assignable to
`Mission`. Passing it to a function that takes a `Mission` is a compile
error. Ignoring `violations` therefore cannot slip a row that breaks today's
rules into the command model. The only way there is to migrate the data and
call `make`, which is strict:

```ts
const { data } = Mission.inspect(row).getOrThrow();
startRecovery(data); // compile error: data is not a Mission
Mission.make(migrate(data)).map(startRecovery); // the way back
```

`inspect` exists on every entity and variant, and on an `Entity.union`, where
it dispatches on the discriminant like `make`. A nested entity field is
inspected strictly: a nested row that breaks its own rule fails the parent's
`inspect` with an `InvalidEntity`, exactly as under `make`.

## Do not retry a failure that cannot succeed

When `make` rejects a stored row, it rejects it the same way every time.
Retrying cannot help. A job runner or workflow engine with a default retry
policy can still retry it forever, and the only symptom is a job that never
finishes.

Map `InvalidEntity` from a stored row to your runner's **non-retryable**
failure at the edge, and carry the codes in it so the log names the rule:

```ts
class UnloadableRow extends TaggedError("UnloadableRow")<{
  readonly entity: string;
  readonly codes: readonly (string | undefined)[];
}> {
  override message = `${this.entity} row rejected by its own model: ${this.codes.join(", ")}`;
}

const loadMission = (row: unknown) =>
  Mission.make(row).mapErrCases((m) =>
    m.with(
      P.tag("InvalidEntity"),
      (e) =>
        new UnloadableRow({
          entity: e.entity,
          codes: e.issues.map(Entity.codeOf),
        }),
    ),
  );
```

At the activity or job boundary, fold `UnloadableRow` into the runner's
non-retryable form. In Temporal that is `ApplicationFailure.nonRetryable(…)`.
Keep retries for failures that can actually change, such as a timeout or a
dropped connection. A
[defect](/reference/errors#which-channel-a-failure-takes) is a bug in domain
code. It also fails the same way on every retry, so give it the same
treatment.
