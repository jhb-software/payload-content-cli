/**
 * Reading a richtext field on a document.
 *
 * The counterpart to `editRichText`: same level of abstraction (a document and
 * a field path, never a bare tree), so a caller never has to know that a
 * richtext value is `{ root: { children } }` or how a field path resolves.
 *
 * Everything here returns copies. The tree lives inside the document, and
 * handing out live references would let a caller change content by mutating a
 * "read" result — skipping validation and the single write path.
 */

import { diffLexicalDocs } from "./diff.js";
import type { LexicalDiffResult } from "./diff.js";
import { resolveFieldPath } from "./field-path.js";
import { extractBlocks, extractLinks, getNode, listNodes, searchText } from "./operations.js";
import type { ExtractedBlock, ExtractedLink, ListEntry, SearchMatch } from "./operations.js";
import type { LexicalNode } from "./types.js";

export interface ReadOptions {
  /** How many levels to descend. `1` lists only top-level nodes. Default: unlimited. */
  depth?: number;
}

/** The field's tree, detached from the document so callers can't edit through it. */
function children(doc: Record<string, unknown>, fieldPath: string): LexicalNode[] {
  return structuredClone(resolveFieldPath(doc, fieldPath));
}

/**
 * List a field's nodes, each with the address the edit operations take — the map
 * to read before deciding what to change. `depth: 1` keeps it to the top level.
 */
export function readRichText(
  doc: Record<string, unknown>,
  fieldPath: string,
  options: ReadOptions = {},
): ListEntry[] {
  return listNodes(children(doc, fieldPath), options);
}

/** One node, by address — to inspect it, or to copy it into another document. */
export function getRichTextNode(
  doc: Record<string, unknown>,
  fieldPath: string,
  address: string,
): LexicalNode {
  return getNode(children(doc, fieldPath), address);
}

/**
 * Find text that isn't already inside a link, with the address of each match.
 * Pair with an `{ op: "linkText" }` edit to turn one into a link.
 */
export function searchRichText(
  doc: Record<string, unknown>,
  fieldPath: string,
  search: string,
): SearchMatch[] {
  return searchText(children(doc, fieldPath), search);
}

/** Every internal link in the field, with its target document. */
export function extractRichTextLinks(
  doc: Record<string, unknown>,
  fieldPath: string,
): ExtractedLink[] {
  return extractLinks(children(doc, fieldPath));
}

/** Every block node in the field, with its slug and field values. */
export function extractRichTextBlocks(
  doc: Record<string, unknown>,
  fieldPath: string,
): ExtractedBlock[] {
  return extractBlocks(children(doc, fieldPath));
}

/**
 * Compare the same field across two documents — typically locale variants of one
 * document — reporting the links and blocks present in one but not the other.
 */
export function diffRichText(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  fieldPath: string,
): LexicalDiffResult {
  return diffLexicalDocs(children(source, fieldPath), children(target, fieldPath));
}
