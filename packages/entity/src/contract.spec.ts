import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { expect, test } from "vitest";
import { z } from "zod";

import { Entity, computed } from "./index.js";

const ApiKeyId = z.uuid().brand("ApiKeyId");
const OrgId = z.uuid().brand("OrgId");
const SearchKey = z.string().min(1).brand("SearchKey");
const Instant = z.iso.datetime().brand("Instant");
const Label = z.string().min(1).brand("Label");

class ApiKey extends Entity("ApiKey")(
  { id: ApiKeyId, orgId: OrgId.readonly(), label: Label, createdAt: Instant },
  {
    generated: ["id", "createdAt"],
    immutable: ["id", "orgId", "createdAt"],
    // a denormalised field: stored so a query can index it, re-derived on
    // every construction so it cannot drift from `label`
    computed: computed({ searchKey: SearchKey }, (d) => ({
      searchKey: d.label.toLowerCase() as z.infer<typeof SearchKey>,
    })),
  },
) {}

const converter = new ZodToJsonSchemaConverter();
// `convert` returns `[jsonSchema, optional]` — there is no "supported" flag
// in this converter's API; a schema it cannot handle throws instead.
const props = (s: z.ZodType, io: "input" | "output") => {
  const [json] = converter.convert(s, io);
  return Object.keys(
    (json as { properties?: Record<string, unknown> }).properties ?? {},
  ).toSorted();
};

test("encoded drives the full request schema", () => {
  expect(props(ApiKey.encoded, "input")).toEqual(["createdAt", "id", "label", "orgId"]);
});

test("decoded drives the response schema", () => {
  expect(props(ApiKey.decoded, "output")).toEqual([
    "createdAt",
    "id",
    "label",
    "orgId",
    "searchKey",
  ]);
});

test("createInput is the create request schema", () => {
  expect(props(ApiKey.createInput, "input")).toEqual(["label", "orgId"]);
});

test("updateInput is the update request schema", () => {
  // `searchKey` is on the response schema but not this one: a computed field is
  // derived on every construction, so it is never part of an update request.
  expect(props(ApiKey.updateInput, "input")).toEqual(["label"]);
});

test("all four ZodObject members convert in both directions", () => {
  for (const s of [ApiKey.encoded, ApiKey.decoded, ApiKey.createInput, ApiKey.updateInput]) {
    for (const io of ["input", "output"] as const) {
      expect(() => z.toJSONSchema(s as never, { io })).not.toThrow();
    }
  }
});

test("the instance surface has no output representation, which is why it is separate", () => {
  expect(() => z.toJSONSchema(ApiKey.instance as never, { io: "output" })).toThrow();
});

test("no schema leaks the runtime tag", () => {
  for (const s of [ApiKey.encoded, ApiKey.decoded, ApiKey.createInput, ApiKey.updateInput]) {
    expect(Object.keys((s as z.ZodObject<z.ZodRawShape>).shape)).not.toContain("_tag");
  }
});

test("readonly() surfaces as readOnly in the generated schema", () => {
  const json = z.toJSONSchema(ApiKey.decoded, { io: "output" }) as unknown as {
    properties: { orgId: { readOnly?: boolean } };
  };
  expect(json.properties.orgId.readOnly).toBe(true);
});

test("contracts can still derive further views", () => {
  const Summary = ApiKey.decoded.pick({ id: true, searchKey: true });
  expect(Object.keys(Summary.shape).toSorted()).toEqual(["id", "searchKey"]);
});
