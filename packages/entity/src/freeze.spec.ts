import { expect, test } from "vitest";

import { deepFreeze } from "./freeze.js";

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
