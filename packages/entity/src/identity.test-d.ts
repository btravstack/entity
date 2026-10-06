import { z } from "zod";

import { Entity } from "./index.js";

const OrgId = z.uuid().brand("OrgId");
const Name = z.string().min(1).brand("Name");
const Money = z.object({ amount: z.number() }).brand("Money");

class Org extends Entity("Org")({ id: Entity.field(OrgId, { identity: true }), name: Name }) {}
class Note extends Entity("Note")({ id: OrgId, body: Name }) {}

declare const org: Org;
declare const note: Note;

// identity declared: the comparison is there
const same: boolean = org.sameIdentityAs(note);
void same;

// @ts-expect-error no identity declared, so there is no identity to compare
note.sameIdentityAs(org);

// @ts-expect-error structural `equals` is gone: compare identity, or compare `toJSON()` yourself
org.equals(org);

// an identity field is immutable without saying so
// @ts-expect-error `id` is not patchable
org.update({ id: OrgId.parse("0199b1f4-1b1e-7000-8000-000000000000") });

// @ts-expect-error an identity is compared by value, so it must be a primitive, not an object
Entity.field(Money, { identity: true });

// @ts-expect-error an optional identity would make two id-less entities "the same"
Entity.field(OrgId.optional(), { identity: true });
