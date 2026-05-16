import type { LexicalNode } from "./types.js";

export function validateTree(children: LexicalNode[], prefix: string = ""): string[] {
  const warnings: string[] = [];

  for (let i = 0; i < children.length; i++) {
    const addr = prefix ? `${prefix}.${i}` : `${i}`;
    const node = children[i];

    if (!node || typeof node !== "object") {
      warnings.push(`[${addr}] Node is not an object`);
      continue;
    }

    if (typeof node.type !== "string" || node.type === "") {
      warnings.push(`[${addr}] Node missing "type" field`);
    }

    if (node.version === undefined) {
      warnings.push(`[${addr}] Node missing "version" field`);
    }

    if (node.type === "text") {
      if (typeof node.text !== "string") {
        warnings.push(`[${addr}] Text node missing "text" field`);
      }
    }

    if (Array.isArray(node.children)) {
      validateTree(node.children as LexicalNode[], addr).forEach((w) => warnings.push(w));
    }
  }

  return warnings;
}
