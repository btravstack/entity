---
title: Errors are values, and defects are separate
description: Where the line falls between bad caller input and a bug in domain code, and why the two never merge.
---

# Errors are values, and defects are separate

Every fallible entry point returns `Result<T, InvalidEntity>`. Bad input is
modelled; a bug in domain code is not.

The line: a field failing its schema or a broken invariant is `InvalidEntity` —
expected, caller-caused. A `computed` function throwing or producing data its
own schema rejects is a **defect**: `computed` is pure, total and typed, so a
violation is a bug rather than bad input. An async generator rejecting is a
defect for the same reason — infrastructure failing is not bad domain input.

A defect is never folded into a validation issue, even when the entity is
nested inside another schema. An unmodelled bug stays distinguishable from bad
caller input all the way to the edge.

Issues are carried **structured**, exactly as the validator produced them, so
keying a field-level error response is a `path` lookup rather than a string
parse.

[Errors](/reference/errors) tabulates which failure takes which channel; the
[unthrown docs](https://btravstack.github.io/unthrown/explanation/the-defect-channel)
explain the defect channel itself.
