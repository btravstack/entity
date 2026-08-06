import { P } from "unthrown";
import { expect, test } from "vitest";
import { z } from "zod";

import { Entity, add } from "./index.js";
import { keysOf } from "./issues.js";

const ApiKeyId = z.uuid().brand("ApiKeyId");
const OrgId = z.uuid().brand("OrgId");
const Secret = z.string().min(16).brand("Secret");
const Fingerprint = z.string().length(12).brand("Fingerprint");
const Slug = z.string().min(1).brand("Slug");
const Upper = z.string().min(1).brand("Upper");

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

type Flat = { readonly path: readonly PropertyKey[]; readonly message: string };

const issuesOf = (r: ReturnType<typeof ApiKey.decode>): readonly Flat[] =>
  r.match({
    ok: () => [{ path: [], message: "WRONGLY ACCEPTED" }],
    errCases: (m) =>
      m.with(P.tag("InvalidEntity"), (e) =>
        e.issues.map((i) => ({ path: keysOf(i), message: i.message })),
      ),
    defect: () => [{ path: [], message: "DEFECT" }],
  });

test("a computed field is absent from updateInput", () => {
  // `add` fields are implicitly immutable: nothing declares `fingerprint` in
  // `immutable`, yet it must not appear in the update request schema.
  expect(Object.keys(ApiKey.updateInput.shape)).toEqual(["id", "orgId"]);
  expect(ApiKey.decoded.shape).toHaveProperty("fingerprint");
});

test("updating a source field leaves the entity consistent", () => {
  class Org extends Entity("Org")(
    { id: OrgId, slug: Slug },
    {
      decoded: {
        add: add({ slugUpper: Upper })((e) => ({
          slugUpper: e.slug.toUpperCase() as z.infer<typeof Upper>,
        })),
      },
    },
  ) {}
  const org = Org.decode({ id: raw.orgId, slug: "acme" }).getOrThrow();
  const renamed = org.update({ slug: "beta" as z.infer<typeof Slug> }).getOrThrow();
  // `slugUpper` is carried over, not recomputed — the encoded object `add`
  // reads from is gone by `update` time. It stays pinned to the value the
  // entity was decoded with, so the pair is never internally contradictory in
  // the way a silently stale recomputation would be.
  expect(renamed.slug).toBe("beta");
  expect(renamed.slugUpper).toBe("ACME");
  expect(Org.decode({ id: raw.orgId, slug: renamed.slug }).getOrThrow().slugUpper).toBe("BETA");
});

test("update ignores a computed field smuggled in at runtime", () => {
  const key = ApiKey.decode(raw).getOrThrow();
  const updated = key.update({ fingerprint: "LIESLIESLIES" } as never).getOrThrow();
  expect(updated.fingerprint).toBe("sk_live_9f3c");
});

test("bad caller input is InvalidEntity, never a defect", () => {
  const outcome = ApiKey.decode({ ...raw, secret: "short" }).match({
    ok: () => "WRONGLY ACCEPTED",
    errCases: (m) => m.with(P.tag("InvalidEntity"), () => "invalid"),
    defect: () => "DEFECT",
  });
  expect(outcome).toBe("invalid");
});

test("a single bad field is named by its path", () => {
  expect(issuesOf(ApiKey.decode({ ...raw, secret: "short" }))).toEqual([
    { path: ["secret"], message: "Too small: expected string to have >=16 characters" },
  ]);
});

test("each bad field is named when several fail at once", () => {
  expect(issuesOf(ApiKey.decode({ ...raw, orgId: "nope", secret: "short" }))).toEqual([
    { path: ["orgId"], message: "Invalid UUID" },
    { path: ["secret"], message: "Too small: expected string to have >=16 characters" },
  ]);
});

test("an omitted field still reports under its wire name", () => {
  // `secret` never reaches `decoded`, but `decode` validates `encoded`
  expect(issuesOf(ApiKey.decode({ ...raw, secret: "short" }))[0]?.path).toEqual(["secret"]);
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
    defect: (cause) => (cause instanceof Error ? cause.message : "defect"),
  });
  // the defect message carries the same path prefix, so a bug in `add` says
  // which computed field its own schema rejected
  expect(outcome).toBe(
    "Broken.add produced data its own schema rejects: fingerprint: Too small: expected string to have >=12 characters",
  );
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
