/**
 * Searching, linking and comparing rich text.
 *
 * Each function takes the document and a dot path, and covers every rich text
 * at or below it, nested rich text included: `content`, `layout.1` (an array
 * row), `content.3` (a block), or `""` for the whole document. Results name
 * full dot paths, the same paths `readAtPath` and `editAtPath` take.
 */

import { diffLexicalDocs } from "./diff.js";
import type { LexicalDiffResult, RichTextSection } from "./diff.js";
import { LexicalError } from "./errors.js";
import { buildInternalLink } from "./nodes.js";
import type { LinkTarget } from "./nodes.js";
import { extractLinks, linkFirstMatch, searchText } from "./operations.js";
import type { ExtractedLink, SearchMatch } from "./operations.js";
import { valueAtPath } from "./path.js";
import { hasChildren, isLinkNode, type LexicalNode } from "./types.js";
import { assertValidTree } from "./validate.js";
import { hydrateNode, isRichText, outlineLine, type RichTextValue } from "./view.js";

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

const isLexicalNode = (value: unknown): value is LexicalNode =>
  typeof value === "object" && value !== null && typeof (value as LexicalNode).type === "string";

/** A list of nodes to search; `only` narrows it to the node at that index. */
type Section = RichTextSection & { only?: number };

/**
 * Every rich text at or below `path`, nested rich text included. A path to a
 * node with children, such as a paragraph, covers just that node's children;
 * a path to a text node covers just that node.
 */
function sections(doc: object, path: string): Section[] {
  const value = valueAtPath(doc, path);
  const inList = /^(.+\.children)\.(\d+)$/.exec(path);
  if (isLexicalNode(value) && value.type === "text" && inList) {
    const [, listPath, index] = inList;
    return [
      {
        path: listPath,
        children: valueAtPath(doc, listPath) as LexicalNode[],
        only: Number(index),
      },
    ];
  }
  if (isLexicalNode(value) && hasChildren(value)) {
    if (isLinkNode(value)) {
      throw new LexicalError("UNSUPPORTED_AT_PATH", `${path} is a link; pass the node holding it.`);
    }
    return [{ path: `${path}.children`, children: value.children }];
  }
  const paths: string[] = [];
  collectPaths(value, path, true, paths);
  if (paths.length === 0) {
    throw new LexicalError("PATH_NOT_FOUND", `No rich text at ${path || "the document"}.`);
  }
  return paths.map((at) => ({
    path: at,
    children: (valueAtPath(doc, at) as RichTextValue).root.children,
  }));
}

/** Text containing `search`, with the path of each text node it's in; matches inside a link say `linked`. */
export function searchRichText(doc: object, path: string, search: string): SearchMatch[] {
  return sections(doc, path).flatMap((section) =>
    searchText(section.children, section.path, search).filter(
      (match) => section.only === undefined || match.path === `${section.path}.${section.only}`,
    ),
  );
}

/** Every internal link, with its text and target document. */
export function extractRichTextLinks(doc: object, path: string): ExtractedLink[] {
  return sections(doc, path)
    .filter((section) => section.only === undefined)
    .flatMap((section) => extractLinks(section.children, section.path));
}

/**
 * Link the first unlinked occurrence of `text` to a document. Returns a
 * changed copy, the path of the new link and the outline line of the node
 * holding it; the document is not modified.
 * Throws `TEXT_NOT_FOUND` when there is no unlinked match.
 */
export function linkRichText<T extends object>(
  doc: T,
  path: string,
  text: string,
  target: LinkTarget,
): { doc: T; path: string; outline: string } {
  const copy = structuredClone(doc);
  const link = hydrateNode(buildInternalLink(text, target));
  for (const section of sections(copy, path)) {
    const at = linkFirstMatch(section.children, section.path, text, link, section.only);
    if (at) {
      assertValidTree(section.children);
      const holder = at.replace(/\.children\.\d+$/, "");
      return {
        doc: copy,
        path: at,
        outline: outlineLine(valueAtPath(copy, holder) as LexicalNode, holder),
      };
    }
  }
  throw new LexicalError("TEXT_NOT_FOUND", `No unlinked "${text}" in ${path || "the document"}.`);
}

/**
 * Compare the rich text at the same path in two documents — typically locale
 * variants of one document — reporting the links and blocks only one has.
 */
export function diffRichText(source: object, target: object, path: string): LexicalDiffResult {
  return diffLexicalDocs(sections(source, path), sections(target, path));
}
