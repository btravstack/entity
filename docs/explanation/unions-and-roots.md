---
title: Unions and roots
description: Why a union is a value with no class form, why an abstract root carries no tag, and what survives the intersection that builds a variant.
---

# Unions and roots

One declaration in this package is a class you extend, and one is a value you
hold:

```ts
abstract class AccountBase extends Entity.abstract("Account")({
  id: AccountId,
  label: Label,
}) {}

export const Account = Entity.union("kind", [Personal, Business]);
export type Account = Entity.Instance<typeof Account>;
```

Which is which was settled by what TypeScript accepts at a base-class position:
a root can sit there, and a union cannot. This page is the reasoning;
[Declaring an entity](/reference/declaration) is the surface.

## Why a union has no class form

`Entity.union` returns a value with no construct signature, so reaching for the
class form is an error at the declaration itself:

```
TS2507: Type 'EntityUnion<"kind", readonly [typeof Personal, typeof Business]>'
is not a constructor function type
```

It used to compile, which is what made it worth removing. A base-constructor
return type may not be a union — claiming one fails with

```
TS2509: Base constructor return type 'Personal | Business' is not an object
type or intersection of object types with statically known members
```

so no class form could ever have typed as the thing its `make` returns. What it
typed as instead was the **root its members share**: one object type, which the
rule accepts.

That left the class form both redundant and treacherous.

Redundant, because the root is a class the author has already declared and
named. A type that is either `AccountBase` — the name already in scope — or, for
members sharing no root, the empty type, adds nothing you could not write
yourself.

Treacherous, because it failed **late**. The declaration compiled clean; so did
every line touching only shared fields. The error surfaced at the first call
site reading a member-only field off a value annotated with the union's name,
which is arbitrarily far from the declaration that caused it. `TS2507` fires
where the mistake is written.

`Entity.Instance<typeof Account>` is where the member union lives, and the
`export type Account = …` line beside the const is what puts it under the name a
reader expects:

```ts
export const Account = Entity.union("kind", [Personal, Business]);
export type Account = Entity.Instance<typeof Account>; // Personal | Business

declare const account: Account;
account._tag; // "Personal" | "Business" — P.tag(...) narrows it
```

`AccountBase` is still the right annotation when a function needs only the
shared behaviour, and a variant is a real instance of it, so `instanceof`
narrows too. Neither name is a fallback for the other.

## Why a union has no instances

`make` dispatches on the discriminant and constructs a **member**, so nothing is
ever an instance of the union itself. The value form makes that structural
rather than a rule to remember: there is no constructor to reach, and no class
body in which to write an instance method that could never run. An entry point
that would once have been a static is a plain function beside the const.

## Why the root carries no tag

An entity's `_tag` is a literal type. A root's is `string`, and the widening is
what makes the root work at all rather than a convenience.

`extend` builds a variant by intersecting the root's instance type with the new
entity's. Two literal tags do not intersect: `"Account" & "Personal"` reduces to
`never`, which poisons the whole instance type and puts the base-constructor
return type back in front of TS2509. `string & "Personal"` reduces to
`"Personal"` — exactly what the variant needs, and what lets shared behaviour in
the root's body still read `this._tag`.

The tag is also the only member that would have needed subtracting, and not
subtracting it is what keeps the variant's methods methods. The root's class
body is carried into the intersection **unmapped**. Both spellings that would
map it — `Omit<R, …>` and a key-remapped `{ [K in keyof R as …]: R[K] }` — turn
a method into a function-typed property, and a variant implementing an abstract
method then fails with

```
TS2425: … defines instance member property 'describe', but extended class
'Personal' defines it as instance member function
```

## `abstract` survives, deliberately

Because the intersection is unmapped and its behaviour half is the root's real
class type, TypeScript propagates abstractness through it. An `abstract` member
on a root is a compiler-enforced obligation on every variant:

```ts
abstract class AccountBase extends Entity.abstract("Account")({
  id: AccountId,
  label: Label,
}) {
  abstract describe(): string;
}

// @ts-expect-error TS2515: does not implement inherited abstract member describe
class Forgot extends AccountBase.extend("Forgot")({
  kind: z.literal("forgot"),
}) {}
```

That is what makes a root a place to state a contract and not only a place to
share fields.

A union never inherits that obligation, and no longer needs anything to strip it
back off. It is a value, not a class, so there is no class body for an
`abstract` member to bind to, and nothing to implement it with — a union has no
instances. The obligation stays on the variants, which have them.

## What a root cannot take over

`toJSON`, `equals` and `update` are declared on the entity's own prototype, and
`extend` chains the root's prototype **below** it. So a root can call all three,
and can never override them: a member declared under one of those names on a
root compiles, and is silently never called. The chaining is what buys the rest
— `variant instanceof Root` is true, and a behaviour-only intermediate root
between the two is picked up with no bookkeeping.

Behaviour that must differ per variant belongs in the variant's own body, which
is where an `abstract` member on the root already puts it.
