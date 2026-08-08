---
"@btravstack/entity": minor
---

Add `Entity.abstract(name)(fields, options?)`, a tagless root that carries shared
fields **and shared behaviour** into every entity extended from it, and make
`Entity.union(...)` return a class so a union can be declared with
`class X extends Entity.union(...) {}` and used as a type. `Entity.Instance<T>`
recovers an entity's or a union's instance type.

A root is a real supertype: `variant instanceof Root` is true, an `abstract`
member on the root is enforced on every variant (`TS2515`), and a
behaviour-only intermediate `abstract class` between the two is picked up. A
union's class body is for **statics** — it has no instances, and as a type it is
the root its members share; `Entity.Instance<typeof X>` is the exact member
union.

**Breaking:** `extend` is no longer on an entity — an entity is final. Wrap the
shared fields in an abstract root and declare both entities as variants of it:

```ts
// before
class Person extends Entity("Person")({ id: Id, name: Name }) {}
class PersonWithAge extends Person.extend("PersonWithAge")({ age: Age }) {}

// after
abstract class PersonBase extends Entity.abstract("Person")({
  id: Id,
  name: Name,
}) {}
class Person extends PersonBase.extend("Person")({}) {}
class PersonWithAge extends PersonBase.extend("PersonWithAge")({ age: Age }) {}
```

A root is where behaviour shared by every variant lives, which is what the old
`extend` could not carry: it rebuilt from the declaration alone, so class-body
members had to be written again per extension.
