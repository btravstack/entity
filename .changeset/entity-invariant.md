---
"@btravstack/entity": minor
---

**Breaking.** `invariants` is now a list of rules built with `Entity.invariant`,
replacing the single function that returned messages.

```diff
 class Organization extends Entity("Organization")(
   { name: DisplayName, note: Line },
   {
-    invariants: (d) => [
-      ...(d.name.length <= 80 ? [] : ["name must be at most 80 characters"]),
-      ...(d.note.length >= d.name.length ? [] : ["note must be at least as long"]),
-    ],
+    invariants: [
+      Entity.invariant((d) => d.name.length <= 80, "name must be at most 80 characters"),
+      Entity.invariant(
+        (d) => d.note.length >= d.name.length,
+        (d) => `note must be at least ${d.name.length} characters`,
+      ),
+    ],
   },
 ) {}
```

A rule and its message are now one value, so several rules no longer need
hand-rolled accumulation. `ensure` returning **true** means valid. `message`
takes the data when the text depends on it. Every failing rule reports, not just
the first — unchanged from before.

**A rule now sees the declared fields only.** It can no longer read a computed
field. Every computed value is a function of declared data, so any rule about
one is expressible over its sources, and a computed value that fails its own
schema is already a Defect rather than something to re-check in an invariant.

**`extend` no longer lets an extension shed its parent's rules.** `invariants`
is the one option that concatenates parent-then-child instead of the child
replacing the parent. An extension can add rules; it cannot remove them, which
is what the design always intended. Code relying on `{ invariants: () => [] }`
to relax a parent has no replacement — that escape hatch is gone deliberately.
