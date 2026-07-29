import type { LexicalNode } from "./types.js";
import { hasChildren, isTextNode } from "./types.js";
import { LexicalError } from "./errors.js";

function walkTree(children: LexicalNode[], prefix: string, warnings: string[]): void {
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

    if (isTextNode(node)) {
      if (typeof node.text !== "string") {
        warnings.push(`[${addr}] Text node missing "text" field`);
      }
    }

    if (hasChildren(node)) {
      walkTree(node.children, addr, warnings);
    }
  }
}

export function validateTree(children: LexicalNode[]): string[] {
  const warnings: string[] = [];
  walkTree(children, "", warnings);
  return warnings;
}

/** Throws when the tree has validation errors; used to block writes of invalid documents. */
export function assertValidTree(children: LexicalNode[]): void {
  const errors = validateTree(children);
  if (errors.length > 0) {
    throw new LexicalError(
      "INVALID_TREE",
      `Validation failed — document not written:\n${errors.map((e) => `  ${e}`).join("\n")}`,
    );
  }
}
