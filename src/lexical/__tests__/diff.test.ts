import { describe, it, expect } from "vitest";
import { diffLexicalDocs, DIFF_STOP_WORDS } from "../diff.js";
import type { LexicalNode } from "../types.js";

function paragraph(text: string): LexicalNode {
  return {
    type: "paragraph",
    children: [{ type: "text", text, version: 1 }],
    version: 1,
  };
}

function internalLink(text: string, relationTo: string, value: string): LexicalNode {
  return {
    type: "link",
    version: 3,
    children: [{ type: "text", text, version: 1 }],
    fields: { linkType: "internal", doc: { relationTo, value } },
  };
}

function linkedParagraph(before: string, link: LexicalNode, after: string): LexicalNode {
  return {
    type: "paragraph",
    children: [
      { type: "text", text: before, version: 1 },
      link,
      { type: "text", text: after, version: 1 },
    ],
    version: 1,
  };
}

function block(blockType: string): LexicalNode {
  return { type: "block", version: 2, fields: { blockType } };
}

describe("diffLexicalDocs", () => {
  it("reports files in sync when links and blocks match", () => {
    const source = [linkedParagraph("See ", internalLink("Kenya", "countries", "abc"), ".")];
    const target = [linkedParagraph("Siehe ", internalLink("Kenia", "countries", "abc"), ".")];

    const result = diffLexicalDocs(source, target);
    expect(result.inSync).toBe(true);
    expect(result.linksOnlyInSource).toHaveLength(0);
    expect(result.linksOnlyInTarget).toHaveLength(0);
    expect(result.linksInBoth).toHaveLength(1);
    expect(result.linksInBoth[0].value).toBe("abc");
  });

  it("reports links missing from the target", () => {
    const source = [linkedParagraph("See ", internalLink("Kenya", "countries", "abc"), ".")];
    const target = [paragraph("No links here.")];

    const result = diffLexicalDocs(source, target);
    expect(result.inSync).toBe(false);
    expect(result.linksOnlyInSource).toHaveLength(1);
    expect(result.linksOnlyInSource[0]).toMatchObject({
      text: "Kenya",
      relationTo: "countries",
      value: "abc",
    });
  });

  it("reports links only present in the target", () => {
    const source = [paragraph("Nothing linked.")];
    const target = [linkedParagraph("See ", internalLink("Kenya", "countries", "abc"), ".")];

    const result = diffLexicalDocs(source, target);
    expect(result.linksOnlyInTarget).toHaveLength(1);
    expect(result.linksOnlyInTarget[0].value).toBe("abc");
  });

  it("treats links with the same target as matching regardless of text", () => {
    const source = [linkedParagraph("", internalLink("Great Migration", "topics", "m1"), "")];
    const target = [linkedParagraph("", internalLink("Große Migration", "topics", "m1"), "")];

    const result = diffLexicalDocs(source, target);
    expect(result.linksOnlyInSource).toHaveLength(0);
    expect(result.linksOnlyInTarget).toHaveLength(0);
  });

  it("reports block type differences in both directions", () => {
    const source = [block("Gallery"), block("Cta")];
    const target = [block("Cta"), block("Newsletter")];

    const result = diffLexicalDocs(source, target);
    expect(result.blocksOnlyInSource.map((b) => b.blockType)).toEqual(["Gallery"]);
    expect(result.blocksOnlyInTarget.map((b) => b.blockType)).toEqual(["Newsletter"]);
    expect(result.inSync).toBe(false);
  });

  describe("fuzzy text-match heuristic for missing links", () => {
    it("marks an exact text match in the target", () => {
      const source = [linkedParagraph("", internalLink("Great Migration", "topics", "m1"), "")];
      const target = [paragraph("Read about the Great Migration here.")];

      const result = diffLexicalDocs(source, target);
      expect(result.linksOnlyInSource[0].match).toBe("Great Migration");
    });

    it("falls back to a significant word when exact text is missing", () => {
      const source = [linkedParagraph("", internalLink("Great Migration", "topics", "m1"), "")];
      const target = [paragraph("The annual Migration crosses the Mara river.")];

      const result = diffLexicalDocs(source, target);
      expect(result.linksOnlyInSource[0].match).toBe("Migration");
    });

    it("ignores stop words and short words when matching", () => {
      // "with" is a stop word and "up" is too short — neither may produce a match
      const source = [linkedParagraph("", internalLink("with up Serengeti", "parks", "p1"), "")];
      const target = [paragraph("Travel with your family, look up hotels.")];

      const result = diffLexicalDocs(source, target);
      expect(result.linksOnlyInSource[0].match).toBeUndefined();
    });

    it("leaves match undefined when nothing in the target matches", () => {
      const source = [linkedParagraph("", internalLink("Serengeti", "parks", "p1"), "")];
      const target = [paragraph("Completely unrelated text.")];

      const result = diffLexicalDocs(source, target);
      expect(result.linksOnlyInSource[0].match).toBeUndefined();
    });

    it("does not count text inside existing target links as a match", () => {
      const source = [linkedParagraph("", internalLink("Serengeti", "parks", "p1"), "")];
      const target = [linkedParagraph("", internalLink("Serengeti", "parks", "other"), "")];

      const result = diffLexicalDocs(source, target);
      expect(result.linksOnlyInSource[0].match).toBeUndefined();
    });
  });
});

describe("DIFF_STOP_WORDS", () => {
  it("contains common English and German stop words", () => {
    expect(DIFF_STOP_WORDS.has("the")).toBe(true);
    expect(DIFF_STOP_WORDS.has("und")).toBe(true);
  });
});
