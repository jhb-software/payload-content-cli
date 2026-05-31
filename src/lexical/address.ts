import type { Address, LexicalNode, LexicalElementNode } from "./types.js";

export function parseAddress(str: string): Address {
  const trimmed = str.trim();
  if (trimmed === "") {
    throw new Error("Address cannot be empty");
  }
  const parts = trimmed.split(".");
  const address: Address = [];
  for (const part of parts) {
    const segment = Number(part);
    if (!Number.isInteger(segment) || segment < 0) {
      throw new Error(`Invalid address segment "${part}" — must be a non-negative integer`);
    }
    address.push(segment);
  }
  return address;
}

export function resolveNode(children: LexicalNode[], address: Address): LexicalNode {
  if (address.length === 0) {
    throw new Error("Address must have at least one segment");
  }

  let current: LexicalNode[] = children;
  for (let i = 0; i < address.length; i++) {
    const idx = address[i];
    if (idx < 0 || idx >= current.length) {
      const partial = address.slice(0, i + 1).join(".");
      throw new Error(`Address "${partial}" is out of bounds (length ${current.length})`);
    }
    if (i < address.length - 1) {
      const node = current[idx] as LexicalElementNode;
      if (!Array.isArray(node.children)) {
        const partial = address.slice(0, i + 1).join(".");
        throw new Error(`Node at "${partial}" has no children array`);
      }
      current = node.children;
    }
  }
  return current[address[address.length - 1]];
}

export function resolveParentAndIndex(
  children: LexicalNode[],
  address: Address,
): { parent: LexicalNode[]; index: number } {
  if (address.length === 0) {
    throw new Error("Address must have at least one segment");
  }

  let current: LexicalNode[] = children;
  for (let i = 0; i < address.length - 1; i++) {
    const idx = address[i];
    if (idx < 0 || idx >= current.length) {
      const partial = address.slice(0, i + 1).join(".");
      throw new Error(`Address "${partial}" is out of bounds (length ${current.length})`);
    }
    const node = current[idx] as LexicalElementNode;
    if (!Array.isArray(node.children)) {
      const partial = address.slice(0, i + 1).join(".");
      throw new Error(`Node at "${partial}" has no children array`);
    }
    current = node.children;
  }

  const index = address[address.length - 1];
  return { parent: current, index };
}
