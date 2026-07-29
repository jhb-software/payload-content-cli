import { describe, it, expect } from "vitest";
import { buildParagraph, editRichText, readRichText } from "../index.js";

/**
 * The `./lexical` entry point exists so a server-side tool (e.g. an MCP
 * `updateRichText`) can do surgical edits without the CLI: read the document it
 * fetched itself, change one node, hand the document back to Payload. This
 * exercises that round trip through the public barrel — if the surface stops
 * composing, an editing tool built on it breaks.
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
  } as Record<string, unknown>;
}

describe("lexical entry point", () => {
  it("reads a field's nodes, edits one, and leaves the document ready to save", () => {
    const document = doc();

    const before = readRichText(document, "content", { depth: 1 });
    expect(before.map((entry) => entry.address)).toEqual(["0", "1"]);

    editRichText(document, "content", {
      op: "insertAfter",
      address: before[0].address,
      node: buildParagraph("inserted"),
    });

    const after = readRichText(document, "content", { depth: 1 });
    expect(after.map((entry) => entry.preview)).toEqual(['"first"', '"inserted"', '"second"']);
    // The rest of the document is untouched, so the caller can send the field back whole.
    expect(document.title).toBe("A post");
  });
});
