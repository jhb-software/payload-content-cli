import { LexicalError } from "./errors.js";
import type { LexicalNode } from "./types.js";
import { assertValidTree } from "./validate.js";
import {
  blockIds,
  freshenBlockIds,
  hydrateFields,
  hydrateNode,
  isRichText,
  looksLikeNode,
  outlineLine,
  restoreOutlines,
  toNode,
  viewNode,
  viewValue,
  type RichTextValue,
} from "./view.js";

export type PathOperation = "read" | "set" | "insert" | "delete";

export interface PathEditResult<T> {
  /** What the agent sees: the read view of the path, or a summary of the change. */
  result: unknown;
  /** The changed copy of the document; absent for `read`. */
  doc?: T;
}

/** Where a path ended up. */
interface Target {
  value: unknown;
  /** The array or object holding the value; undefined for the document itself. */
  parent?: unknown[] | Record<string, unknown>;
  key?: string | number;
  /** The parent is a list of Lexical nodes (a tree's top level, or a node's `children`). */
  inNodeList: boolean;
  /** The innermost rich text the value sits in, if any. */
  richText?: RichTextValue;
}

const INDEX = /^\d+$/;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function kindOf(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "a list";
  return typeof value === "string" ? "a string" : typeof value;
}

/** Up to ten paths of rich-text fields below a value, to point a misdirected path somewhere useful. */
function richTextPathsBelow(value: unknown, path: string, found: string[] = []): string[] {
  if (found.length >= 10) return found;
  if (isRichText(value)) {
    found.push(path);
  } else if (Array.isArray(value)) {
    value.forEach((item, i) => richTextPathsBelow(item, `${path}.${i}`, found));
  } else if (isRecord(value)) {
    for (const [key, item] of Object.entries(value)) {
      richTextPathsBelow(item, path ? `${path}.${key}` : key, found);
    }
  }
  return found;
}

/**
 * MCP clients sometimes send an object argument as a JSON string. Where the path
 * holds an object, a string that parses as JSON is taken to be that object.
 */
