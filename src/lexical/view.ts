import { randomBytes } from "node:crypto";
import { LexicalError } from "./errors.js";
import { buildHeading, buildHorizontalRule, buildList } from "./nodes.js";
import type { LexicalNode } from "./types.js";
import { hasChildren, isLinkNode } from "./types.js";
import { assertValidTree } from "./validate.js";

/**
 * The compact views `editAtPath` shows an agent, and their inverse.
 *
 * A Lexical tree is mostly boilerplate: every text node carries `detail`,
 * `format`, `mode` and `style`, every element `direction`, `format` and
 * `indent`, almost always at their defaults. Showing them costs tokens and
 * buys nothing, so reads strip them and writes put them back. Rich text nested
 * inside a block is shown as an outline, one line per node, and restored from
 * the stored value on write when it comes back unchanged.
 */

export interface RichTextValue {
  root: { children: LexicalNode[]; [key: string]: unknown };
  [key: string]: unknown;
}

export function isRichText(value: unknown): value is RichTextValue {
  if (typeof value !== "object" || value === null) return false;
  const root = (value as { root?: unknown }).root;
  return (
    typeof root === "object" &&
    root !== null &&
    Array.isArray((root as { children?: unknown }).children)
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

// ── Outline ─────────────────────────────────────────────────────────

const PREVIEW_LENGTH = 80;

function truncate(text: string): string {
  const flat = text.replace(/\s+/g, " ").trim();
  return flat.length > PREVIEW_LENGTH ? `${flat.slice(0, PREVIEW_LENGTH - 1)}…` : flat;
}

/** Every rich-text value inside a block's fields, in field order. */
function nestedRichTexts(value: unknown, found: RichTextValue[] = []): RichTextValue[] {
  if (isRichText(value)) {
    found.push(value);
  } else if (Array.isArray(value)) {
    for (const item of value) nestedRichTexts(item, found);
  } else if (isRecord(value)) {
    for (const item of Object.values(value)) nestedRichTexts(item, found);
  }
  return found;
}

function nodeText(node: LexicalNode): string {
  if (typeof node.text === "string") return node.text;
  if (node.type === "linebreak") return " ";
  if (node.type === "list" && hasChildren(node)) {
    return node.children.map(nodeText).join("; ");
  }
  if (hasChildren(node)) return node.children.map(nodeText).join("");
  if (node.fields !== undefined) {
    return nestedRichTexts(node.fields)
      .map((value) => value.root.children.map(nodeText).join(" "))
      .join(" ");
  }
  return "";
}

function countLinks(node: LexicalNode): number {
  let count = isLinkNode(node) ? 1 : 0;
  if (hasChildren(node)) {
    for (const child of node.children) count += countLinks(child);
  }
  if (node.fields !== undefined) {
    for (const value of nestedRichTexts(node.fields)) {
      for (const child of value.root.children) count += countLinks(child);
    }
  }
  return count;
}

function label(node: LexicalNode): string {
  const fields = isRecord(node.fields) ? node.fields : {};
  switch (node.type) {
    case "paragraph":
      return "p";
    case "heading":
      return typeof node.tag === "string" ? node.tag : "heading";
    case "horizontalrule":
      return "hr";
    case "list": {
      const items = hasChildren(node) ? node.children.length : 0;
      const tag = typeof node.tag === "string" ? node.tag : String(node.listType ?? "list");
      return `${tag} (${items} ${items === 1 ? "item" : "items"})`;
    }
    case "block":
    case "inlineBlock":
      return `${node.type} ${String(fields.blockType ?? "?")}`;
    case "upload":
      return `upload ${String(node.relationTo ?? "?")} ${String(node.value ?? "?")}`;
    default:
      return node.type;
  }
}

/** A path one key further down; the empty path is the document itself. */
export function joinPath(path: string, key: string | number): string {
  return path === "" ? String(key) : `${path}.${key}`;
}

/**
 * One line per node: its path, kind, link count and a text preview — e.g.
 * `content.1 p [3 links]: More on …` — so the path can be used as it is.
 */
export function outlineLine(node: LexicalNode, path: string): string {
  const links = countLinks(node);
  const linkNote = links > 0 ? ` [${links} ${links === 1 ? "link" : "links"}]` : "";
  const text = truncate(nodeText(node));
  return `${path} ${label(node)}${linkNote}${text ? `: ${text}` : ""}`;
}

/** The outline of the rich text at `path`. */
export function outline(nodes: LexicalNode[], path: string): string[] {
  return nodes.map((node, i) => outlineLine(node, joinPath(path, i)));
}

// ── Stripping defaults ──────────────────────────────────────────────

/** Node properties Lexical writes on (almost) every node, with the values that mean "nothing set". */
const DEFAULTS: Record<string, unknown[]> = {
  detail: [0],
  direction: ["ltr", null],
  format: ["", 0],
  indent: [0],
  mode: ["normal"],
  style: [""],
  textFormat: [0],
  textStyle: [""],
};

/** A node as an agent reads it: no default properties, nested rich text as an outline. */
function viewNode(node: LexicalNode, path: string): LexicalNode {
  const view: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(node)) {
    if (DEFAULTS[key]?.includes(value)) continue;
    if (key === "children" && Array.isArray(value)) {
      const children = joinPath(path, "children");
      view.children = (value as LexicalNode[]).map((child, i) =>
        viewNode(child, joinPath(children, i)),
      );
    } else if (key === "fields") {
      view.fields = outlineRichText(value, joinPath(path, "fields"));
    } else {
      view[key] = value;
    }
  }
  return view as LexicalNode;
}

/** A value with every rich text inside it as an outline, everything else as is. */
export function outlineRichText(value: unknown, path: string): unknown {
  if (isRichText(value)) return outline(value.root.children, path);
  if (Array.isArray(value)) return value.map((item, i) => outlineRichText(item, joinPath(path, i)));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, outlineRichText(v, joinPath(path, k))]),
    );
  }
  return value;
}

