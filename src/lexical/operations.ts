import type { LexicalNode } from "./types.js";
import { hasChildren, isBlockNode, isLinkNode, isTextNode } from "./types.js";
import { parseAddress, resolveNode, resolveParentAndIndex } from "./address.js";
import { LexicalError } from "./errors.js";

export interface ListEntry {
  address: string;
  type: string;
  preview: string;
  /** Heading level, for `heading` nodes. */
  tag?: string;
  /** List variant, for `list` nodes. */
  listType?: string;
  /** Number of items, for `list` nodes. */
  itemCount?: number;
  /** Block slug, for `block` and `inlineBlock` nodes. */
  blockType?: string;
}

export interface ListOptions {
  /** How many levels to descend. `1` lists only top-level nodes. Default: unlimited. */
  depth?: number;
}

/**
 * The one identifying property of a node, beside its type — what a caller needs
 * to tell two headings or two blocks apart without parsing the text preview.
 */
function identifyingProps(node: LexicalNode): Partial<ListEntry> {
  if (node.type === "heading" && typeof node.tag === "string") {
    return { tag: node.tag };
  }
  if (node.type === "list") {
    return {
      ...(typeof node.listType === "string" ? { listType: node.listType } : {}),
      itemCount: hasChildren(node) ? node.children.length : 0,
    };
  }
  const fields = node.fields as Record<string, unknown> | undefined;
  if ((isBlockNode(node) || node.type === "inlineBlock") && typeof fields?.blockType === "string") {
    return { blockType: fields.blockType };
  }
  return {};
}

/**
 * The text a node reads as, including text nested inside inline wrappers such as
 * links — a preview that dropped those would silently misquote the paragraph.
 * Blocks carry no inline text, so they contribute nothing.
 */
function collectText(children: LexicalNode[]): string {
  let text = "";
  for (const child of children) {
    if (typeof child.text === "string") {
      text += child.text;
    } else if (!isBlockNode(child) && child.type !== "inlineBlock" && hasChildren(child)) {
      text += collectText(child.children);
    }
  }
  return text;
}

function textPreview(node: LexicalNode): string {
  if (typeof node.text === "string") {
    const preview = node.text.length > 60 ? node.text.slice(0, 57) + "..." : node.text;
    return `"${preview}"`;
  }
  if (
    isBlockNode(node) &&
    node.fields &&
    typeof (node.fields as Record<string, unknown>).blockType === "string"
  ) {
    return `(${(node.fields as Record<string, unknown>).blockType})`;
  }
  if (hasChildren(node)) {
    const joined = collectText(node.children);
    if (joined.length > 0) {
      const preview = joined.length > 60 ? joined.slice(0, 57) + "..." : joined;
      return `"${preview}"`;
    }
  }
  return "";
}

function collectNodes(
  children: LexicalNode[],
  prefix: string,
  entries: ListEntry[],
  remainingDepth: number,
): void {
  for (let i = 0; i < children.length; i++) {
    const addr = prefix ? `${prefix}.${i}` : `${i}`;
    const node = children[i];
    entries.push({
      address: addr,
      type: node.type ?? "unknown",
      preview: textPreview(node),
      ...identifyingProps(node),
    });
    if (hasChildren(node) && remainingDepth > 1) {
      collectNodes(node.children, addr, entries, remainingDepth - 1);
    }
  }
}

/**
 * Flatten a tree into one entry per node, each carrying the address the edit
 * operations take. This is the map an agent reads before deciding what to
 * change — `depth: 1` keeps it to the top-level nodes.
 */
export function listNodes(children: LexicalNode[], options: ListOptions = {}): ListEntry[] {
  const entries: ListEntry[] = [];
  collectNodes(children, "", entries, options.depth ?? Number.POSITIVE_INFINITY);
  return entries;
}

export function getNode(children: LexicalNode[], addressStr: string): LexicalNode {
  const addr = parseAddress(addressStr);
  return resolveNode(children, addr);
}

/**
 * Insert a node relative to an address. The empty address `""` targets the tree
 * itself, so `""` + `start`/`end` prepends/appends at the top level — the one
 * insertion that has no existing node to anchor to, and the only way to add to
 * an empty field.
 */
