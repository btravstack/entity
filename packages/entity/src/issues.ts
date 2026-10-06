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

/**
 * The domain code a failing `Entity.invariant` declared, or `undefined`.
 *
 * Read from `params.code`, where `construct` puts it and where zod keeps a
 * custom issue's metadata — so a field schema's own
 * `.refine(…, { params: { code } })` is read the same way. `params` is not
 * part of Standard Schema's issue type, and anything may sit there, so this
 * checks the shape instead of trusting it.
 */
export const codeOf = (issue: SchemaIssues[number]): string | undefined => {
  const params: unknown = (issue as { readonly params?: unknown }).params;
  const code: unknown =
    typeof params === "object" && params !== null
      ? (params as { readonly code?: unknown }).code
      : undefined;
  return typeof code === "string" ? code : undefined;
};

/**
 * One `InvalidEntity` issue re-raised as a zod custom issue, for a nested
 * entity or a union member reporting through its parent's parse. Keeps the
 * code: dropping `params` here would lose it one level down.
 */
export const toZodIssue = (issue: SchemaIssues[number]) => {
  const code = codeOf(issue);
  return {
    code: "custom" as const,
    message: issue.message,
    path: keysOf(issue),
    ...(code === undefined ? {} : { params: { code } }),
  };
};

/** Human-readable text for a defect message, which has nowhere to put structure. */
export const renderIssue = (issue: SchemaIssues[number]): string => {
  const path = keysOf(issue).map(String).join(".");
  return path.length === 0 ? issue.message : `${path}: ${issue.message}`;
};