function parseIfObject(value: unknown, stored: unknown): unknown {
  if (typeof value !== "string" || typeof stored !== "object" || stored === null) return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function resolve(doc: unknown, segments: string[], operation: PathOperation): Target {
  let target: Target = { value: doc, inNodeList: false };

  segments.forEach((segment, i) => {
    const here = segments.slice(0, i).join(".");
    const isLast = i === segments.length - 1;
    let { value } = target;
    let inNodeList = false;
    let richText = target.richText;

    // A number right after a rich-text value indexes its top-level nodes.
    if (isRichText(value) && INDEX.test(segment)) {
      richText = value;
      value = value.root.children;
      inNodeList = true;
    } else if (Array.isArray(value)) {
      // A node's `children` is a node list too; a block's own field named `children` is not.
      inNodeList = target.key === "children" && looksLikeNode(target.parent);
    }

    if (Array.isArray(value)) {
      const noun = inNodeList ? "node" : "item";
      const range =
        value.length === 0
          ? `has no ${noun}s`
          : `has ${value.length} ${noun}${value.length === 1 ? "" : "s"} (0–${value.length - 1})`;
      const index = INDEX.test(segment) ? Number(segment) : -1;
      const appending = isLast && operation === "insert" && inNodeList && index === value.length;
      if (index < 0 || (index >= value.length && !appending)) {
        throw new LexicalError("PATH_NOT_FOUND", `No "${segment}" at ${here}: it ${range}.`);
      }
      target = { value: value[index], parent: value, key: index, inNodeList, richText };
    } else if (isRecord(value)) {
      if (!(segment in value)) {
        const keys = Object.keys(value).join(", ") || "none";
        const where = here || "the document";
        throw new LexicalError("PATH_NOT_FOUND", `No "${segment}" in ${where}. It has: ${keys}.`);
      }
      target = {
        value: value[segment],
        parent: value,
        key: segment,
        inNodeList: false,
        richText: isRichText(value) ? value : richText,
      };
    } else {
      throw new LexicalError(
        "PATH_NOT_FOUND",
        `No "${segment}" at ${here}: it is ${kindOf(value)}.`,
      );
    }
  });

  return target;
}

function segmentsOf(path: string): string[] {
  const segments = path.split(".");
  if (segments.some((segment) => segment === "")) {
    throw new LexicalError("PATH_NOT_FOUND", `"${path}" is not a path, e.g. content or content.3.`);
  }
  return segments;
}

/** The stored value at a path, as is — no read view. */
export function valueAtPath(doc: unknown, path: string): unknown {
  return resolve(doc, segmentsOf(path), "read").value;
}

/** The rich-text value at a path; a path that reaches anything else names the rich text below it. */
export function richTextAt(doc: unknown, path: string): RichTextValue {
  const value = valueAtPath(doc, path);
  if (isRichText(value)) return value;
  const below = richTextPathsBelow(value, path);
  throw new LexicalError(
    "PATH_NOT_FOUND",
    `${path} is not a rich-text value.${below.length > 0 ? ` Rich text below it: ${below.join(", ")}.` : ""}`,
  );
}

function nodeListOf(target: Target, path: string, operation: PathOperation): LexicalNode[] {
  if (!target.inNodeList || !Array.isArray(target.parent)) {
    const hint = isRichText(target.value)
      ? ` Address a node position instead, e.g. ${path}.0.`
      : " Insert and delete work on node positions, e.g. content.3 or content.3.children.0; change values with set.";
    throw new LexicalError("UNSUPPORTED_AT_PATH", `Can't ${operation} at ${path}.${hint}`);
  }
  return target.parent as LexicalNode[];
}

/**
 * Read or change one thing inside a document's rich text, addressed by a single
 * dot path — the path a read shows. The document is never modified; a change
 * comes back as a changed copy for the caller to save.
 *
 * A path starts at a rich-text field (`content`, `sections.0.body`). A number
 * after a rich-text value indexes its top-level nodes (`content.3`); from there
 * the path follows the node's own JSON (`content.3.children.1.fields.doc`),
 * including into rich text nested in a block (`content.3.fields.body.0`).
 *
 * - `read`: a rich-text value reads as an outline, one line per node; a node as
 *   its JSON without Lexical's default properties, nested rich text outlined;
 *   anything else as it is.
 * - `set`: replace the value at the path. A node may be given as read (defaults
 *   and unchanged outlines are restored), as a full node, or as shorthand
 *   (`{type: "h2", text}`). Returns what a read of the path now shows.
 * - `insert`: add a node before the index the path ends in; the node count
 *   appends. Returns the node, the new count and which indexes moved.
 * - `delete`: remove the node at the path. Returns its outline line and the new count.
 *
 * Throws `LexicalError`: `PATH_NOT_FOUND` names what the path could have said
 * instead, `UNSUPPORTED_AT_PATH` an operation that doesn't fit the target,
 * `INVALID_NODE`/`INVALID_TREE` a value Payload would reject.
 */
export function editAtPath<T extends object>(
  doc: T,
  path: string,
  operation: PathOperation,
  value?: unknown,
): PathEditResult<T> {
  const segments = segmentsOf(path);
  const copy = operation === "read" ? doc : structuredClone(doc);
  const target = resolve(copy, segments, operation);

  if (!target.richText && !isRichText(target.value)) {
    const below = richTextPathsBelow(target.value, path);
    throw new LexicalError(
      "PATH_NOT_FOUND",
      `${path} is not inside a rich-text field. ${
        below.length > 0
          ? `Rich-text fields below it: ${below.join(", ")}.`
          : "Start the path at a rich-text field."
      }`,
    );
  }

  if (operation === "read") return { result: viewValue(target.value) };

  if (operation === "set") {
    if (isRichText(target.value)) {
      throw new LexicalError(
        "UNSUPPORTED_AT_PATH",
        `${path} is a whole rich-text field. Set one node at ${path}.<index>, or insert and delete nodes there.`,
      );
    }
    const parent = target.parent as Record<string | number, unknown>;
    const restored = restoreOutlines(parseIfObject(value, target.value), target.value, path);
    if (target.inNodeList) {
      const node = toNode(restored);
      const replaced = blockIds(target.value);
      const taken = new Set([...blockIds(copy)].filter((id) => !replaced.has(id)));
      freshenBlockIds(node, taken);
      parent[target.key!] = node;
    } else {
      parent[target.key!] = hydrateFields(restored);
    }
    assertValidTree(target.richText!.root.children);
    return { result: viewValue(parent[target.key!]), doc: copy };
  }

  const nodes = nodeListOf(target, path, operation);
  const index = target.key as number;

  if (operation === "insert") {
    const node = hydrateNode(toNode(restoreOutlines(parseIfObject(value, {}), undefined, path)));
    freshenBlockIds(node, blockIds(copy));
    nodes.splice(index, 0, node);
    assertValidTree(target.richText!.root.children);
    const note =
      index === nodes.length - 1
        ? `Appended as ${path}.`
        : `Nodes from ${path} on moved down by one.`;
    return { result: { node: viewNode(node), count: nodes.length, note }, doc: copy };
  }

  const [removed] = nodes.splice(index, 1);
  const shifted = index < nodes.length;
  return {
    result: {
      deleted: outlineLine(removed, index),
      count: nodes.length,
      ...(shifted ? { note: `Nodes after ${path} moved up by one.` } : {}),
    },
    doc: copy,
  };
}
