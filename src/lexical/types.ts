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

/** A link or autolink, internal (to a document) or custom (to a URL). */
export interface LexicalLinkNode extends LexicalElementNode {
  type: "link" | "autolink";
  fields: {
    linkType?: "internal" | "custom";
    url?: string;
    newTab?: boolean;
    /** The linked document: its id, or the document itself when read with depth. */
    doc?: {
      relationTo: string;
      value: string | number | { id: string | number; [key: string]: unknown };
    } | null;
    [key: string]: unknown;
  };
}

/** What a rich-text field stores. */
export interface RichTextValue {
  root: LexicalRoot;
}

// ── Node predicates ─────────────────────────────────────────────────

export function isTextNode(node: LexicalNode): node is LexicalTextNode {
  return node.type === "text";
}

/** True for both manually created "link" nodes and auto-detected "autolink" nodes. */
export function isLinkNode(node: LexicalNode): node is LexicalLinkNode {
  return node.type === "link" || node.type === "autolink";
}

export function isBlockNode(node: LexicalNode): boolean {
  return node.type === "block";
}

export function hasChildren(node: LexicalNode): node is LexicalElementNode {
  return Array.isArray((node as { children?: unknown }).children);
}
