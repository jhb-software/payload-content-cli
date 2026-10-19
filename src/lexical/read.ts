/**
 * Searching, linking and comparing the rich text at a dot path.
 *
 * Each function takes the document and the dot path of a rich-text value
 * (`content`, `layout.1.richText`, `content.3.fields.body`) and covers the rich
 * text nested inside it too, so a link in a block's body is found from the
 * field the block sits in. Results name full dot paths, the same paths
 * `editAtPath` takes.
 */

import { diffLexicalDocs } from "./diff.js";
import type { LexicalDiffResult, RichTextSection } from "./diff.js";
import { LexicalError } from "./errors.js";
import { extractBlocks, extractLinks, linkFirstMatch, searchText } from "./operations.js";
import type { ExtractedBlock, ExtractedLink, SearchMatch } from "./operations.js";
import { richTextAt } from "./path.js";
import type { LexicalNode } from "./types.js";
import { assertValidTree } from "./validate.js";
import { isRichText } from "./view.js";

export interface RichTextPathsOptions {
  /** Also list rich text nested inside nodes, such as a block's body. Default: false. */
  nested?: boolean;
}

function collectPaths(value: unknown, path: string, nested: boolean, found: string[]): void {
  if (isRichText(value)) {
    found.push(path);
    if (nested) {
      value.root.children.forEach((node, i) => collectPaths(node, `${path}.${i}`, true, found));
    }
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => collectPaths(item, `${path}.${i}`, nested, found));
  } else if (typeof value === "object" && value !== null) {
    for (const [key, item] of Object.entries(value)) {
      collectPaths(item, path ? `${path}.${key}` : key, nested, found);
    }
  }
}

/**
 * The dot path of every rich-text value in a document, in document order —
 * fields inside arrays and blocks included. `nested: true` adds rich text
 * nested in nodes (`content.3.fields.body`).
 */
export function richTextPaths(doc: object, options: RichTextPathsOptions = {}): string[] {
  const found: string[] = [];
  collectPaths(doc, "", options.nested ?? false, found);
  return found;
}

/** The rich text at `path` and every rich text nested inside it. */
function sections(doc: object, path: string): RichTextSection[] {
  const value = richTextAt(doc, path);
  const paths: string[] = [];
  collectPaths(value, path, true, paths);
  return paths.map((at) => ({ path: at, children: richTextAt(doc, at).root.children }));
}

/** Unlinked text containing `search`, with the path of each text node it's in. */
export function searchRichText(doc: object, path: string, search: string): SearchMatch[] {
  return sections(doc, path).flatMap((section) =>
    searchText(section.children, section.path, search),
  );
}

/** Every internal link, with its text and target document. */
export function extractRichTextLinks(doc: object, path: string): ExtractedLink[] {
  return sections(doc, path).flatMap((section) => extractLinks(section.children, section.path));
}

/** Every block node, with its slug and the text it follows. */
export function extractRichTextBlocks(doc: object, path: string): ExtractedBlock[] {
  return sections(doc, path).flatMap((section) => extractBlocks(section.children, section.path));
}

/**
 * Wrap the first unlinked occurrence of `search` in `link` (e.g. from
 * `buildInternalLink`). Returns a changed copy; the document is not modified.
 * Throws `TEXT_NOT_FOUND` when there is no unlinked match.
 */
export function linkRichText<T extends object>(
  doc: T,
  path: string,
  search: string,
  link: LexicalNode,
): T {
  const copy = structuredClone(doc);
  for (const section of sections(copy, path)) {
    if (linkFirstMatch(section.children, search, link)) {
      assertValidTree(section.children);
      return copy;
    }
  }
  throw new LexicalError("TEXT_NOT_FOUND", `No unlinked "${search}" in ${path}.`);
}

/**
 * Compare the rich text at the same path in two documents — typically locale
 * variants of one document — reporting the links and blocks only one has.
 */
export function diffRichText(source: object, target: object, path: string): LexicalDiffResult {
  return diffLexicalDocs(sections(source, path), sections(target, path));
}
