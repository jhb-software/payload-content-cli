/**
 * Errors the Lexical toolkit throws, tagged with a `code`.
 *
 * Every failure here is caused by input a caller can fix — a path that
 * reaches no rich text, an index past the end of a list, a node missing
 * its `version`. A tool relaying these to an agent needs to tell them apart
 * from genuine faults without matching on message text, so the code is part of
 * the contract while the message stays free to improve.
 */
export type LexicalErrorCode =
  /** The text to link doesn't appear in the tree (outside existing links). */
  | "TEXT_NOT_FOUND"
  /** The resulting tree has nodes Payload would reject; the edit was not applied. */
  | "INVALID_TREE"
  /** A node builder was given input it can't turn into a valid node. */
  | "INVALID_NODE"
  /** A path segment names no key or index of the value it was applied to. */
  | "PATH_NOT_FOUND"
  /** The operation doesn't apply to what the path reaches, e.g. inserting where there is no list of nodes. */
  | "UNSUPPORTED_AT_PATH";

export class LexicalError extends Error {
  readonly code: LexicalErrorCode;

  constructor(code: LexicalErrorCode, message: string) {
    super(message);
    this.name = "LexicalError";
    this.code = code;
  }
}
