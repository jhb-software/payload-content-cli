import type { LexicalNode, LexicalRoot } from "./types.js";
import { isBlockNode } from "./types.js";
import { LexicalError } from "./errors.js";

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
    if (current === null || current === undefined || typeof current !== "object") {
      return undefined;
    }
    current = (current as Record<string, unknown>)[seg];
  }
  return current;
}

/**
 * Find a block node by blockType within a lexical tree's children.
 */
function findBlockByType(children: LexicalNode[], blockType: string): LexicalNode | undefined {
  return children.find(
    (n) =>
      isBlockNode(n) &&
      (n as Record<string, unknown>).fields &&
      ((n as Record<string, unknown>).fields as Record<string, unknown>).blockType === blockType,
  );
}

/**
 * Resolve a field path to its value. Tries plain property/index access first,
 * then a block-aware walk where a segment may name a blockType inside a
 * lexical tree (e.g. "content.TwoColumnRichText.firstColumn").
 * Shared by both reads (resolveFieldPath) and writes (setByPath) so get and
 * set always agree on which container a path refers to.
 */
function resolvePathValue(doc: Record<string, unknown>, fieldPath: string): unknown {
  const direct = getByPath(doc, fieldPath);
  if (direct !== undefined && direct !== null) {
    return direct;
  }

  const segments = fieldPath.replace(/\[(\d+)\]/g, ".$1").split(".");
  let current: unknown = doc;

  for (const seg of segments) {
    if (current === null || current === undefined || typeof current !== "object") {
      throw new LexicalError("FIELD_NOT_FOUND", `Field "${fieldPath}" not found in document`);
    }

    // Try direct property access first
    const prop = (current as Record<string, unknown>)[seg];
    if (prop !== undefined) {
      current = prop;
      continue;
    }

    // If current value is a lexical field, search for a block by blockType
    const root = (current as Record<string, unknown>).root;
    if (isLexicalRoot(root)) {
      const block = findBlockByType(root.children, seg);
      if (block) {
        // Navigate into the block's fields for remaining segments
        current = ((block as Record<string, unknown>).fields as Record<string, unknown>) ?? {};
        continue;
      }
    }

    throw new LexicalError(
      "FIELD_NOT_FOUND",
      `Field "${fieldPath}" — segment "${seg}" not found (checked both properties and block types)`,
    );
  }

  if (current === null || current === undefined) {
    throw new LexicalError("FIELD_NOT_FOUND", `Field "${fieldPath}" resolved to null/undefined`);
  }

  return current;
}

export function resolveFieldPath(doc: Record<string, unknown>, fieldPath: string): LexicalNode[] {
  const value = resolvePathValue(doc, fieldPath);

  const maybeRoot = (value as Record<string, unknown>).root;
  if (isLexicalRoot(maybeRoot)) {
    return maybeRoot.children;
  }
  if (isLexicalRoot(value)) {
    return (value as LexicalRoot).children;
  }

  throw new LexicalError(
    "FIELD_NOT_FOUND",
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
    throw new LexicalError("FIELD_NOT_FOUND", "No Lexical richtext fields found in document");
  }

  if (candidates.length > 1) {
    const names = candidates.map((c) => c.path).join(", ");
    throw new LexicalError(
      "FIELD_NOT_FOUND",
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
  const value = resolvePathValue(obj, fieldPath);

  if (typeof value !== "object") {
    throw new LexicalError(
      "FIELD_NOT_FOUND",
      `Field "${fieldPath}" does not contain a Lexical richtext structure`,
    );
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

  throw new LexicalError(
    "FIELD_NOT_FOUND",
    `Field "${fieldPath}" does not contain a Lexical richtext structure`,
  );
}
