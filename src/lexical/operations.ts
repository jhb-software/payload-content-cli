import type { LexicalNode } from "./types.js";
import { hasChildren, isBlockNode, isLinkNode, isTextNode } from "./types.js";

/**
 * Wrap the first unlinked occurrence of `search` in a copy of `linkNode`,
 * splitting its text node into [before?, link, after?]. Changes `nodes` in
 * place; answers the path of the new link (`base` is the path of `nodes`), or
 * undefined when the text isn't there.
 */
export function linkFirstMatch(
  nodes: LexicalNode[],
  base: string,
  search: string,
  linkNode: LexicalNode,
): string | undefined {
  for (let i = 0; i < nodes.length; i++) {
    const node = nodes[i];

    // Skip existing link/autolink nodes
    if (isLinkNode(node)) continue;

    if (isTextNode(node) && typeof node.text === "string") {
      const idx = node.text.indexOf(search);
      if (idx === -1) continue;

      const before = node.text.slice(0, idx);
      const after = node.text.slice(idx + search.length);

      const newNodes: LexicalNode[] = [];
      if (before) newNodes.push({ ...node, text: before });
      // The linked text keeps the format and style of the text it was cut from.
      newNodes.push({ ...structuredClone(linkNode), children: [{ ...node, text: search }] });
      if (after) newNodes.push({ ...node, text: after });

      nodes.splice(i, 1, ...newNodes);
      return `${base}.${before ? i + 1 : i}`;
    }

    if (hasChildren(node)) {
      const at = linkFirstMatch(node.children, `${base}.${i}.children`, search, linkNode);
      if (at) return at;
    }
  }
  return undefined;
}

export interface SearchMatch {
  /** Dot path of the text node holding the match. */
  path: string;
  context: string;
  /** The match is the text of a link. */
  linked?: true;
}

/** Text containing `search`, below the nodes at `base` (the path of their rich text). */
export function searchText(children: LexicalNode[], base: string, search: string): SearchMatch[] {
  const matches: SearchMatch[] = [];

  function walk(nodes: LexicalNode[], prefix: string, linked: boolean): void {
    for (let i = 0; i < nodes.length; i++) {
      const path = `${prefix}.${i}`;
      const node = nodes[i];

      if (isTextNode(node) && typeof node.text === "string") {
        if (node.text.includes(search)) {
          const text = node.text;
          const idx = text.indexOf(search);
          const start = Math.max(0, idx - 30);
          const end = Math.min(text.length, idx + search.length + 30);
          const snippet =
            (start > 0 ? "..." : "") + text.slice(start, end) + (end < text.length ? "..." : "");
          matches.push({ path, context: snippet, ...(linked ? { linked: true as const } : {}) });
        }
      }

      if (hasChildren(node)) {
        walk(node.children, `${path}.children`, linked || isLinkNode(node));
      }
    }
  }

  walk(children, base, false);
  return matches;
}

export interface ExtractedLink {
  /** Dot path of the link node. */
  path: string;
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
export function extractLinks(children: LexicalNode[], base: string): ExtractedLink[] {
  const links: ExtractedLink[] = [];

  function walk(nodes: LexicalNode[], prefix: string): void {
    for (let i = 0; i < nodes.length; i++) {
      const path = `${prefix}.${i}`;
      const node = nodes[i];

      if (isLinkNode(node)) {
        const fields = node.fields as Record<string, unknown> | undefined;
        if (fields?.linkType === "internal" && fields.doc) {
          const doc = fields.doc as Record<string, unknown>;
          const text = textContent(node);
          links.push({
            path,
            text,
            relationTo: String(doc.relationTo ?? ""),
            value: relationshipId(doc.value),
          });
        }
      }

      if (hasChildren(node)) {
        walk(node.children, `${path}.children`);
      }
    }
  }

  walk(children, base);
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
  /** Dot path of the block node. */
  path: string;
  blockType: string;
  context: string;
}

/** Extract all block nodes from a Lexical tree (recursively) with surrounding context. */
export function extractBlocks(children: LexicalNode[], base: string): ExtractedBlock[] {
  const blocks: ExtractedBlock[] = [];

  function walk(nodes: LexicalNode[], prefix: string): void {
    for (let i = 0; i < nodes.length; i++) {
      const path = `${prefix}.${i}`;
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

        blocks.push({ path, blockType, context });
      }

      if (hasChildren(node)) {
        walk(node.children, `${path}.children`);
      }
    }
  }

  walk(children, base);
  return blocks;
}