export function addNode(
  children: LexicalNode[],
  addressStr: string,
  position: "before" | "after" | "start" | "end",
  node: LexicalNode,
): LexicalNode[] {
  const result = structuredClone(children);

  if (addressStr.trim() === "") {
    if (position === "start") return [node, ...result];
    if (position === "end") return [...result, node];
    throw new LexicalError(
      "INVALID_ADDRESS",
      `The root address "" has no siblings — use "start" or "end", not "${position}"`,
    );
  }

  const addr = parseAddress(addressStr);

  if (position === "start") {
    const target = resolveNode(result, addr);
    if (!Array.isArray((target as Record<string, unknown>).children)) {
      throw new LexicalError(
        "NOT_A_CONTAINER",
        `Node at "${addressStr}" has no children — cannot insert at start`,
      );
    }
    (target as Record<string, unknown[]>).children.unshift(node);
    return result;
  }

  if (position === "end") {
    const target = resolveNode(result, addr);
    if (!Array.isArray((target as Record<string, unknown>).children)) {
      throw new LexicalError(
        "NOT_A_CONTAINER",
        `Node at "${addressStr}" has no children — cannot insert at end`,
      );
    }
    (target as Record<string, unknown[]>).children.push(node);
    return result;
  }

  const { parent, index } = resolveParentAndIndex(result, addr);
  if (index < 0 || index >= parent.length) {
    throw new LexicalError(
      "ADDRESS_OUT_OF_BOUNDS",
      `Address "${addressStr}" is out of bounds (length ${parent.length})`,
    );
  }

  if (position === "before") {
    parent.splice(index, 0, node);
  } else {
    parent.splice(index + 1, 0, node);
  }

  return result;
}

export function replaceNode(
  children: LexicalNode[],
  addressStr: string,
  node: LexicalNode,
): LexicalNode[] {
  const result = structuredClone(children);
  const addr = parseAddress(addressStr);
  const { parent, index } = resolveParentAndIndex(result, addr);

  if (index < 0 || index >= parent.length) {
    throw new LexicalError(
      "ADDRESS_OUT_OF_BOUNDS",
      `Address "${addressStr}" is out of bounds (length ${parent.length})`,
    );
  }

  parent[index] = node;
  return result;
}

export function removeNode(children: LexicalNode[], addressStr: string): LexicalNode[] {
  const result = structuredClone(children);
  const addr = parseAddress(addressStr);
  const { parent, index } = resolveParentAndIndex(result, addr);

  if (index < 0 || index >= parent.length) {
    throw new LexicalError(
      "ADDRESS_OUT_OF_BOUNDS",
      `Address "${addressStr}" is out of bounds (length ${parent.length})`,
    );
  }

  parent.splice(index, 1);
  return result;
}

/**
 * Find a text substring within a text node and wrap it in a link node.
 * Splits the text node into [before?, link, after?] siblings within the parent.
 *
 * @param addressStr - Address of the text node (or parent to search recursively)
 * @param search - Text to find and wrap
 * @param linkNode - The link node to wrap the text with (must have children with text)
 */
export function linkText(
  children: LexicalNode[],
  search: string,
  linkNode: LexicalNode,
): LexicalNode[] {
  const result = structuredClone(children);

  function findAndLink(nodes: LexicalNode[]): boolean {
    for (let i = 0; i < nodes.length; i++) {
      const node = nodes[i];

      // Skip existing link/autolink nodes
      if (isLinkNode(node)) continue;

      // Check text nodes for the search string
      if (isTextNode(node) && typeof node.text === "string") {
        const idx = node.text.indexOf(search);
        if (idx === -1) continue;

        const before = node.text.slice(0, idx);
        const after = node.text.slice(idx + search.length);

        const newNodes: LexicalNode[] = [];
        if (before) {
          newNodes.push({ ...node, text: before });
        }
        newNodes.push(structuredClone(linkNode));
        if (after) {
          newNodes.push({ ...node, text: after });
        }

        nodes.splice(i, 1, ...newNodes);
        return true;
      }

      // Recurse into element nodes
      if (hasChildren(node)) {
        if (findAndLink(node.children)) return true;
      }
    }
    return false;
  }

  if (!findAndLink(result)) {
    throw new LexicalError("TEXT_NOT_FOUND", `Text "${search}" not found in the document`);
  }

  return result;
}

export interface SearchMatch {
  address: string;
  context: string;
}

export function searchText(children: LexicalNode[], search: string): SearchMatch[] {
  const matches: SearchMatch[] = [];

  function walk(nodes: LexicalNode[], prefix: string): void {
    for (let i = 0; i < nodes.length; i++) {
      const addr = prefix ? `${prefix}.${i}` : `${i}`;
      const node = nodes[i];

      // Skip existing link/autolink nodes
      if (isLinkNode(node)) continue;

      if (isTextNode(node) && typeof node.text === "string") {
        if (node.text.includes(search)) {
          const text = node.text;
          const idx = text.indexOf(search);
          const start = Math.max(0, idx - 30);
          const end = Math.min(text.length, idx + search.length + 30);
          const snippet =
            (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : "");
          matches.push({ address: addr, context: snippet });
        }
      }

      if (hasChildren(node)) {
        walk(node.children, addr);
      }
    }
  }

  walk(children, "");
  return matches;
}

