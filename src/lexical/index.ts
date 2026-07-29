/**
 * Public entry point for the Lexical toolkit (`@jhb.software/payload-content-cli/lexical`).
 *
 * Pure functions over a Lexical tree — the same ones the `lexical` CLI commands
 * are built from, minus anything that touches the filesystem or parses CLI
 * flags. They let a server-side tool (an MCP `updateRichText`, a migration
 * script, a seed) edit one node of a richtext field instead of rewriting the
 * whole document.
 *
 * Start with `editRichText`, which reads the field, applies the edit, validates
 * the result, and writes it back:
 *
 *   const nodes = listNodes(resolveFieldPath(doc, "content")); // what's there
 *   editRichText(doc, "content", { op: "append", node: buildParagraph("New") });
 *
 * The primitives it composes (`addNode`, `replaceNode`, `removeNode`,
 * `setNodeProp`, `linkText`) are exported too, for edits it doesn't cover.
 * Every one is immutable: it clones the tree and returns new children, leaving
 * the input untouched.
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

// Reading a field and its tree.
export { resolveFieldPath } from "./field-path.js";
export { extractBlocks, extractLinks, getNode, listNodes, searchText } from "./operations.js";
export type {
  ExtractedBlock,
  ExtractedLink,
  ListEntry,
  ListOptions,
  SearchMatch,
} from "./operations.js";

// Checking a tree you assembled yourself. Returns the problems; `editRichText`
// applies this itself and refuses to write when it finds any.
export { validateTree } from "./validate.js";

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

// Comparing two trees (e.g. locale variants of one document).
export { diffLexicalDocs } from "./diff.js";
export type { LexicalDiffResult, SourceLinkDiff } from "./diff.js";