/** Lexical nodes are the objects with a string `type` and a `version`. */
export function looksLikeNode(value: unknown): value is LexicalNode {
  return isRecord(value) && typeof value.type === "string" && value.version !== undefined;
}

/**
 * The value at `path`, as an agent reads it: rich text anywhere inside it as
 * an outline whose lines start with their paths, nodes without defaults.
 */
export function viewValue(value: unknown, path: string): unknown {
  if (isRichText(value)) return outline(value.root.children, path);
  if (looksLikeNode(value)) return viewNode(value, path);
  if (Array.isArray(value)) return value.map((item, i) => viewValue(item, joinPath(path, i)));
  if (isRecord(value)) {
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [k, viewValue(v, joinPath(path, k))]),
    );
  }
  return value;
}

// ── Writing back ────────────────────────────────────────────────────

/** A 24-hex-character id, the shape Payload gives block rows and upload nodes. */
function newId(): string {
  return randomBytes(12).toString("hex");
}

const ELEMENT_DEFAULTS = { direction: "ltr", format: "", indent: 0 };
const TEXT_DEFAULTS = { detail: 0, format: 0, mode: "normal", style: "" };

/** Put back the default properties a read stripped, and the ids Payload expects on new nodes. */
export function hydrateNode(input: LexicalNode): LexicalNode {
  const node: Record<string, unknown> = { ...input };
  if (node.type === "text") {
    Object.assign(node, { ...TEXT_DEFAULTS, ...node });
  } else if (Array.isArray(node.children)) {
    Object.assign(node, { ...ELEMENT_DEFAULTS, ...node });
    if (node.type === "paragraph") Object.assign(node, { textFormat: 0, textStyle: "", ...node });
    node.children = (node.children as LexicalNode[]).map(hydrateNode);
  }
  if (node.type === "block" || node.type === "upload") node.format ??= "";
  if (node.type === "link" || node.type === "upload") node.id ??= newId();
  if ((node.type === "block" || node.type === "inlineBlock") && isRecord(node.fields)) {
    node.fields = { id: newId(), ...node.fields };
  }
  if (node.fields !== undefined) node.fields = hydrateFields(node.fields);
  node.version ??=
    node.type === "block" ? 2 : node.type === "upload" || node.type === "link" ? 3 : 1;
  return node as LexicalNode;
}

const ROOT_DEFAULTS = { type: "root", direction: "ltr", format: "", indent: 0, version: 1 };

/** Rich text inside fields may be given as `{root: {children}}`, its nodes as read or as shorthand. */
export function hydrateFields(value: unknown): unknown {
  if (isRichText(value)) {
    return {
      ...value,
      root: { ...ROOT_DEFAULTS, ...value.root, children: value.root.children.map(toNode) },
    };
  }
  if (Array.isArray(value)) return value.map(hydrateFields);
  if (isRecord(value)) {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, hydrateFields(v)]));
  }
  return value;
}

/**
 * A whole rich-text value as an agent writes it: a list of nodes, or
 * `{root: {children}}`, with nodes as read or as shorthand. Anything else is
 * refused, since a draft write would store it unchecked.
 */
export function toRichText(value: unknown, path: string): unknown {
  if (value === null || value === undefined) return value;
  const children = isRichText(value)
    ? value.root.children
    : Array.isArray(value) && value.every(isRecord)
      ? value
      : undefined;
  if (!children) {
    throw new LexicalError(
      "INVALID_NODE",
      `${path} is rich text, which this value isn't. Pass its nodes as a list, e.g. [{"type":"p","text":"…"}], or as {"root":{"children":[…]}}.`,
    );
  }
  const root = isRichText(value) ? value.root : {};
  const richText = {
    ...(isRichText(value) ? value : {}),
    root: { ...ROOT_DEFAULTS, ...root, children: children.map(toNode) },
  };
  assertValidTree(richText.root.children);
  return richText;
}

/** An outline as a read shows it: lines `<path>.0 …`, `<path>.1 …`, in order. */
function isOutline(value: unknown): value is string[] {
  return (
    Array.isArray(value) &&
    value.length > 0 &&
    value.every((line, i) => typeof line === "string" && new RegExp(`^(\\S+\\.)?${i} `).test(line))
  );
}

