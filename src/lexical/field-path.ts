import type { LexicalNode, LexicalRoot } from "./types.js";

function isLexicalRoot(value: unknown): value is LexicalRoot {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as Record<string, unknown>).type === "root" &&
    Array.isArray((value as Record<string, unknown>).children)
  );
}

function getByPath(obj: Record<string, unknown>, path: string): unknown {
  const segments = path.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: unknown = obj;
  for (const seg of segments) {
    if (
      current === null ||
      current === undefined ||
      typeof current !== "object"
    ) {
      return undefined;
    }
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

/**
 * Find a block node by blockType within a lexical tree's children.
 */
function findBlockByType(
  children: LexicalNode[],
  blockType: string,
): LexicalNode | undefined {
  return children.find(
    (n) =>
      n.type === "block" &&
      (n as Record<string, unknown>).fields &&
      ((n as Record<string, unknown>).fields as Record<string, unknown>)
        .blockType === blockType,
  );
}

export function resolveFieldPath(
  doc: Record<string, unknown>,
  fieldPath: string,
): LexicalNode[] {
  // First try direct path resolution
  const value = getByPath(doc, fieldPath);
  if (value !== undefined && value !== null) {
    const maybeRoot = (value as Record<string, unknown>).root;
    if (isLexicalRoot(maybeRoot)) {
      return maybeRoot.children;
    }
    if (isLexicalRoot(value)) {
      return (value as LexicalRoot).children;
    }
  }

  // Try block-aware resolution: e.g. "content.TwoColumnRichText.firstColumn"
  // Split into segments and walk, looking for block types in lexical trees
  const segments = fieldPath.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: unknown = doc;

  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];

    if (
      current === null ||
      current === undefined ||
      typeof current !== "object"
    ) {
      throw new Error(`Field "${fieldPath}" not found in document`);
    }

    // Try direct property access first
    const direct = (current as Record<string, unknown>)[seg];
    if (direct !== undefined) {
      current = direct;
      continue;
    }

    // If current value is a lexical field, search for a block by blockType
    const currentObj = current as Record<string, unknown>;
    const root = currentObj.root;
    if (isLexicalRoot(root)) {
      const block = findBlockByType(root.children, seg);
      if (block) {
        // Navigate into the block's fields for remaining segments
        current =
          ((block as Record<string, unknown>).fields as Record<
            string,
            unknown
          >) ?? {};
        continue;
      }
    }

    throw new Error(
      `Field "${fieldPath}" — segment "${seg}" not found (checked both properties and block types)`,
    );
  }

  if (current === null || current === undefined) {
    throw new Error(`Field "${fieldPath}" resolved to null/undefined`);
  }

  const maybeRoot = (current as Record<string, unknown>).root;
  if (isLexicalRoot(maybeRoot)) {
    return maybeRoot.children;
  }
  if (isLexicalRoot(current)) {
    return (current as LexicalRoot).children;
  }

  throw new Error(
    `Field "${fieldPath}" does not contain a Lexical richtext structure (expected {root: {type: "root", children: [...]}})`,
  );
}

export function autoDetectLexicalField(doc: Record<string, unknown>): {
  path: string;
  children: LexicalNode[];
} {
  const candidates: { path: string; children: LexicalNode[] }[] = [];

  for (const [key, value] of Object.entries(doc)) {
    if (typeof value === "object" && value !== null) {
      const maybeRoot = (value as Record<string, unknown>).root;
      if (isLexicalRoot(maybeRoot)) {
        candidates.push({ path: key, children: maybeRoot.children });
      }
    }
  }

  if (candidates.length === 0) {
    throw new Error("No Lexical richtext fields found in document");
  }

  if (candidates.length > 1) {
    const names = candidates.map((c) => c.path).join(", ");
    throw new Error(
      `Multiple Lexical richtext fields found: ${names}. Use --field to specify which one.`,
    );
  }

  return candidates[0];
}

export function setByPath(
  obj: Record<string, unknown>,
  fieldPath: string,
  children: LexicalNode[],
): void {
  // Try direct path first
  let value = getByPath(obj, fieldPath);

  // If direct path fails, try block-aware resolution
  if (value === undefined || value === null) {
    const segments = fieldPath.replace(/\[(\d+)\]/g, ".$1").split(".");
    let current: unknown = obj;
    for (const seg of segments) {
      if (
        current === null ||
        current === undefined ||
        typeof current !== "object"
      )
        break;
      const direct = (current as Record<string, unknown>)[seg];
      if (direct !== undefined) {
        current = direct;
        continue;
      }
      const currentObj = current as Record<string, unknown>;
      const root = currentObj.root;
      if (isLexicalRoot(root)) {
        const block = findBlockByType(root.children, seg);
        if (block) {
          current =
            ((block as Record<string, unknown>).fields as Record<
              string,
              unknown
            >) ?? {};
          continue;
        }
      }
      current = undefined;
      break;
    }
    value = current;
  }

  if (value === undefined || value === null || typeof value !== "object") {
    throw new Error(`Field "${fieldPath}" not found in document`);
  }

  const maybeRoot = (value as Record<string, unknown>).root;
  if (isLexicalRoot(maybeRoot)) {
    maybeRoot.children = children;
    return;
  }

  if (isLexicalRoot(value)) {
    (value as LexicalRoot).children = children;
    return;
  }

  throw new Error(
    `Field "${fieldPath}" does not contain a Lexical richtext structure`,
  );
}
