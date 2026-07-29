import { describe, it, expect } from "vitest";
import { editRichText, LexicalError } from "../index.js";
import type { LexicalNode } from "../index.js";
import { buildInternalLink, buildParagraph } from "../nodes.js";

function doc(children: unknown[] = [buildParagraph("first"), buildParagraph("second")]) {
  return {
    title: "A post",
    content: {
      root: { type: "root", children, direction: "ltr", format: "", indent: 0, version: 1 },
    },
  } as Record<string, unknown>;
}

function texts(document: Record<string, unknown>): unknown[] {
  const root = (document.content as { root: { children: { children: { text: string }[] }[] } })
    .root;
  return root.children.map((node) => node.children?.[0]?.text);
}

describe("editRichText", () => {
  it("appends a node and writes it back into the document", () => {
    const document = doc();

    const children = editRichText(document, "content", {
      op: "append",
      node: buildParagraph("third"),
    });

    expect(children).toHaveLength(3);
    expect(texts(document)).toEqual(["first", "second", "third"]);
  });

  it("appends to an empty field, which has no node to anchor to", () => {
    const document = doc([]);

    editRichText(document, "content", { op: "append", node: buildParagraph("only") });

    expect(texts(document)).toEqual(["only"]);
  });

  it("prepends a node", () => {
    const document = doc();
    editRichText(document, "content", { op: "prepend", node: buildParagraph("zeroth") });
    expect(texts(document)).toEqual(["zeroth", "first", "second"]);
  });

  it("inserts before and after an address", () => {
    const before = doc();
    editRichText(before, "content", {
      op: "insertBefore",
      address: "1",
      node: buildParagraph("middle"),
    });
    expect(texts(before)).toEqual(["first", "middle", "second"]);

    const after = doc();
    editRichText(after, "content", {
      op: "insertAfter",
      address: "0",
      node: buildParagraph("middle"),
    });
    expect(texts(after)).toEqual(["first", "middle", "second"]);
  });

  it("replaces and removes by address", () => {
    const replaced = doc();
    editRichText(replaced, "content", {
      op: "replace",
      address: "0",
      node: buildParagraph("new"),
    });
    expect(texts(replaced)).toEqual(["new", "second"]);

    const removed = doc();
    editRichText(removed, "content", { op: "remove", address: "0" });
    expect(texts(removed)).toEqual(["second"]);
  });

  it("leaves the document untouched when the edit would produce an invalid tree", () => {
    const document = doc();

    expect(() =>
      editRichText(document, "content", { op: "append", node: { type: "paragraph" } }),
    ).toThrow(LexicalError);

    expect(texts(document)).toEqual(["first", "second"]);
  });

  it("reports a missing field with a code the caller can branch on", () => {
    const document = doc();

    try {
      editRichText(document, "nope", { op: "remove", address: "0" });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect(error).toBeInstanceOf(LexicalError);
      expect((error as LexicalError).code).toBe("FIELD_NOT_FOUND");
    }
  });

  it("reports an out-of-range address separately from a malformed one", () => {
    const document = doc();

    const outOfBounds = (() => {
      try {
        editRichText(document, "content", { op: "remove", address: "9" });
      } catch (error) {
        return error as LexicalError;
      }
    })();
    expect(outOfBounds?.code).toBe("ADDRESS_OUT_OF_BOUNDS");

    const malformed = (() => {
      try {
        editRichText(document, "content", { op: "remove", address: "one" });
      } catch (error) {
        return error as LexicalError;
      }
    })();
    expect(malformed?.code).toBe("INVALID_ADDRESS");
  });

  it("applies a batch of edits in order, writing once", () => {
    const document = doc();

    const children = editRichText(document, "content", [
      { op: "append", node: buildParagraph("third") },
      { op: "remove", address: "0" },
      { op: "replace", address: "0", node: buildParagraph("renamed") },
    ]);

    expect(children).toHaveLength(2);
    expect(texts(document)).toEqual(["renamed", "third"]);
  });

  it("applies no part of a batch when a later edit fails", () => {
    const document = doc();

    expect(() =>
      editRichText(document, "content", [
        { op: "append", node: buildParagraph("third") },
        { op: "remove", address: "9" },
      ]),
    ).toThrow(LexicalError);

    expect(texts(document)).toEqual(["first", "second"]);
  });

  it("sets a property on an addressed node", () => {
    const document = doc();

    editRichText(document, "content", {
      op: "setProp",
      address: "0",
      key: "format",
      value: "center",
    });

    const nodes = (document.content as { root: { children: { format: string }[] } }).root.children;
    expect(nodes[0].format).toBe("center");
  });

  it("wraps a text match in a link", () => {
    const document = doc();

    editRichText(document, "content", {
      op: "linkText",
      search: "second",
      node: buildInternalLink("second", "pages", "42"),
    });

    const paragraph = (document.content as { root: { children: { children: LexicalNode[] }[] } })
      .root.children[1];
    expect(paragraph.children.map((child) => child.type)).toEqual(["link"]);
  });

  it("reports unfound link text as a coded error", () => {
    const document = doc();

    try {
      editRichText(document, "content", {
        op: "linkText",
        search: "nowhere",
        node: buildInternalLink("nowhere", "pages", "42"),
      });
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as LexicalError).code).toBe("TEXT_NOT_FOUND");
    }
  });

  it("edits a richtext field nested in an array row", () => {
    const document = {
      sections: [{ body: { root: { type: "root", children: [buildParagraph("a")], version: 1 } } }],
    } as Record<string, unknown>;

    editRichText(document, "sections.0.body", { op: "append", node: buildParagraph("b") });

    const rows = document.sections as { body: { root: { children: unknown[] } } }[];
    expect(rows[0].body.root.children).toHaveLength(2);
  });
});
