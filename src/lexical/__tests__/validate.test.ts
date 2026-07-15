import { describe, it, expect } from "vitest";
import { validateTree, assertValidTree } from "../validate.js";
import type { LexicalNode } from "../types.js";

describe("validateTree", () => {
  it("returns no warnings for valid tree", () => {
    const children: LexicalNode[] = [
      {
        type: "paragraph",
        children: [{ type: "text", text: "Hello", version: 1 }],
        version: 1,
      },
    ];
    expect(validateTree(children)).toEqual([]);
  });

  it("warns on missing type", () => {
    const children = [{ version: 1 }] as unknown as LexicalNode[];
    const warnings = validateTree(children);
    expect(warnings).toContainEqual(expect.stringContaining('missing "type"'));
  });

  it("warns on missing version", () => {
    const children: LexicalNode[] = [{ type: "paragraph" }];
    const warnings = validateTree(children);
    expect(warnings).toContainEqual(expect.stringContaining('missing "version"'));
  });

  it("warns on text node without text field", () => {
    const children: LexicalNode[] = [{ type: "text", version: 1 }];
    const warnings = validateTree(children);
    expect(warnings).toContainEqual(expect.stringContaining('Text node missing "text"'));
  });

  it("validates nested children", () => {
    const children: LexicalNode[] = [
      {
        type: "paragraph",
        version: 1,
        children: [{ type: "text" }], // missing version and text
      },
    ];
    const warnings = validateTree(children);
    expect(warnings.length).toBeGreaterThan(0);
    expect(warnings.some((w) => w.startsWith("[0.0]"))).toBe(true);
  });

  it("returns empty for empty array", () => {
    expect(validateTree([])).toEqual([]);
  });
});

describe("assertValidTree", () => {
  it("passes silently for a valid tree", () => {
    expect(() =>
      assertValidTree([
        {
          type: "paragraph",
          children: [{ type: "text", text: "Hello", version: 1 }],
          version: 1,
        },
      ]),
    ).not.toThrow();
  });

  it("throws with all validation errors for an invalid tree", () => {
    const children = [{ type: "paragraph" }, { type: "text", version: 1 }];
    expect(() => assertValidTree(children)).toThrow(/Validation failed/);
    expect(() => assertValidTree(children)).toThrow(/missing "version"/);
    expect(() => assertValidTree(children)).toThrow(/missing "text"/);
  });
});
