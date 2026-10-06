import { z } from "zod";

import { Entity } from "./index.js";

const OrgId = z.uuid().brand("OrgId");
const Name = z.string().min(1).brand("Name");
const Tag = z.string().min(1).brand("Tag");

class Org extends Entity("Org")({
  kind: z.literal("org"),
  id: Entity.field(OrgId, { identity: true }),
  name: Name,
  tags: z.array(Tag),
}) {}
class Note extends Entity("Note")({ kind: z.literal("note"), body: Name }) {}

const { data, violations } = Org.inspect({}).getOrThrow();

// the data reads like the entity's stored state
const name: string = data.name;
void name;

// every violation is an ordinary issue, so the code reads back the same way
const code: string | undefined =
  violations[0] === undefined ? undefined : Entity.codeOf(violations[0]);
void code;

/* ── An inspection never passes for an entity ─────────────────────────── */

const command = (org: Org): Org => org;
// @ts-expect-error inspected data is not an entity: migrate it, then `make`
command(data);

// @ts-expect-error no commands on inspected data
data.update({ name: Name.parse("x") });

// @ts-expect-error no identity comparison either
data.sameIdentityAs(data);

// @ts-expect-error no tag: it cannot be matched as an instance
void data._tag;

// @ts-expect-error read-only at the top
data.name = Name.parse("x");

// @ts-expect-error and all the way down
data.tags.push(Tag.parse("x"));

/* ── Only where `make` exists ─────────────────────────────────────────── */

const Root = Entity.abstract("Root")({ name: Name });
// @ts-expect-error an abstract root has no `make`, so it has no `inspect`
Root.inspect({});

/* ── A union reports its members' data ────────────────────────────────── */

const Item = Entity.union("kind", [Org, Note]);
const item = Item.inspect({}).getOrThrow().data;
const kind: "org" | "note" = item.kind;
void kind;
// @ts-expect-error the union's data is no member instance either
const asOrg: Org | Note = item;
void asOrg;
