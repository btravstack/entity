import { expect, test } from "vitest";
import { z } from "zod";

import { Entity } from "./index.js";

const Id = z.uuid().brand("Id");
const id = "0199b1f4-1b1e-7000-8000-000000000001";
const other = "0199b1f4-1b1e-7000-8000-000000000002";

test("a bigint field compares instead of throwing", () => {
  const Cents = z.bigint().brand("Cents");
  class Money extends Entity("Money")({ id: Id, amount: Cents }) {}
  const a = Money.make({ id, amount: 1n }).getOrThrow();
  const same = Money.make({ id, amount: 1n }).getOrThrow();
  const diff = Money.make({ id, amount: 2n }).getOrThrow();

  expect(a.equals(same)).toBe(true);
  expect(a.equals(diff)).toBe(false);
});

test("a Set field compares by contents, not by serialising to {}", () => {
  const Tag = z.string().min(1).brand("Tag");
  const Tags = z.set(Tag).brand("Tags");
  class Post extends Entity("Post")({ id: Id, tags: Tags }) {}

  const a = Post.make({ id, tags: new Set(["x", "y"]) }).getOrThrow();
  const reordered = Post.make({ id, tags: new Set(["y", "x"]) }).getOrThrow();
  const different = Post.make({ id, tags: new Set(["totally", "different"]) }).getOrThrow();

  expect(a.equals(reordered)).toBe(true);
  expect(a.equals(different)).toBe(false);
});

test("a Map field compares by entries, not by serialising to {}", () => {
  const Score = z.number().brand("Score");
  const Scores = z.map(z.string(), Score).brand("Scores");
  class Card extends Entity("Card")({ id: Id, scores: Scores }) {}

  const a = Card.make({ id, scores: new Map([["a", 1]]) }).getOrThrow();
  const same = Card.make({ id, scores: new Map([["a", 1]]) }).getOrThrow();
  const different = Card.make({ id, scores: new Map([["a", 99]]) }).getOrThrow();

  expect(a.equals(same)).toBe(true);
  expect(a.equals(different)).toBe(false);
});

test("a nested record ignores key order", () => {
  const Score = z.number().brand("Score");
  const Scores = z.record(z.string(), Score).brand("Scores");
  class Card extends Entity("Card")({ id: Id, scores: Scores }) {}

  const a = Card.make({ id, scores: { a: 1, b: 2 } }).getOrThrow();
  const b = Card.make({ id, scores: { b: 2, a: 1 } }).getOrThrow();

  expect(a.equals(b)).toBe(true);
});

test("arrays stay order-sensitive", () => {
  const Tag = z.string().min(1).brand("Tag");
  class Post extends Entity("Post")({ id: Id, tags: z.array(Tag) }) {}

  const a = Post.make({ id, tags: ["x", "y"] }).getOrThrow();
  const reordered = Post.make({ id, tags: ["y", "x"] }).getOrThrow();

  expect(a.equals(reordered)).toBe(false);
});

test("a Date field compares by timestamp", () => {
  const At = z.date().brand("At");
  class Event extends Entity("Event")({ id: Id, at: At }) {}

  const a = Event.make({ id, at: new Date("2026-01-01T00:00:00Z") }).getOrThrow();
  const same = Event.make({ id, at: new Date("2026-01-01T00:00:00Z") }).getOrThrow();
  const different = Event.make({ id, at: new Date("2026-01-02T00:00:00Z") }).getOrThrow();

  expect(a.equals(same)).toBe(true);
  expect(a.equals(different)).toBe(false);
});

test("differing declared data is still unequal", () => {
  class Plain extends Entity("Plain")({ id: Id }) {}
  expect(
    Plain.make({ id })
      .getOrThrow()
      .equals(Plain.make({ id: other }).getOrThrow()),
  ).toBe(false);
});

test("two separate Entity(...) calls never compare equal", () => {
  class A extends Entity("A")({ id: Id }) {}
  class B extends Entity("B")({ id: Id }) {}
  expect(A.make({ id }).getOrThrow().equals(B.make({ id }).getOrThrow())).toBe(false);
});

/**
 * `deepFreeze` guards cycles and names the sources — "a `z.custom` field or a
 * caller-supplied object can close a loop". The same applies to comparison, and
 * more so now that a `z.custom` value is not frozen. Unguarded, this died with
 * `RangeError: Maximum call stack size exceeded`.
 */
type Node = { name: string; self?: Node; peer?: Node };
const NodeSchema = z.custom<Node>((v) => typeof v === "object" && v !== null).brand("Node");

test("a cyclic field compares instead of exhausting the stack", () => {
  class Tree extends Entity("Tree")({ id: Id, root: NodeSchema }) {}
  const cyclic = (name: string): Node => {
    const n: Node = { name };
    n.self = n;
    return n;
  };

  const a = Tree.make({ id, root: cyclic("root") }).getOrThrow();
  const same = Tree.make({ id, root: cyclic("root") }).getOrThrow();
  const different = Tree.make({ id, root: cyclic("other") }).getOrThrow();

  expect(a.equals(same)).toBe(true);
  expect(a.equals(different)).toBe(false);
});

test("a cycle does not mask a difference reachable only through it", () => {
  class Tree extends Entity("Tree")({ id: Id, root: NodeSchema }) {}
  const linked = (peerName: string): Node => {
    const root: Node = { name: "root" };
    const peer: Node = { name: peerName, peer: root };
    root.peer = peer;
    return root;
  };

  const a = Tree.make({ id, root: linked("x") }).getOrThrow();
  const b = Tree.make({ id, root: linked("y") }).getOrThrow();
  expect(a.equals(b)).toBe(false);
});

test("the same object compared against two different values is not confused", () => {
  const Bag = z.object({ n: z.number() }).brand("Bag");
  class Holder extends Entity("Holder")({ id: Id, left: Bag, right: Bag }) {}
  const a = Holder.make({ id, left: { n: 1 }, right: { n: 1 } }).getOrThrow();
  const b = Holder.make({ id, left: { n: 1 }, right: { n: 2 } }).getOrThrow();
  expect(a.equals(b)).toBe(false);
});
