---
title: Invariants and transitions
description: Why a state invariant, a transition rule and an external precondition are three different rules, what update() does and does not enforce, and why events come from commands.
---

# Invariants and transitions

An entity can be in a valid state and still have got there illegally. A paid
invoice is valid. A void invoice is valid. Voiding a paid invoice is not,
because a paid invoice is reversed with a credit note. Nothing about either
state says so: the rule lives in the step between them.

That gives three kinds of rule, and each belongs in a different place.

## Three kinds of rule

|                       | Asks                                        | Lives in                                 | Fails as                    |
| --------------------- | ------------------------------------------- | ---------------------------------------- | --------------------------- |
| State invariant       | Is this state valid, however it was built?  | `invariants`, schemas, `immutable`       | `InvalidEntity`             |
| Transition rule       | May this state change into that one?        | A command                                | A typed business error      |
| External precondition | Does the world outside the entity allow it? | The application, before the command runs | The application's own error |

**A state invariant** is true of every instance, whichever path built it:
`make` from a row, a factory, `update`, a command. "A void invoice cannot be in
dunning" and "an issued invoice bills at least one line" are invariants. The
package checks them on every construction, which is why a command never has
to repeat them.

**A transition rule** compares where the entity is with where it is going, or
with the argument it was given. "Only an issued invoice can be voided" is one.
An invariant cannot express it, because an invariant sees only the resulting
state. So the rule goes in a command, which sees both.

**An external precondition** depends on something the entity does not hold: a
number from a gapless sequence, the current time, the customer's credit status
in another aggregate. Fetching any of those is I/O, and the package does
[none](/explanation/no-io). The application settles them first, then passes the
result to the command as an argument.

The failures differ in what a caller can do with them. An invariant violation
is an `InvalidEntity` issue with a message and no path
([Errors](/reference/errors)), written for a person to read. A transition
rule's refusal is a `TaggedError` with its own tag and typed fields, which a
caller matches on to decide what to do next.

Getting the category right decides where the rule is enforced. An invariant
written as a command check is skipped by every other construction path. A
transition rule written as an invariant cannot be written at all.

The category also decides what adding a rule later costs. A new command rule
governs only calls made after it ships. A new invariant governs every stored
row too, including rows written before it existed, so `make` starts refusing
them the moment it ships.
[Add a stricter rule without an outage](/how-to/add-a-stricter-rule) works
through both.

## What update() enforces

`update(patch)` builds a new instance from the old one and the patch, then runs
the full construction: schemas, computed fields, invariants. It refuses an
`immutable` field. Everything else is allowed, as long as the result is valid.

So `update` permits every transition between two valid states. A caller holding
a paid invoice can patch `status` to `"VOID"`, and `update` accepts it, because
both states are valid. A command's precondition guards only the callers who
go through the command.

That is not a defect in `update`. It is the general-purpose state change, and
the library cannot tell a correction from a business operation. What it means
in practice is that the guarantee comes from **who can reach `update`**:

- Inside the domain module, commands and repositories use `update` freely.
- At the module's public boundary, the application exports commands (load,
  run, save) and nothing that hands a caller an entity to patch.

`immutable` is the exception that a declaration can carry. A field that never
changes after creation is a transition rule ("never changes") enforced on
every path, `update` included.

A restricted update surface, where an entity opts out of a public `update`, is
not offered. Whether consumers need one is a separate question, to be answered
by a real case that the module boundary does not cover.

## Why lifecycles become variants

A status field is the right tool when every state has the same shape. When one
state carries a field the others cannot, such as an issued invoice's `number`,
one entity with a nullable field types every read site as nullable forever.

Two variants of one [root](/explanation/unions-and-roots) avoid that, and they
change what a transition is. A patch cannot change which class an instance is,
so moving between variants is always a command calling the target's factory.
Commands live only on the variant they apply to, which makes some forbidden
transitions unwritable: there is no `issue` on an issued invoice to call.
[Number without gaps](/how-to/number-without-gaps) works through the same
split.

## Why events come from commands

An event records a business fact: an invoice was issued. Several paths can
produce the same state change. An issuance, a data import, a correction and a
rehydration can all yield an issued invoice with the same fields. Only the
first is an `InvoiceIssued`.

That is why the library does not diff two instances to find events, and why
`update` and `make` return the entity alone. A diff describes what changed,
not why it changed. The command is the one place that knows why, so the command
builds the event and returns it beside the entity.

This keeps the package within its rules. Events are values, returned rather
than dispatched, so the entity does no I/O. `update()` keeps its return type,
so nothing existing changes. Commands are ordinary methods, so the surface does
not grow.

The application receives the outcome, writes the new state and its events in
one transaction, and publishes afterwards. Internal events may carry private
state. What the service publishes is a separate contract mapped from them, so
adding a field to the model never publishes it by accident.

[Write commands and events](/how-to/write-commands) walks through the
pattern, and the [billing domain example](/examples/billing-domain) runs it.
