import { describe, it, expect } from "vitest";
import {
  buildInternalLink,
  buildParagraph,
  editAtPath,
  linkRichText,
  searchRichText,
} from "../index.js";

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
    const [match] = searchRichText(inserted!, "content", "docs");
    expect(match.path).toBe("content.1.children.0");

    const linked = linkRichText(
      inserted!,
      "content",
      "docs",
      buildInternalLink("docs", "pages", "7"),
    );

    expect(editAtPath(linked, "content", "read").result).toEqual([
      "0 p: first",
      "1 p [1 link]: see the docs",
      "2 p: second",
    ]);
    expect(linked.title).toBe("A post");
    expect(editAtPath(original, "content", "read").result).toHaveLength(2);
  });
});
