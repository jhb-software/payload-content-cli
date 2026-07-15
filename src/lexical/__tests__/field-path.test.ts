import { describe, it, expect } from "vitest";
import { resolveFieldPath, autoDetectLexicalField, setByPath } from "../field-path.js";

const lexicalField = {
  root: {
    type: "root",
    children: [
      {
        type: "paragraph",
        children: [{ type: "text", text: "Hello" }],
        version: 1,
      },
    ],
    direction: "ltr",
    format: "",
    indent: 0,
    version: 1,
  },
};

describe("resolveFieldPath", () => {
  it("resolves a simple field name", () => {
    const doc = { content: lexicalField, title: "Test" };
    const children = resolveFieldPath(doc, "content");
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe("paragraph");
  });

  it("resolves bracket notation for arrays", () => {
    const doc = { layout: [{ richText: lexicalField }] };
    const children = resolveFieldPath(doc, "layout[0].richText");
    expect(children).toHaveLength(1);
  });

  it("throws on missing field", () => {
    expect(() => resolveFieldPath({}, "missing")).toThrow("not found");
  });

  it("throws on non-lexical field", () => {
    expect(() => resolveFieldPath({ title: "hi" }, "title")).toThrow(
      "does not contain a Lexical richtext",
    );
  });
});

describe("autoDetectLexicalField", () => {
  it("detects single lexical field", () => {
    const doc = { id: "123", title: "Test", content: lexicalField };
    const result = autoDetectLexicalField(doc);
    expect(result.path).toBe("content");
    expect(result.children).toHaveLength(1);
  });

  it("throws on no lexical fields", () => {
    expect(() => autoDetectLexicalField({ title: "Test" })).toThrow("No Lexical richtext fields");
  });

  it("throws on multiple lexical fields", () => {
    const doc = { body: lexicalField, sidebar: lexicalField };
    expect(() => autoDetectLexicalField(doc)).toThrow("Multiple Lexical richtext fields");
  });
});

describe("setByPath", () => {
  it("replaces children in a lexical field", () => {
    const doc = { content: JSON.parse(JSON.stringify(lexicalField)) };
    const newChildren = [{ type: "paragraph", children: [], version: 1 }];
    setByPath(doc, "content", newChildren);
    expect((doc.content as { root: { children: unknown[] } }).root.children).toEqual(newChildren);
  });

  it("throws on missing field", () => {
    expect(() => setByPath({}, "missing", [])).toThrow("not found");
  });
});

describe("block-aware paths", () => {
  function makeBlockDoc() {
    return {
      content: {
        root: {
          type: "root",
          version: 1,
          children: [
            {
              type: "block",
              version: 2,
              fields: {
                blockType: "TwoColumnRichText",
                firstColumn: JSON.parse(JSON.stringify(lexicalField)),
              },
            },
          ],
        },
      },
    };
  }

  it("resolves a lexical field inside a block by blockType", () => {
    const children = resolveFieldPath(makeBlockDoc(), "content.TwoColumnRichText.firstColumn");
    expect(children).toHaveLength(1);
    expect(children[0].type).toBe("paragraph");
  });

  it("round-trips get and set through a block path", () => {
    const doc = makeBlockDoc();
    const path = "content.TwoColumnRichText.firstColumn";
    const newChildren = [
      {
        type: "paragraph",
        children: [{ type: "text", text: "Updated", version: 1 }],
        version: 1,
      },
    ];

    setByPath(doc, path, newChildren);
    const roundTripped = resolveFieldPath(doc, path);
    expect(roundTripped).toEqual(newChildren);
  });

  it("throws with the failing segment when a blockType does not exist", () => {
    expect(() => resolveFieldPath(makeBlockDoc(), "content.MissingBlock.firstColumn")).toThrow(
      /segment "MissingBlock" not found/,
    );
    expect(() => setByPath(makeBlockDoc(), "content.MissingBlock.firstColumn", [])).toThrow(
      /segment "MissingBlock" not found/,
    );
  });
});
