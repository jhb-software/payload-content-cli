import type { Address, LexicalNode, LexicalElementNode } from "./types.js";
import { LexicalError } from "./errors.js";

export function parseAddress(str: string): Address {
  const trimmed = str.trim();
  if (trimmed === "") {
    throw new LexicalError("INVALID_ADDRESS", "Address cannot be empty");
  }
  const parts = trimmed.split(".");
  const address: Address = [];
  for (const part of parts) {
    const n = Number(part);
    if (!Number.isInteger(n) || n < 0) {
      throw new LexicalError(
        "INVALID_ADDRESS",
        `Invalid address segment "${part}" — must be a non-negative integer`,
      );
    }
    address.push(n);
  }
  return address;
}

export function resolveNode(children: LexicalNode[], address: Address): LexicalNode {
  if (address.length === 0) {
    throw new LexicalError("INVALID_ADDRESS", "Address must have at least one segment");
  }

  let current: LexicalNode[] = children;
  for (let i = 0; i < address.length; i++) {
    const idx = address[i];
    if (idx < 0 || idx >= current.length) {
      const partial = address.slice(0, i + 1).join(".");
      throw new LexicalError(
        "ADDRESS_OUT_OF_BOUNDS",
        `Address "${partial}" is out of bounds (length ${current.length})`,
      );
    }
    if (i < address.length - 1) {
      const node = current[idx] as LexicalElementNode;
      if (!Array.isArray(node.children)) {
        const partial = address.slice(0, i + 1).join(".");
        throw new LexicalError("NOT_A_CONTAINER", `Node at "${partial}" has no children array`);
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
    throw new LexicalError("INVALID_ADDRESS", "Address must have at least one segment");
  }

  let current: LexicalNode[] = children;
  for (let i = 0; i < address.length - 1; i++) {
    const idx = address[i];
    if (idx < 0 || idx >= current.length) {
      const partial = address.slice(0, i + 1).join(".");
      throw new LexicalError(
        "ADDRESS_OUT_OF_BOUNDS",
        `Address "${partial}" is out of bounds (length ${current.length})`,
      );
    }
    const node = current[idx] as LexicalElementNode;
    if (!Array.isArray(node.children)) {
      const partial = address.slice(0, i + 1).join(".");
      throw new LexicalError("NOT_A_CONTAINER", `Node at "${partial}" has no children array`);
    }
    current = node.children;
  }

  const index = address[address.length - 1];
  return { parent: current, index };
}
