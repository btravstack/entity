import type { SchemaIssues } from "@unthrown/standard-schema";

type IssuePath = NonNullable<SchemaIssues[number]["path"]>;

/**
 * A path segment is either a bare `PropertyKey` or a `{ key }` wrapper —
 * Standard Schema permits both, and zod v4 emits the bare form.
 */
const keyOf = (segment: IssuePath[number]): PropertyKey =>
  typeof segment === "object" ? segment.key : segment;

/** A Standard Schema path as plain keys, which is what zod's `addIssue` wants. */
export const keysOf = (issue: SchemaIssues[number]): PropertyKey[] => (issue.path ?? []).map(keyOf);

/** Human-readable text for a defect message, which has nowhere to put structure. */
export const renderIssue = (issue: SchemaIssues[number]): string => {
  const path = keysOf(issue).map(String).join(".");
  return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
};
