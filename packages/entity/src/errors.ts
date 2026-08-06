import type { SchemaIssues } from "@unthrown/standard-schema";
import { TaggedError } from "unthrown";

/**
 * `issues` stays structured (Standard Schema, as the validator produced it) so
 * a caller can key a field-level response off `path`. An `invariants`
 * violation has no `path` — that absence is what tells the two kinds apart.
 */
export class InvalidEntity extends TaggedError("InvalidEntity")<{
  readonly entity: string;
  readonly issues: SchemaIssues;
}> {}
