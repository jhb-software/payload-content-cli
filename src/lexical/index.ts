/**
 * Public entry point for the Lexical toolkit (`@jhb.software/payload-content-cli/lexical`).
 *
 * Everything here works on a document you fetched and will save yourself. One
 * dot path addresses anything in it, from a rich-text field down to a value
 * inside a node, through blocks into the rich text nested in them:
 *
 *   readAtPath(doc, "content");     // ["content.0 p: Intro", "content.1 block alert: …"]
 *   editAtPath(doc, "content.2", "insert", { type: "p", text: "New" });
 *   editAtPath(doc, "layout.1.richText.3.fields.body.0.children.1.fields.doc.value", "set", "id");
 *   linkRichText(doc, "content", "visa rules", { relationTo: "pages", value: "visa" });
 *
 * Reads show rich text as outlines whose lines start with their paths. Changes
 * come back as a changed copy, validated first — a rejected change leaves
 * nothing half-written. Failures throw `LexicalError` with a `code`, so a tool
 * can tell "the agent gave a bad path" from a genuine fault.
 *
 * Fetching and saving the document is the caller's job; this module never talks
 * to Payload or the network.
 */

export type { LexicalElementNode, LexicalNode, LexicalRoot, LexicalTextNode } from "./types.js";

// One dot path from the document down to any value inside its rich text.
export { editAtPath, readAtPath } from "./path.js";
export type { PathEdit, PathEditResult } from "./path.js";

// Failures, tagged with a code the caller can branch on.
export { LexicalError } from "./errors.js";
export type { LexicalErrorCode } from "./errors.js";

// Searching, linking and comparing every rich text at or below a path.
export {
  diffRichText,
  extractRichTextLinks,
  linkRichText,
  richTextPaths,
  searchRichText,
} from "./read.js";
export type { RichTextPathsOptions } from "./read.js";
export type { LinkTarget } from "./nodes.js";
export type { ExtractedBlock, ExtractedLink, SearchMatch } from "./operations.js";
export type { LexicalDiffResult, SourceLinkDiff } from "./diff.js";
