import { describe, it, expect } from "vitest";
import { editAtPath, linkRichText, readAtPath, searchRichText } from "../index.js";
import { buildParagraph } from "../nodes.js";

/**
 * The `./lexical` entry point exists so a server-side tool or script can edit
 * a document it fetched itself and hand it back to Payload. This exercises that
 * round trip through the public barrel — if the surface stops composing, a tool
 * built on it breaks.
 */
function doc() {
  return {
    title: "A post",
    content: {
      root: {
        type: "root",
        children: [buildParagraph("first"), buildParagraph("second")],
        direction: "ltr",
        format: "",
        indent: 0,
        version: 1,
      },
    },
  };
}

describe("lexical entry point", () => {
  it("reads, inserts and links by path, leaving a document ready to save", () => {
    const original = doc();

    const { doc: inserted } = editAtPath(original, "content.1", "insert", {
      type: "p",
      text: "see the docs",
    });
    const [match] = searchRichText(inserted, "content", "docs");
    expect(match.path).toBe("content.1.children.0");

    const linked = linkRichText(inserted, "content", "docs", { relationTo: "pages", value: "7" });

    expect(linked.path).toBe("content.1.children.1");
    expect(readAtPath(linked.doc, "content")).toEqual([
      "content.0 p: first",
      "content.1 p [1 link]: see the docs",
      "content.2 p: second",
    ]);
    expect(linked.doc.title).toBe("A post");
    expect(readAtPath(original, "content")).toHaveLength(2);
  });
});
