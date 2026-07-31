import { describe, it, expect } from "vitest";
import {
  diffRichText,
  extractRichTextLinks,
  getRichTextNode,
  LexicalError,
  readRichText,
  searchRichText,
} from "../index.js";
import { buildHeading, buildInternalLink, buildParagraph } from "../nodes.js";

function field(children: unknown[]) {
  return {
    root: { type: "root", children, direction: "ltr", format: "", indent: 0, version: 1 },
  };
}

function doc() {
  return {
    title: "A post",
    content: field([
      buildHeading("Intro", "h2"),
      buildParagraph("see our docs for more"),
      { type: "block", fields: { blockType: "cta" }, format: "", version: 2 },
    ]),
  } as Record<string, unknown>;
}

describe("readRichText", () => {
  it("summarizes a field straight from the document", () => {
    expect(readRichText(doc(), "content", { depth: 1 })).toEqual([
      { address: "0", type: "heading", tag: "h2", preview: '"Intro"' },
      { address: "1", type: "paragraph", preview: '"see our docs for more"' },
      { address: "2", type: "block", blockType: "cta", preview: "(cta)" },
    ]);
  });

  it("includes link text in a paragraph's preview", () => {
    const document = {
      content: field([
        {
          type: "paragraph",
          version: 1,
          direction: "ltr",
          format: "",
          indent: 0,
          children: [
            { type: "text", text: "See the ", format: 0, version: 1 },
            buildInternalLink("docs", "pages", "page-1"),
            { type: "text", text: " for details.", format: 0, version: 1 },
          ],
        },
      ]),
    } as Record<string, unknown>;

    expect(readRichText(document, "content", { depth: 1 })[0].preview).toBe(
      '"See the docs for details."',
    );
  });

  it("descends into nested nodes by default", () => {
    const addresses = readRichText(doc(), "content").map((entry) => entry.address);
    expect(addresses).toContain("0.0");
  });

  it("reads a field nested in an array row", () => {
    const document = { sections: [{ body: field([buildParagraph("a")]) }] } as Record<
      string,
      unknown
    >;
    expect(readRichText(document, "sections.0.body")).toHaveLength(2);
  });

  it("reports an unknown field with a code", () => {
    try {
      readRichText(doc(), "nope");
      expect.unreachable("should have thrown");
    } catch (error) {
      expect((error as LexicalError).code).toBe("FIELD_NOT_FOUND");
    }
  });

  it("hands back copies, so callers can't edit the document behind the API's back", () => {
    const document = doc();
    const node = getRichTextNode(document, "content", "1");

    (node as unknown as { children: unknown[] }).children = [];

    expect(readRichText(document, "content", { depth: 1 })[1].preview).toBe(
      '"see our docs for more"',
    );
  });
});

describe("getRichTextNode", () => {
  it("returns the node at an address", () => {
    expect(getRichTextNode(doc(), "content", "0").type).toBe("heading");
  });
});

describe("searchRichText", () => {
  it("finds unlinked text with the address to act on", () => {
    const matches = searchRichText(doc(), "content", "our docs");
    expect(matches).toHaveLength(1);
    expect(matches[0].address).toBe("1.0");
  });
});

describe("extractRichTextLinks", () => {
  it("inventories internal links with their targets", () => {
    const document = {
      content: field([
        { ...buildParagraph("x"), children: [buildInternalLink("docs", "pages", "7")] },
      ]),
    } as Record<string, unknown>;

    expect(extractRichTextLinks(document, "content")).toEqual([
      { address: "0.0", text: "docs", relationTo: "pages", value: "7" },
    ]);
  });
});

describe("diffRichText", () => {
  it("reports links present in one locale but not the other", () => {
    const source = {
      content: field([
        { ...buildParagraph("x"), children: [buildInternalLink("docs", "pages", "7")] },
      ]),
    } as Record<string, unknown>;
    const target = { content: field([buildParagraph("docs")]) } as Record<string, unknown>;

    const result = diffRichText(source, target, "content");

    expect(result.linksOnlyInSource.map((link) => link.text)).toEqual(["docs"]);
  });
});
