import { ZodToJsonSchemaConverter } from "@orpc/zod";
import { expect, test } from "vitest";
import { z } from "zod";

import { Entity, add } from "./index.js";

const ApiKeyId = z.uuid().brand("ApiKeyId");
const OrgId = z.uuid().brand("OrgId");
const Secret = z.string().min(16).brand("Secret");
const Fingerprint = z.string().length(12).brand("Fingerprint");
const Instant = z.iso.datetime().brand("Instant");
const Label = z.string().min(1).brand("Label");

class ApiKey extends Entity("ApiKey")(
  { id: ApiKeyId, orgId: OrgId.readonly(), secret: Secret, label: Label, createdAt: Instant },
  {
    generated: ["id", "createdAt"],
    immutable: ["id", "orgId", "createdAt"],
    decoded: {
      omit: ["secret"],
      add: add({ fingerprint: Fingerprint })((e) => ({
        fingerprint: e.secret.slice(0, 12) as z.infer<typeof Fingerprint>,
      })),
    },
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
  expect(props(ApiKey.encoded, "input")).toEqual(["createdAt", "id", "label", "orgId", "secret"]);
});

test("decoded drives the response schema", () => {
  expect(props(ApiKey.decoded, "output")).toEqual([
    "createdAt",
    "fingerprint",
    "id",
    "label",
    "orgId",
  ]);
});

test("createInput is the create request schema", () => {
  expect(props(ApiKey.createInput, "input")).toEqual(["label", "orgId", "secret"]);
});

test("updateInput is the update request schema", () => {
  // `fingerprint` is on the response schema but not this one: `add` fields are
  // implicitly immutable, so they are never part of an update request.
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
  const Summary = ApiKey.decoded.pick({ id: true, fingerprint: true });
  expect(Object.keys(Summary.shape).toSorted()).toEqual(["fingerprint", "id"]);
});
