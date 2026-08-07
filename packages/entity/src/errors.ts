import type { SchemaIssues } from "@unthrown/standard-schema";
import { TaggedError } from "unthrown";

import { renderIssue } from "./issues.js";

/**
 * `issues` stays structured (Standard Schema, as the validator produced it) so
 * a caller can key a field-level response off `path`. An `invariants`
 * violation has no `path` — that absence is what tells the two kinds apart.
 */
export class InvalidEntity extends TaggedError("InvalidEntity")<{
  readonly entity: string;
  readonly issues: SchemaIssues;
}> {
  // Rendered eagerly, so a log line, a thrown `getOrThrow`, or a failed test
  // assertion names the entity and the failing fields instead of printing a
  // blank `Error`. The structured `issues` stay the API; the message is only
  // their human spelling.
  override message = `${this.entity}: ${this.issues.map(renderIssue).join("; ")}`;
}
