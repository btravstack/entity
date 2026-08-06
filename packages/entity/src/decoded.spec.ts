import { P } from "unthrown";
import { expect, test } from "vitest";
import { z } from "zod";

import { Entity, add } from "./index.js";

const ApiKeyId = z.uuid().brand("ApiKeyId");
const OrgId = z.uuid().brand("OrgId");
const Secret = z.string().min(16).brand("Secret");
const Fingerprint = z.string().length(12).brand("Fingerprint");

const fingerprintOf = (s: string) => s.slice(0, 12) as z.infer<typeof Fingerprint>;

class ApiKey extends Entity("ApiKey")(
  { id: ApiKeyId, orgId: OrgId, secret: Secret },
  {
    decoded: {
      omit: ["secret"],
      add: add({ fingerprint: Fingerprint })((e) => ({
        fingerprint: fingerprintOf(e.secret),
      })),
    },
  },
) {}

const raw = {
  id: "0199b1f4-1b1e-7000-8000-000000000000",
  orgId: "0199b1f4-1b1e-7000-8000-000000000001",
  secret: "sk_live_9f3c2a7b41d8",
};

test("a computed field reaches the entity and its encoded output", () => {
  const key = ApiKey.decode(raw).getOrThrow();
  expect(key.fingerprint).toBe("sk_live_9f3c");
  expect(key.encode().fingerprint).toBe("sk_live_9f3c");
});

test("an omitted field is consumed and never stored", () => {
  const key = ApiKey.decode(raw).getOrThrow();
  expect(key.encode()).not.toHaveProperty("secret");
  expect(ApiKey.decoded.shape).not.toHaveProperty("secret");
  expect(ApiKey.encoded.shape).toHaveProperty("secret");
});

test("decode does not round-trip through encode for a split entity", () => {
  const key = ApiKey.decode(raw).getOrThrow();
  expect(ApiKey.decode(key.encode()).isErr()).toBe(true);
  expect(ApiKey.make(key.encode()).isOk()).toBe(true);
});

test("bad caller input is InvalidEntity, never a defect", () => {
  const outcome = ApiKey.decode({ ...raw, secret: "short" }).match({
    ok: () => "WRONGLY ACCEPTED",
    errCases: (m) => m.with(P.tag("InvalidEntity"), () => "invalid"),
    defect: () => "DEFECT",
  });
  expect(outcome).toBe("invalid");
});

test("add producing data its own schema rejects is a defect", () => {
  class Broken extends Entity("Broken")(
    { id: ApiKeyId, secret: Secret },
    {
      decoded: {
        omit: ["secret"],
        // Fingerprint requires exactly 12 characters; this returns 4.
        add: add({ fingerprint: Fingerprint })(() => ({
          fingerprint: "shrt" as z.infer<typeof Fingerprint>,
        })),
      },
    },
  ) {}
  const outcome = Broken.decode({ id: raw.id, secret: raw.secret }).match({
    ok: () => "WRONGLY ACCEPTED",
    errCases: (m) => m.with(P.tag("InvalidEntity"), () => "invalid"),
    defect: () => "defect",
  });
  expect(outcome).toBe("defect");
});

test("a field transform is applied exactly once, not once per validation pass", () => {
  let calls = 0;
  const Counted = z
    .string()
    .transform((s) => {
      calls += 1;
      return s;
    })
    .brand("Secret");
  class Once extends Entity("Once")({ id: ApiKeyId, secret: Counted }) {}
  Once.decode({ id: raw.id, secret: "whatever" }).getOrThrow();
  expect(calls).toBe(1);
});

test("invariants see the computed field", () => {
  class Checked extends Entity("Checked")(
    { id: ApiKeyId, secret: Secret },
    {
      decoded: {
        omit: ["secret"],
        add: add({ fingerprint: Fingerprint })((e) => ({
          fingerprint: fingerprintOf(e.secret),
        })),
      },
      invariants: (d) =>
        d.fingerprint.startsWith("sk_") ? [] : ["fingerprint must be a secret key"],
    },
  ) {}
  expect(Checked.decode({ id: raw.id, secret: raw.secret }).isOk()).toBe(true);
  expect(Checked.decode({ id: raw.id, secret: "xx_live_9f3c2a7b41d8" }).isErr()).toBe(true);
});
