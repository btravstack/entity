import { TaggedError } from "unthrown";

export class InvalidEntity extends TaggedError("InvalidEntity")<{
  readonly entity: string;
  readonly issues: readonly string[];
}> {}
