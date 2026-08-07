---
"@btravstack/entity": patch
---

Five bugs, all in field types the package already accepts, all reproduced
before being fixed.

**`equals` no longer uses `JSON.stringify`.** Serialising was wrong three ways:
a `z.bigint()` field made `equals` **throw** `Do not know how to serialize a
BigInt` — escaping as an uncaught exception, since `equals` returns a bare
`boolean` with no Result channel; a `Set`, `Map` or typed-array field serialised
to `{}`, so entities with entirely different contents compared **equal**; and a
nested record holding `{a,b}` versus `{b,a}` compared **unequal** despite
identical contents. Comparison is now structural: `Set`/`Map` by contents,
`Date` by timestamp, typed arrays bytewise, nested objects key-by-key.
Arrays stay order-sensitive.

**A union discriminant may be an enum or a multi-value literal.** The lookup
read `.value`, which only a single-valued `z.literal` has — but `z.enum([...])`
is a blessed nominal field and `z.discriminatedUnion` dispatches on it happily.
The member registered under `undefined`, so `input.safeParse` accepted payloads
`make` then rejected, a payload _missing_ the discriminant was misrouted to that
member instead of reporting `Invalid discriminant`, and the error message
rendered the key as empty. A multi-value `z.literal(["a","b"])` was worse: it
**threw at union construction**.

**The four schema members are four distinct objects.** For an entity with no
`generated` and no `computed`, `input`, `output` and `createInput` were one
object under three names, so anything keying off schema identity collapsed —
registering them under distinct ids in `z.globalRegistry` silently kept only the
last, and `z.toJSONSchema` emitted a single `$def` all three `$ref`'d.

**A `z.custom` / `z.instanceof` field is no longer frozen.** The freeze
dispatched on runtime shape, so a plain-object custom value — the caller's own
reference, handed straight back — was deep-frozen in place, and the caller's
next write threw. Which fields to skip is now decided by the schema, which is
the only thing that knows what was passed through. This is what the
documentation already promised.
