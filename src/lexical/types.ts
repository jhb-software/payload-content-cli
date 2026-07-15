export type Address = number[];

export interface LexicalNode {
  type: string;
  version?: number;
  [key: string]: unknown;
}

export interface LexicalElementNode extends LexicalNode {
  children: LexicalNode[];
  direction?: string | null;
  format?: string | number;
  indent?: number;
}

export interface LexicalTextNode extends LexicalNode {
  type: "text";
  text: string;
  format?: number;
  detail?: number;
  mode?: string;
  style?: string;
}

export interface LexicalRoot {
  type: "root";
  children: LexicalNode[];
  direction?: string | null;
  format?: string | number;
  indent?: number;
  version?: number;
}

// ── Node predicates ─────────────────────────────────────────────────

export function isTextNode(node: LexicalNode): node is LexicalTextNode {
  return node.type === "text";
}

/** True for both manually created "link" nodes and auto-detected "autolink" nodes. */
export function isLinkNode(node: LexicalNode): boolean {
  return node.type === "link" || node.type === "autolink";
}

export function isBlockNode(node: LexicalNode): boolean {
  return node.type === "block";
}

export function hasChildren(node: LexicalNode): node is LexicalElementNode {
  return Array.isArray((node as { children?: unknown }).children);
}
