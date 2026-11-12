/**
 * Several edits to one document, whose paths all refer to the document as read.
 *
 * Running the edits from the end of the document backwards keeps that true: an
 * edit only moves what comes after it, and that has already run. Edits that
 * can't both hold, because one reaches into what the other changes, are refused.
 */

import { LexicalError } from "./errors.js";
import { INDEX, valueAtPath } from "./path.js";
import { isTextNode, type LexicalNode } from "./types.js";

export interface BatchEdit {
  path: string;
  operation: "set" | "insert" | "delete" | "link";
}

/**
 * A path's segments in one form, as a lookup reads them: `content.03` and
 * `content.root.children.3` are both `content.3`.
 */
function normalizedSegments(path: string): string[] {
  const segments = path.split(".").map((s) => (INDEX.test(s) ? String(Number(s)) : s));
  return segments.filter(
    (s, i) =>
      !(s === "root" && segments[i + 1] === "children") &&
      !(s === "children" && segments[i - 1] === "root"),
  );
}

/** `inner` is `outer` or below it. */
function isWithin(inner: string[], outer: string[]): boolean {
  return outer.length <= inner.length && outer.every((segment, i) => segment === inner[i]);
}

/**
 * Later in the document first, deeper before what holds it. A number is the
 * only order that matters; names just need one, since other fields don't shift.
 */
function compareBackwards(a: string[], b: string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    if (a[i] === b[i]) continue;
    const [aIndex, bIndex] = [INDEX.test(a[i]), INDEX.test(b[i])];
    if (aIndex && bIndex) return Number(b[i]) - Number(a[i]);
    if (aIndex !== bIndex) return aIndex ? -1 : 1;
    return a[i] < b[i] ? -1 : 1;
  }
  return b.length - a.length;
}

function isTextNodeAt(doc: object, path: string): boolean {
  try {
    return isTextNode(valueAtPath(doc, path) as LexicalNode);
  } catch {
    return false; // Applying the edit reports the path.
  }
}

/** Why two edits can't run together, if so. `first` and `second` are 1-based for the message. */
function conflict(doc: object, a: BatchEdit, b: BatchEdit, first: number, second: number) {
  const edits = `Edits ${first} and ${second}`;
  const [aPath, bPath] = [normalizedSegments(a.path), normalizedSegments(b.path)];
  const [aInsert, bInsert] = [a.operation === "insert", b.operation === "insert"];
  const samePath = aPath.join(".") === bPath.join(".");

  if (aInsert && bInsert) {
    return samePath
      ? `${edits} both insert at ${a.path}. Send one insert with a list of nodes.`
      : undefined;
  }
  const bothLinks = a.operation === "link" && b.operation === "link";
  if (bothLinks && samePath) {
    if (!isTextNodeAt(doc, a.path)) return undefined;
    const holder = a.path.replace(/\.children\.\d+$/, "");
    return `${edits} link in the text node ${a.path}, which the first link splits. Use the path of the node holding it for both: ${holder}.`;
  }

  // An insert goes between nodes, so only what holds that list reaches it.
  const overlaps =
    aInsert || bInsert
      ? aInsert
        ? isWithin(aPath.slice(0, -1), bPath)
        : isWithin(bPath.slice(0, -1), aPath)
      : isWithin(aPath, bPath) || isWithin(bPath, aPath);
  if (!overlaps) return undefined;

  // Of two links, the wider search is the one the other gets in the way of.
  const widerIsA = aPath.length <= bPath.length;
  const link = bothLinks
    ? widerIsA
      ? a
      : b
    : a.operation === "link"
      ? a
      : b.operation === "link"
        ? b
        : undefined;
  if (link) {
    const other = link === a ? b : a;
    return `${edits} overlap: the link searches all of ${link.path}, where ${other.operation} at ${other.path} changes what it finds. Narrow the link to a node the other edit doesn't touch, or send them in separate calls.`;
  }
  return `${edits} overlap: ${a.operation} at ${a.path} and ${b.operation} at ${b.path} change the same node. Combine them into one edit.`;
}

/**
 * The order to run edits in, as indexes into `edits`, so that each path means
 * what it meant in `doc`. Links in one place run in the order sent, so repeated
 * text is linked in that order.
 *
 * Throws `LexicalError` (`UNSUPPORTED_AT_PATH`) for edits that can't run together.
 */
export function orderEdits(doc: object, edits: BatchEdit[]): number[] {
  for (let i = 0; i < edits.length; i++) {
    for (let j = i + 1; j < edits.length; j++) {
      const problem = conflict(doc, edits[i], edits[j], i + 1, j + 1);
      if (problem) throw new LexicalError("UNSUPPORTED_AT_PATH", problem);
    }
  }

  const rank = (edit: BatchEdit) => (edit.operation === "insert" ? 1 : 0);
  return edits
    .map((edit, index) => ({ edit, index, segments: normalizedSegments(edit.path) }))
    .sort(
      (a, b) =>
        compareBackwards(a.segments, b.segments) ||
        // At one index, the insert goes before the node already there: it runs last.
        rank(a.edit) - rank(b.edit) ||
        a.index - b.index,
    )
    .map(({ index }) => index);
}
