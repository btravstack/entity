import { expect, test } from "vitest";
import { z } from "zod";

import { deepFreeze } from "./freeze.js";
import { Entity } from "./index.js";

const JobId = z.uuid().brand("JobId");
const jobId = "0199b1f4-1b1e-7000-8000-000000000001";

test("a primitive passes straight through", () => {
  expect(deepFreeze("a")).toBe("a");
  expect(deepFreeze(null)).toBe(null);
  expect(deepFreeze(undefined)).toBe(undefined);
});

test("the same reference comes back, so it can wrap the value it guards", () => {
  const value = { a: 1 };
  expect(deepFreeze(value)).toBe(value);
});

test("plain objects and arrays are frozen all the way down", () => {
  const value = deepFreeze({ list: [{ deep: ["x"] }] });
  expect(Object.isFrozen(value)).toBe(true);
  expect(Object.isFrozen(value.list)).toBe(true);
  expect(Object.isFrozen(value.list[0])).toBe(true);
  expect(Object.isFrozen(value.list[0]?.deep)).toBe(true);
});

test("a cyclic structure terminates instead of recursing forever", () => {
  const node: Record<string, unknown> = { name: "root" };
  node["self"] = node;
  node["child"] = { parent: node };
  expect(Object.isFrozen(deepFreeze(node))).toBe(true);
  expect(Object.isFrozen(node["child"])).toBe(true);
});

test("a Date is frozen, but only against added properties", () => {
  const date = deepFreeze(new Date(0));
  expect(Object.isFrozen(date)).toBe(true);
  // its timestamp lives in an internal slot, so freezing cannot lock it —
  // this is why `freeze.ts` documents Date as a partial guarantee
  date.setTime(1);
  expect(date.getTime()).toBe(1);
});

test("objects freezing would not help, or would break, are left alone", () => {
  // a frozen Map still accepts `.set`, and a class instance may rely on
  // writing its own fields — freezing either buys nothing and can destroy
  // behaviour, so `deepFreeze` skips them and the README scopes the
  // guarantee to plain data
  const map = deepFreeze(new Map([["k", { v: 1 }]]));
  expect(Object.isFrozen(map)).toBe(false);
  expect(Object.isFrozen(map.get("k"))).toBe(false);

  class Counter {
    count = 0;
    bump(): void {
      this.count += 1;
    }
  }
  const counter = deepFreeze(new Counter());
  counter.bump();
  expect(counter.count).toBe(1);
});

test("a null-prototype object counts as plain data", () => {
  const bare = Object.assign(Object.create(null) as object, { a: 1 });
  expect(Object.isFrozen(deepFreeze(bare))).toBe(true);
});

test("a shared `seen` set freezes a subtree reachable from two fields once", () => {
  const shared = { tags: ["a"] };
  const left = { shared };
  const right = { shared };

  // what the entity constructor does: one set across every field
  const seen = new WeakSet<object>();
  deepFreeze(left, seen);
  deepFreeze(right, seen);

  expect(Object.isFrozen(shared)).toBe(true);
  expect(Object.isFrozen(shared.tags)).toBe(true);
  expect(Object.isFrozen(left)).toBe(true);
  expect(Object.isFrozen(right)).toBe(true);
});

test("omitting `seen` still freezes, so a standalone call is unchanged", () => {
  const value = { nested: { tags: ["a"] } };
  deepFreeze(value);
  expect(Object.isFrozen(value.nested.tags)).toBe(true);
});

/**
 * The freeze decides by schema, not by the runtime shape of the value. A
 * `z.custom` field hands the caller's own reference straight through, and
 * freezing it in place mutated an object the caller still owns — the exact
 * risk this module's docstring names.
 */
test("a z.custom field is left alone, so the caller's object stays writable", () => {
  type Config = { retries: number; nested: { a: number } };
  const ConfigSchema = z.custom<Config>((v) => typeof v === "object" && v !== null).brand("Config");
  class Job extends Entity("Job")({ id: JobId, config: ConfigSchema }) {}

  const caller: Config = { retries: 1, nested: { a: 1 } };
  const job = Job.make({ id: jobId, config: caller }).getOrThrow();

  expect(Object.isFrozen(caller)).toBe(false);
  expect(Object.isFrozen(caller.nested)).toBe(false);
  caller.retries = 5;
  expect(caller.retries).toBe(5);
  // and the entity holds that same reference, as z.custom promises
  expect(job.config).toBe(caller);
});

test("an ordinary object field is still deep-frozen", () => {
  const Address = z.object({ city: z.string() }).brand("Address");
  class Place extends Entity("Place")({ id: JobId, address: Address }) {}
  const p = Place.make({ id: jobId, address: { city: "Paris" } }).getOrThrow();
  expect(Object.isFrozen(p.address)).toBe(true);
});

/**
 * The skip has to work at any depth, not only when the custom value *is* the
 * field: the walk carries the schema down with the value. Reported in review
 * after the first fix, which only compared top-level field schemas.
 */
type Cfg = { retries: number; nested: { a: number } };
const CfgSchema = z.custom<Cfg>((v) => typeof v === "object" && v !== null);
const cfg = (): Cfg => ({ retries: 1, nested: { a: 1 } });

test("a z.custom nested in an object field stays writable", () => {
  const Wrapper = z.object({ cfg: CfgSchema, label: z.string() }).brand("Wrapper");
  class Job extends Entity("Job")({ id: JobId, wrapper: Wrapper }) {}

  const caller = cfg();
  const job = Job.make({ id: jobId, wrapper: { cfg: caller, label: "x" } }).getOrThrow();

  expect(Object.isFrozen(caller)).toBe(false);
  caller.retries = 5;
  expect(caller.retries).toBe(5);
  // the wrapper itself is ordinary decoded data, so it is still frozen
  expect(Object.isFrozen(job.wrapper)).toBe(true);
});

test("a z.custom inside an array field stays writable", () => {
  const List = z.array(CfgSchema.brand("Cfg")).brand("List");
  class Job extends Entity("Job")({ id: JobId, list: List }) {}

  const caller = cfg();
  const job = Job.make({ id: jobId, list: [caller] }).getOrThrow();

  expect(Object.isFrozen(caller)).toBe(false);
  // the array holding it is decoded data, and is frozen
  expect(Object.isFrozen(job.list)).toBe(true);
});

test("a z.custom behind optional/default wrappers is still recognised", () => {
  const Wrapper = z.object({ cfg: CfgSchema.optional() }).brand("Wrapper2");
  class Job extends Entity("Job2")({ id: JobId, wrapper: Wrapper }) {}

  const caller = cfg();
  Job.make({ id: jobId, wrapper: { cfg: caller } }).getOrThrow();
  expect(Object.isFrozen(caller)).toBe(false);
});

test("a z.custom inside a record value stays writable", () => {
  const Map_ = z.record(z.string(), CfgSchema).brand("CfgMap");
  class Job extends Entity("Job3")({ id: JobId, cfgs: Map_ }) {}

  const caller = cfg();
  Job.make({ id: jobId, cfgs: { a: caller } }).getOrThrow();
  expect(Object.isFrozen(caller)).toBe(false);
});