export function setNodeProp(
  children: LexicalNode[],
  addressStr: string,
  key: string,
  value: unknown,
  options: { create?: boolean } = {},
): LexicalNode[] {
  const result = structuredClone(children);
  const addr = parseAddress(addressStr);
  const node = resolveNode(result, addr);

  // Support dot-notation and bracket paths: "fields.buttons[0].relationship"
  const segments = key.replace(/\[(\d+)\]/g, ".$1").split(".");
  let target: Record<string, unknown> = node as Record<string, unknown>;
  for (let i = 0; i < segments.length - 1; i++) {
    const seg = segments[i];
    if (target[seg] === undefined || target[seg] === null || typeof target[seg] !== "object") {
      throw new LexicalError(
        "INVALID_NODE",
        `Property path "${key}" — segment "${seg}" is not an object`,
      );
    }
    target = target[seg] as Record<string, unknown>;
  }
  const leaf = segments[segments.length - 1];
  if (!(leaf in target) && !options.create) {
    const available = Object.keys(target).join(", ") || "(none)";
    throw new LexicalError(
      "INVALID_NODE",
      `Property "${key}" does not exist on node at "${addressStr}" (type: ${(node as { type?: string }).type ?? "unknown"}). Existing props: ${available}. Use --create to add a new property.`,
    );
  }
  target[leaf] = value;

  return result;
}

export interface ExtractedLink {
  address: string;
  text: string;
  relationTo: string;
  /** Target document ID; populated relationship objects are normalized to their id. */
  value: string;
}

/** Normalize a relationship value: depth>0 pulls populate it into a full document object. */
function relationshipId(value: unknown): string {
  if (typeof value === "object" && value !== null) {
    return String((value as { id?: unknown }).id ?? "");
  }
  return String(value ?? "");
}

/** Extract all internal link nodes from a Lexical tree. */
export function extractLinks(children: LexicalNode[]): ExtractedLink[] {
  const links: ExtractedLink[] = [];

  function walk(nodes: LexicalNode[], prefix: string): void {
    for (let i = 0; i < nodes.length; i++) {
      const addr = prefix ? `${prefix}.${i}` : `${i}`;
      const node = nodes[i];

      if (isLinkNode(node)) {
        const fields = node.fields as Record<string, unknown> | undefined;
        if (fields?.linkType === "internal" && fields.doc) {
          const doc = fields.doc as Record<string, unknown>;
          const text = textContent(node);
          links.push({
            address: addr,
            text,
            relationTo: String(doc.relationTo ?? ""),
            value: relationshipId(doc.value),
          });
        }
      }

      if (hasChildren(node)) {
        walk(node.children, addr);
      }
    }
  }

  walk(children, "");
  return links;
}

/** Extract text content from a node and its children. */
function textContent(node: LexicalNode): string {
  if (typeof node.text === "string") return node.text;
  if (hasChildren(node)) {
    return node.children.map(textContent).join("");
  }
  return "";
}

export interface ExtractedBlock {
  address: string;
  blockType: string;
  context: string;
}

/** Extract all block nodes from a Lexical tree (recursively) with surrounding context. */
export function extractBlocks(children: LexicalNode[]): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];

  function walk(nodes: LexicalNode[], prefix: string): void {
    for (let i = 0; i < nodes.length; i++) {
      const addr = prefix ? `${prefix}.${i}` : `${i}`;
      const node = nodes[i];

      if (isBlockNode(node)) {
        const fields = node.fields as Record<string, unknown> | undefined;
        const blockType = (fields?.blockType as string) ?? "unknown";

        // Find preceding heading or paragraph sibling for context
        let context = "";
        for (let j = i - 1; j >= 0 && j >= i - 3; j--) {
          const prev = nodes[j];
          if (prev.type === "heading" || prev.type === "paragraph") {
            const text = textContent(prev);
            if (text) {
              const label = prev.type === "heading" ? "after heading" : "after";
              context = `${label} "${text.length > 50 ? text.slice(0, 47) + "..." : text}"`;
              break;
            }
          }
        }

        blocks.push({ address: addr, blockType, context });
      }

      if (hasChildren(node)) {
        walk(node.children, addr);
      }
    }
  }

  walk(children, "");
  return blocks;
}
