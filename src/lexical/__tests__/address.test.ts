import { describe, it, expect } from "vitest";
import {
  parseAddress,
  resolveNode,
  resolveParentAndIndex,
} from "../address.js";
import type { LexicalNode } from "../types.js";

describe("parseAddress", () => {
  it("parses single segment", () => {
    expect(parseAddress("0")).toEqual([0]);
    expect(parseAddress("3")).toEqual([3]);
  });

  it("parses multi-segment address", () => {
    expect(parseAddress("2.1")).toEqual([2, 1]);
    expect(parseAddress("0.3.1")).toEqual([0, 3, 1]);
  });

  it("trims whitespace", () => {
    expect(parseAddress(" 1 ")).toEqual([1]);
  });

  it("throws on empty string", () => {
    expect(() => parseAddress("")).toThrow("Address cannot be empty");
  });

  it("throws on negative number", () => {
    expect(() => parseAddress("-1")).toThrow("non-negative integer");
  });

  it("throws on non-integer", () => {
    expect(() => parseAddress("1.5a")).toThrow("non-negative integer");
  });
});

const sampleChildren: LexicalNode[] = [
  {
    type: "heading",
    tag: "h1",
    children: [{ type: "text", text: "Hello", version: 1 }],
    version: 1,
  },
  {
    type: "paragraph",
    children: [
      { type: "text", text: "First", version: 1 },
      { type: "text", text: "Second", version: 1 },
    ],
    version: 1,
  },
  { type: "paragraph", children: [], version: 1 },
];

describe("resolveNode", () => {
  it("resolves top-level node", () => {
    const node = resolveNode(sampleChildren, [0]);
    expect(node.type).toBe("heading");
  });

  it("resolves nested node", () => {
    const node = resolveNode(sampleChildren, [1, 1]);
    expect(node.type).toBe("text");
    expect(node.text).toBe("Second");
  });

  it("throws on out-of-bounds", () => {
    expect(() => resolveNode(sampleChildren, [5])).toThrow("out of bounds");
  });

  it("throws when traversing non-element node", () => {
    expect(() => resolveNode(sampleChildren, [0, 0, 0])).toThrow(
      "no children array",
    );
  });

  it("throws on empty address", () => {
    expect(() => resolveNode(sampleChildren, [])).toThrow(
      "at least one segment",
    );
  });
});

describe("resolveParentAndIndex", () => {
  it("returns parent array and index for top-level", () => {
    const { parent, index } = resolveParentAndIndex(sampleChildren, [1]);
    expect(parent).toBe(sampleChildren);
    expect(index).toBe(1);
  });

  it("returns parent array and index for nested", () => {
    const { parent, index } = resolveParentAndIndex(sampleChildren, [1, 0]);
    expect(parent).toEqual([
      { type: "text", text: "First", version: 1 },
      { type: "text", text: "Second", version: 1 },
    ]);
    expect(index).toBe(0);
  });

  it("throws on empty address", () => {
    expect(() => resolveParentAndIndex(sampleChildren, [])).toThrow(
      "at least one segment",
    );
  });
});
