/**
 * Public entry point for the Lexical toolkit (`@jhb.software/payload-content-cli/lexical`).
 *
 * Everything here works on a document you fetched and will save yourself. One
 * dot path addresses anything in it, from a rich-text field down to a value
 * inside a node, through blocks into the rich text nested in them:
 *
 *   editAtPath(doc, "content", "read");                 // an outline, one line per node
 *   editAtPath(doc, "content.2", "insert", { type: "p", text: "New" });
 *   editAtPath(doc, "layout.1.richText.3.fields.body.0.children.1.fields.doc.value", "set", "id");
 *
 * Changes come back as a changed copy, validated first — a rejected change
 * leaves nothing half-written. Failures throw `LexicalError` with a `code`, so a
 * tool can tell "the agent gave a bad path" from a genuine fault.
 *
 * Fetching and saving the document is the caller's job; this module never talks
 * to Payload or the network.
 */

export type { LexicalElementNode, LexicalNode, LexicalRoot, LexicalTextNode } from "./types.js";
export { hasChildren, isLinkNode, isTextNode } from "./types.js";

// Path-addressed reads and edits — one dot path from a rich-text field down to
// any node or value inside it, with compact views for agents.
export { editAtPath } from "./path.js";
export type { PathEditResult, PathOperation } from "./path.js";

// Failures, tagged with a code the caller can branch on.
export { LexicalError } from "./errors.js";
export type { LexicalErrorCode } from "./errors.js";

// Searching, linking and comparing the rich text at a path, nested rich text included.
export {
  diffRichText,
  extractRichTextBlocks,
  extractRichTextLinks,
  linkRichText,
  richTextPaths,
  searchRichText,
} from "./read.js";
export type { RichTextPathsOptions } from "./read.js";
export type { ExtractedBlock, ExtractedLink, SearchMatch } from "./operations.js";
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
