---
title: Unions and roots
description: Why a union's class type is the members' shared root rather than the member union, why an abstract root carries no tag, and what survives the intersection that builds a variant.
---

# Unions and roots

Two of the declarations in this package are classes you extend rather than
values you hold:

```ts
abstract class AccountBase extends Entity.abstract("Account")({
  id: AccountId,
  label: Label,
}) {}

class Account extends Entity.union("kind", [Personal, Business]) {}
```

Both shapes were forced by what TypeScript accepts at a base-class position.
This page is the reasoning; [Declaring an entity](/reference/declaration) is the
surface.

## Why a union's type is its members' root, not its members

A base-constructor return type may not be a union. Claiming one fails with

```
TS2509: Base constructor return type 'Personal | Business' is not an object
type or intersection of object types with statically known members
```

so `Entity.union` cannot describe its class as the thing its `make` returns.
What it claims instead is the **root its members share** — one object type,
which the rule accepts. Members that do not share one claim the empty type
instead, rather than a supertype that does not exist.

"Share one" is read off the `extend` call, not off the inheritance graph, and
the difference is easy to walk into. Members extended from an **intermediate**
root carry that intermediate's instance type, so

```ts
class Personal extends AccountBase.extend("Personal")({ … }) {}
class Business extends Auditable.extend("Business")({ … }) {} // Auditable extends AccountBase
```

do have `AccountBase` in common, and are still not one type: `Personal` claims
`AccountBase`, `Business` claims `Auditable`, the two do not reduce to a single
object type, and `Entity.union("kind", [Personal, Business])` is the empty type.
Extending every member of a union from the **same** class is what keeps the
union's type useful; `Entity.Instance<typeof Account>` is unaffected either way.

The exact union is not lost, only spelled elsewhere:

```ts
class Account extends Entity.union("kind", [Personal, Business]) {}

declare const account: Account; // AccountBase — the shared root
type AnyAccount = Entity.Instance<typeof Account>; // Personal | Business
```

`Account.make(row)` is unaffected: it returns
`Result<Personal | Business, InvalidEntity>`, and each instance carries its own
`_tag`, so `P.tag(...)` narrows it. The narrowing is only absent from the class
name used as an annotation.

## Why a union has no instances

`make` dispatches on the discriminant and constructs a **member**, so nothing is
ever an instance of the union itself. A union's class body therefore holds
statics — an instance method written there could never reach a member, which is
why reaching the constructor is a defect rather than an `InvalidEntity`:

```
Invoice | CreditNote: a union has no instances — use make()
```

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

The union is the deliberate exception: it strips the abstractness back off.
It has to. A union has no instances, so inheriting the root's abstract members
would demand implementations from a class body that can never be constructed —
`class Account extends Entity.union("kind", [Personal, Business]) {}` would
itself fail with TS2515, for a method that could never run.

## What a root cannot take over

`toJSON`, `equals` and `update` are declared on the entity's own prototype, and
`extend` chains the root's prototype **below** it. So a root can call all three,
and can never override them: a member declared under one of those names on a
root compiles, and is silently never called. The chaining is what buys the rest
— `variant instanceof Root` is true, and a behaviour-only intermediate root
between the two is picked up with no bookkeeping.

Behaviour that must differ per variant belongs in the variant's own body, which
is where an `abstract` member on the root already puts it.
