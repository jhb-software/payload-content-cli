/**
 * Errors the Lexical toolkit throws, tagged with a `code`.
 *
 * Every failure here is caused by input a caller can fix — a field name that
 * isn't a richtext field, an address past the end of the tree, a node missing
 * its `version`. A tool relaying these to an agent needs to tell them apart
 * from genuine faults without matching on message text, so the code is part of
 * the contract while the message stays free to improve.
 */
export type LexicalErrorCode =
  /** The field path doesn't exist, or doesn't hold a lexical `{ root: … }` value. */
  | "FIELD_NOT_FOUND"
  /** The address isn't dot-separated non-negative integers. */
  | "INVALID_ADDRESS"
  /** The address is well-formed but points past the end of the tree. */
  | "ADDRESS_OUT_OF_BOUNDS"
  /** The addressed node can't hold children, so nothing can be nested in it. */
  | "NOT_A_CONTAINER"
  /** The text to link or replace doesn't appear in the tree (outside existing links). */
  | "TEXT_NOT_FOUND"
  /** The resulting tree has nodes Payload would reject; the edit was not applied. */
  | "INVALID_TREE"
  /** A node builder was given input it can't turn into a valid node. */
  | "INVALID_NODE";

export class LexicalError extends Error {
  readonly code: LexicalErrorCode;

  constructor(code: LexicalErrorCode, message: string) {
    super(message);
    this.name = "LexicalError";
    this.code = code;
  }
}