function sameOutline(value: unknown[], richText: RichTextValue, path: string): boolean {
  const lines = outline(richText.root.children, path);
  return value.length === lines.length && value.every((line, i) => line === lines[i]);
}

/**
 * Swap outlines in a written value back for the rich text they stand for.
 * An unchanged outline restores the stored value; a changed one is refused,
 * because an outline is a summary, not something that can be turned back into
 * nodes.
 */
export function restoreOutlines(value: unknown, stored: unknown, path: string): unknown {
  if (isRichText(stored) && Array.isArray(value) && value.every((v) => typeof v === "string")) {
    if (sameOutline(value, stored, path)) return stored;
    throw new LexicalError(
      "INVALID_NODE",
      `${path} is rich text shown as an outline, which can't be edited as text. Pass it back unchanged and edit its nodes at ${path}.<index>.`,
    );
  }
  if (isOutline(value)) {
    throw new LexicalError(
      "INVALID_NODE",
      `${path} is rich text shown as an outline, and there is no stored rich text here to restore it from. Pass it as {"root":{"children":[…]}} with nodes as read or shorthand.`,
    );
  }
  if (Array.isArray(value)) {
    return value.map((item, i) =>
      restoreOutlines(item, Array.isArray(stored) ? stored[i] : undefined, joinPath(path, i)),
    );
  }
  if (isRecord(value)) {
    const storedRecord = isRecord(stored) ? stored : {};
    return Object.fromEntries(
      Object.entries(value).map(([k, v]) => [
        k,
        restoreOutlines(v, storedRecord[k], joinPath(path, k)),
      ]),
    );
  }
  return value;
}

// ── Block ids ───────────────────────────────────────────────────────

function isBlockNode(value: unknown): value is LexicalNode & { fields: Record<string, unknown> } {
  return (
    looksLikeNode(value) &&
    (value.type === "block" || value.type === "inlineBlock") &&
    isRecord(value.fields)
  );
}

function eachBlock(value: unknown, visit: (fields: Record<string, unknown>) => void): void {
  if (Array.isArray(value)) {
    for (const item of value) eachBlock(item, visit);
  } else if (isRecord(value)) {
    if (isBlockNode(value)) visit(value.fields);
    for (const item of Object.values(value)) eachBlock(item, visit);
  }
}

/** The ids of every block anywhere in a value, nested rich text included. */
export function blockIds(value: unknown): Set<string> {
  const ids = new Set<string>();
  eachBlock(value, (fields) => {
    if (typeof fields.id === "string") ids.add(fields.id);
  });
  return ids;
}

/** Give blocks whose id is already taken a new one, so a copied block doesn't share its source's id. */
export function freshenBlockIds(value: unknown, taken: Set<string>): void {
  eachBlock(value, (fields) => {
    if (typeof fields.id === "string" && taken.has(fields.id)) fields.id = newId();
    if (typeof fields.id === "string") taken.add(fields.id);
  });
}

// ── Shorthand ───────────────────────────────────────────────────────

const HEADINGS = ["h1", "h2", "h3", "h4", "h5", "h6"];

/**
 * Turn what an agent passes as a node into a Lexical node. Accepts a JSON
 * string or an object; besides full nodes, it takes shorthand: `{type: "p",
 * text}`, `{type: "h2", text}`, `{type: "ul" | "ol", items}`, `{type: "hr"}`,
 * `{type: "upload", value}`, and `text` in place of `children` on any element.
 */
export function toNode(input: unknown): LexicalNode {
  let value = input;
  if (typeof value === "string") {
    try {
      value = JSON.parse(value);
    } catch {
      throw new LexicalError("INVALID_NODE", "A node must be an object or a JSON object string.");
    }
  }
  if (!isRecord(value) || typeof value.type !== "string" || value.type === "") {
    throw new LexicalError(
      "INVALID_NODE",
      'A node needs a "type", e.g. {"type":"p","text":"…"} or a node as read.',
    );
  }
  const { type, text, items, ...rest } = value;

  if (HEADINGS.includes(type)) return { ...buildHeading(String(text ?? ""), type), ...rest };
  if (type === "ul" || type === "ol") {
    const list = Array.isArray(items) ? items.map(String) : [];
    return buildList(list, type === "ul" ? "bullet" : "number");
  }
  if (type === "hr") return buildHorizontalRule();
  if (type === "upload") {
    if (rest.value === undefined) {
      throw new LexicalError("INVALID_NODE", 'An upload node needs a "value": the media id.');
    }
    return hydrateNode({ type, relationTo: "media", fields: null, ...rest });
  }
  if (type === "block" && !(isRecord(rest.fields) && typeof rest.fields.blockType === "string")) {
    throw new LexicalError("INVALID_NODE", 'A block node needs "fields" with a "blockType".');
  }

  const node: Record<string, unknown> = { type: type === "p" ? "paragraph" : type, ...rest };
  if (type === "text") node.text = text;
  else if (typeof text === "string" && node.children === undefined) {
    node.children = [{ type: "text", text }];
  }
  return hydrateNode(node as LexicalNode);
}
