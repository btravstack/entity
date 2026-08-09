import { expectTypeOf, test } from "vitest";
import { z } from "zod";

import type {
  ComputedOf,
  CreateInputOf,
  OutputOf,
  InputOf,
  Fields,
  PatchOf,
  Sealed,
} from "./types.js";

const OrgId = z.uuid().brand("OrgId");
const Slug = z.string().brand("Slug");
const Secret = z.string().brand("Secret");
const Fingerprint = z.string().brand("Fingerprint");
const Instant = z.iso.datetime().brand("Instant");

type S = {
  id: typeof OrgId;
  slug: typeof Slug;
  secret: typeof Secret;
  createdAt: typeof Instant;
};
type A = { fingerprint: typeof Fingerprint };

test("the test fixtures satisfy the Fields constraint", () => {
  type CheckS = S extends Fields ? true : false;
  type CheckA = A extends Fields ? true : false;
  expectTypeOf<CheckS>().toEqualTypeOf<true>();
  expectTypeOf<CheckA>().toEqualTypeOf<true>();
});

test("InputOf is the plain inferred object", () => {
  expectTypeOf<InputOf<S>["slug"]>().toEqualTypeOf<z.infer<typeof Slug>>();
});

test("ComputedOf of an empty shape has no keys and no index signature", () => {
  // zod infers an EMPTY shape as Record<string, never>, a real index signature.
  // Unguarded, that poisons every option-less entity's decoded type.
  expectTypeOf<keyof ComputedOf<Record<never, never>>>().toEqualTypeOf<never>();
});

test("OutputOf is the declared fields plus the computed ones, and carries no _tag", () => {
  type D = OutputOf<S, A>;
  expectTypeOf<D["fingerprint"]>().toEqualTypeOf<z.infer<typeof Fingerprint>>();
  expectTypeOf<D["secret"]>().toEqualTypeOf<z.infer<typeof Secret>>();
  // the tag is a runtime-only instance property, never part of the data
  expectTypeOf<D>().not.toHaveProperty("_tag");
});

test("OutputOf with no computed fields is the encoded object", () => {
  type D = OutputOf<S, Record<never, never>>;
  expectTypeOf<D["secret"]>().toEqualTypeOf<z.infer<typeof Secret>>();
});

test("CreateInputOf drops the generated fields", () => {
  type C = CreateInputOf<S, "id" | "createdAt">;
  expectTypeOf<C>().not.toHaveProperty("id");
  expectTypeOf<C["slug"]>().toEqualTypeOf<z.infer<typeof Slug>>();
});

test("PatchOf is partial and drops the immutable fields", () => {
  type P = PatchOf<S, A, "id" | "createdAt">;
  expectTypeOf<P>().not.toHaveProperty("id");
  expectTypeOf<P["slug"]>().toEqualTypeOf<z.infer<typeof Slug> | undefined>();
  // `fingerprint` is not in the immutable list, yet it is still gone: a
  // computed field is derived on every construction, so it is never patchable
  expectTypeOf<P>().not.toHaveProperty("fingerprint");
});

test("Sealed cannot be produced from outside the module", () => {
  const plain = {} as unknown as InputOf<S>;
  // @ts-expect-error the construction key cannot be named outside types.ts
  const sealed: Sealed<InputOf<S>> = plain;
  void sealed;
});
