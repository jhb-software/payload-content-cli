import { describe, it, expect } from "vitest";
import { buildBlock, buildInternalLink, buildParagraph, buildText } from "../nodes.js";
import {
  diffRichText,
  extractRichTextLinks,
  LexicalError,
  linkRichText,
  richTextPaths,
  searchRichText,
} from "../index.js";

function richText(...children: unknown[]) {
  return {
    root: { type: "root", children, direction: "ltr", format: "", indent: 0, version: 1 },
  };
}

/** A page whose rich text sits in an array row, with a link inside a block's body. */
function page() {
  return {
    title: "Travel",
    intro: richText(buildParagraph("Welcome")),
    layout: [
      { blockType: "hero" },
      {
        blockType: "content",
        richText: richText(
          buildParagraph("Check the entry rules."),
          buildBlock({
            blockType: "alert",
            body: richText({
              ...buildParagraph(""),
              children: [
                buildText("See "),
                buildInternalLink("visa rules", { relationTo: "pages", value: "visa" }),
              ],
            }),
          }),
        ),
      },
    ],
  };
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (error) {
    return (error as LexicalError).code;
  }
  return undefined;
}

describe("richTextPaths", () => {
  it("finds rich-text fields inside array rows, in document order", () => {
    expect(richTextPaths(page())).toEqual(["intro", "layout.1.richText"]);
  });

  it("adds rich text nested in blocks when asked", () => {
    expect(richTextPaths(page(), { nested: true })).toEqual([
      "intro",
      "layout.1.richText",
      "layout.1.richText.1.fields.body",
    ]);
  });
});

describe("searchRichText", () => {
  it("finds text in a block's nested rich text, by full path", () => {
    expect(searchRichText(page(), "layout.1.richText", "See")).toEqual([
      { path: "layout.1.richText.1.fields.body.0.children.0", context: "See " },
    ]);
  });

  it("searches every rich text in the document when the path is empty, marking linked text", () => {
    expect(searchRichText(page(), "", "e")).toEqual([
      expect.objectContaining({ path: "intro.0.children.0" }),
      expect.objectContaining({ path: "layout.1.richText.0.children.0" }),
      expect.objectContaining({ path: "layout.1.richText.1.fields.body.0.children.0" }),
      expect.objectContaining({
        path: "layout.1.richText.1.fields.body.0.children.1.children.0",
        linked: true,
      }),
    ]);
  });

  it("searches all rich text below a path that isn't rich text itself", () => {
    expect(searchRichText(page(), "layout", "Bring")).toEqual([]);
    expect(searchRichText(page(), "layout", "entry")).toHaveLength(1);
  });

  it("refuses a path with no rich text at or below it", () => {
    expect(() => searchRichText(page(), "title", "x")).toThrow(/No rich text at title/);
    expect(codeOf(() => searchRichText(page(), "title", "x"))).toBe("PATH_NOT_FOUND");
  });
});

describe("extractRichTextLinks", () => {
  it("lists links in nested rich text with their targets", () => {
    expect(extractRichTextLinks(page(), "layout.1.richText")).toEqual([
      {
        path: "layout.1.richText.1.fields.body.0.children.1",
        text: "visa rules",
        relationTo: "pages",
        value: "visa",
      },
    ]);
  });
});

describe("linkRichText", () => {
  it("returns a copy with the text linked and leaves the document as it was", () => {
    const doc = page();

    const linked = linkRichText(doc, "layout.1.richText", "entry rules", {
      relationTo: "pages",
      value: "entry",
    });

    expect(linked.path).toBe("layout.1.richText.0.children.1");
    expect(extractRichTextLinks(linked.doc, "layout.1.richText").map((l) => l.value)).toEqual([
      "entry",
      "visa",
    ]);
    expect(extractRichTextLinks(doc, "layout.1.richText")).toHaveLength(1);
  });

  it("searches the whole document when the path is empty", () => {
    const linked = linkRichText(page(), "", "Welcome", { relationTo: "pages", value: "home" });
    expect(linked.path).toBe("intro.0.children.0");
  });

  it("refuses text that isn't there unlinked", () => {
    const target = { relationTo: "pages", value: "visa" };
    expect(codeOf(() => linkRichText(page(), "layout.1.richText", "visa rules", target))).toBe(
      "TEXT_NOT_FOUND",
    );
  });
});

describe("diffRichText", () => {
  it("reports a nested link one locale has and the other doesn't", () => {
    const target = page();
    target.layout[1].richText = richText(buildParagraph("Check the visa rules."));

    const result = diffRichText(page(), target, "layout.1.richText");

    expect(result.linksOnlyInSource).toMatchObject([
      { path: "layout.1.richText.1.fields.body.0.children.1", match: "visa rules" },
    ]);
    expect(result.blocksOnlyInSource.map((b) => b.blockType)).toEqual(["alert"]);
    expect(result.inSync).toBe(false);
  });
});
