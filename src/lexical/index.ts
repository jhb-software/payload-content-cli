/**
 * Public entry point for the Lexical toolkit (`@jhb.software/payload-content-cli/lexical`).
 *
 * Everything here works on a document you fetched and will save yourself: a
 * plain object and a field path. It lets a server-side tool (an MCP
 * `updateRichText`, a migration script, a seed) change one node of a richtext
 * field instead of rewriting the whole document:
 *
 *   readRichText(doc, "content", { depth: 1 }); // what's there, with addresses
 *   editRichText(doc, "content", { op: "append", node: buildParagraph("New") });
 *
 * `readRichText` returns copies and `editRichText` is the only way to change a
 * field: it resolves the path, applies one edit or a batch, validates the
 * result, and writes it back — all or nothing, so a rejected edit leaves the
 * document exactly as it was.
 *
 * Nodes are addressed by their path through the tree — `"3"` is the fourth
 * top-level node, `"3.1"` its second child — so nesting is reachable, not just
 * `root.children`. Failures throw `LexicalError` with a `code`, so a tool can
 * tell "the agent gave a bad address" from a genuine fault.
 *
 * Fetching and saving the document is the caller's job; this module never talks
 * to Payload or the network.
 */

export type { LexicalElementNode, LexicalNode, LexicalRoot, LexicalTextNode } from "./types.js";
export { hasChildren, isLinkNode, isTextNode } from "./types.js";

// Editing: every change goes through here — resolve, apply, validate, write back.
export { editRichText } from "./edit.js";
export type { RichTextEdit } from "./edit.js";

// Failures, tagged with a code the caller can branch on.
export { LexicalError } from "./errors.js";
export type { LexicalErrorCode } from "./errors.js";

// Reading. Each takes the document and a field path, and returns copies.
export {
  diffRichText,
  extractRichTextBlocks,
  extractRichTextLinks,
  getRichTextNode,
  readRichText,
  searchRichText,
} from "./read.js";
export type { ReadOptions } from "./read.js";
export type { ExtractedBlock, ExtractedLink, ListEntry, SearchMatch } from "./operations.js";
export type { LexicalDiffResult, SourceLinkDiff } from "./diff.js";

// Building nodes to insert. Element builders take plain text or ready-made
// inline nodes (formatted text, links).
export {
  buildBlock,
  buildElement,
  buildHeading,
  buildHorizontalRule,
  buildInternalLink,
  buildList,
  buildParagraph,
  buildText,
} from "./nodes.js";
export type { InlineContent } from "./nodes.js";
