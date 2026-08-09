---
layout: home
title: entity — a domain-entity builder for TypeScript, on zod v4
description: One declaration gives you a type, four request/response schemas, behaviour, and a class that is itself a zod schema. Nothing throws.

hero:
  name: "entity"
  text: "Domain entities, declared once"
  tagline: One declaration yields a type, four request/response schemas, behaviour, and a class that is itself a zod schema — with branded fields, immutable data, sealed construction, and Result instead of throws.
  image:
    light: /logo-light.svg
    dark: /logo-dark.svg
    alt: entity
  actions:
    - theme: brand
      text: Get Started
      link: /tutorial/getting-started
    - theme: alt
      text: Why entity?
      link: /explanation/why-entity
    - theme: alt
      text: GitHub
      link: https://github.com/btravstack/entity

features:
  - icon: { src: /icons/schemas.svg }
    title: One declaration, four schemas
    details: "input, output, createInput and updateInput are derived from one field map — the generated / immutable flags a field carries, plus computed. Plain ZodObjects, so they convert to JSON Schema in both directions — no hand-written omit lists."
  - icon: { src: /icons/seal.svg }
    title: Sealed and immutable
    details: "new SomeEntity(…) does not compile. Every instance comes through make, update or a factory, so the invariants have run — and its data is deep-frozen, mutation a compile error first."
  - icon: { src: /icons/nest.svg }
    title: Entities nest in entities
    details: "The class is itself a zod schema, so it drops into z.object({ owner: Organization }) as a field and still parses to a real instance, with its own behaviour and identity."
  - icon: { src: /icons/result.svg }
    title: Nothing throws
    details: "Every fallible operation returns an unthrown Result<T, InvalidEntity> carrying structured issues. A bug in your own domain code stays a separate defect, never folded into caller error."
---

## At a glance

```ts
import { z } from "zod";
import { Entity } from "@btravstack/entity";

const OrgId = z.uuid().brand("OrgId");
const Slug = z.string().min(1).brand("Slug");
const DisplayName = z.string().min(1).brand("DisplayName");
const Instant = z.iso.datetime().brand("Instant");
const Upper = z.string().min(1).brand("Upper");

class Organization extends Entity("Organization")(
  {
    id: Entity.field(OrgId, { generated: true, immutable: true }),
    slug: Entity.field(Slug, { immutable: true }),
    name: DisplayName,
    createdAt: Entity.field(Instant, { generated: true, immutable: true }),
  },
  {
    computed: {
      shout: Entity.computed(Upper, (d) => d.name.toUpperCase()),
    },
    invariants: [
      Entity.invariant(
        (d) => d.name.length <= 80,
        "name must be at most 80 characters",
      ),
    ],
  },
) {
  get greeting(): string {
    return `Welcome, ${this.name}`;
  }
}

// The package reads no clock and generates no id: bind the sources once,
// where your ports already live.
const createOrganization = Organization.factory({
  id: () => ids.next(),
  createdAt: () => clock.now(),
});

const org = createOrganization({ slug, name }).getOrThrow();
await db.insert(org.toJSON()); // exactly the stored shape — never `_tag`
const loaded = Organization.make(row).getOrThrow(); // rows, imports, event folds
const renamed = loaded.update({ name: next }).getOrThrow(); // a NEW entity
```

Failures are values, not exceptions:

```ts
import { P } from "unthrown";

Organization.make({ ...row, name: "" }).match({
  ok: (o) => o,
  errCases: (m) => m.with(P.tag("InvalidEntity"), (e) => e.issues), // [{ path: ["name"], … }]
  defect: (cause) => report(cause), // a bug in domain code, kept separate
});
```

The design rule the whole package turns on: **contracts compose the four plain
`ZodObject`s; domain code composes the class itself.** [Why](/explanation/why-entity).
