import { describe, it, expect } from "vitest";
import { searchText, linkFirstMatch, extractLinks, extractBlocks } from "../operations.js";
import type { LexicalNode } from "../types.js";

function makeChildren(): LexicalNode[] {
  return [
    {
      type: "heading",
      tag: "h1",
      children: [{ type: "text", text: "Title", version: 1 }],
      version: 1,
    },
    {
      type: "paragraph",
      children: [{ type: "text", text: "Body text", version: 1 }],
      version: 1,
    },
  ];
}

describe("searchText", () => {
  it("finds unlinked text matches with their paths", () => {
    const children: LexicalNode[] = [
      {
        type: "paragraph",
        children: [
          {
            type: "text",
            text: "See the Great Migration up close",
            version: 1,
          },
        ],
        version: 1,
      },
      {
        type: "paragraph",
        children: [
          {
            type: "text",
            text: "Great Migration Viewing: Depending on the season",
            version: 1,
          },
        ],
        version: 1,
      },
    ];

    const matches = searchText(children, "c", "Great Migration");
    expect(matches).toHaveLength(2);
    expect(matches[0].path).toBe("c.0.children.0");
    expect(matches[0].context).toContain("Great Migration");
    expect(matches[1].path).toBe("c.1.children.0");
  });

  it("marks text inside link nodes as linked", () => {
    const children: LexicalNode[] = [
      {
        type: "link",
        children: [{ type: "text", text: "Great Migration", version: 1 }],
        version: 1,
      },
      {
        type: "paragraph",
        children: [{ type: "text", text: "Great Migration elsewhere", version: 1 }],
        version: 1,
      },
    ];

    expect(searchText(children, "c", "Great Migration")).toEqual([
      { path: "c.0.children.0", context: "Great Migration", linked: true },
      { path: "c.1.children.0", context: "Great Migration elsewhere" },
    ]);
  });

  it("returns empty array when no matches", () => {
    const matches = searchText(makeChildren(), "c", "nonexistent");
    expect(matches).toHaveLength(0);
  });

  it("marks text inside autolink nodes as linked", () => {
    const children: LexicalNode[] = [
      {
        type: "paragraph",
        children: [
          {
            type: "autolink",
            children: [{ type: "text", text: "Great Migration", version: 1 }],
            version: 1,
          },
        ],
        version: 1,
      },
    ];

    expect(searchText(children, "c", "Great Migration")).toEqual([
      { path: "c.0.children.0.children.0", context: "Great Migration", linked: true },
    ]);
  });
});

describe("linkFirstMatch", () => {
  const link: LexicalNode = {
    type: "link",
    version: 3,
    children: [{ type: "text", text: "Migration", version: 1 }],
    fields: { linkType: "internal", doc: { relationTo: "topics", value: "m1" } },
  };

  it("splits a text node into before/link/after, preserves formatting and returns the link's path", () => {
    const children: LexicalNode[] = [
      {
        type: "paragraph",
        children: [{ type: "text", text: "The Migration starts.", format: 1, version: 1 }],
        version: 1,
      },
    ];

    expect(linkFirstMatch(children, "c", "Migration", link)).toBe("c.0.children.1");
    const result = children;
    const para = result[0] as unknown as { children: LexicalNode[] };
    expect(para.children).toHaveLength(3);
    expect(para.children[0]).toMatchObject({ type: "text", text: "The ", format: 1 });
    expect(para.children[1].type).toBe("link");
    expect(para.children[2]).toMatchObject({ type: "text", text: " starts.", format: 1 });
  });

  it("omits empty before/after nodes when the match spans the whole text", () => {
    const children: LexicalNode[] = [
      {
        type: "paragraph",
        children: [{ type: "text", text: "Migration", version: 1 }],
        version: 1,
      },
    ];

    expect(linkFirstMatch(children, "c", "Migration", link)).toBe("c.0.children.0");
    const result = children;
    const para = result[0] as unknown as { children: LexicalNode[] };
    expect(para.children).toHaveLength(1);
    expect(para.children[0].type).toBe("link");
  });

  it("links only the first match", () => {
    const children: LexicalNode[] = [
      {
        type: "paragraph",
        children: [{ type: "text", text: "Migration here", version: 1 }],
        version: 1,
      },
      {
        type: "paragraph",
        children: [{ type: "text", text: "Migration there", version: 1 }],
        version: 1,
      },
    ];

    expect(linkFirstMatch(children, "c", "Migration", link)).toBe("c.0.children.0");
    const result = children;
    const first = result[0] as unknown as { children: LexicalNode[] };
    const second = result[1] as unknown as { children: LexicalNode[] };
    expect(first.children.some((c) => c.type === "link")).toBe(true);
    expect(second.children.some((c) => c.type === "link")).toBe(false);
    expect(second.children[0].text).toBe("Migration there");
  });

  it("does not re-link text inside existing link nodes", () => {
    const children: LexicalNode[] = [
      {
        type: "paragraph",
        children: [
          {
            type: "link",
            children: [{ type: "text", text: "Migration", version: 1 }],
            version: 1,
          },
        ],
        version: 1,
      },
    ];

    expect(linkFirstMatch(children, "c", "Migration", link)).toBeUndefined();
  });

  it("does not re-link text inside autolink nodes", () => {
    const children: LexicalNode[] = [
      {
        type: "paragraph",
        children: [
          {
            type: "autolink",
            children: [{ type: "text", text: "Migration", version: 1 }],
            version: 1,
          },
        ],
        version: 1,
      },
    ];

    expect(linkFirstMatch(children, "c", "Migration", link)).toBeUndefined();
  });

  it("reports when the text is not found", () => {
    expect(linkFirstMatch(makeChildren(), "c", "missing", link)).toBeUndefined();
  });
});

describe("extractLinks", () => {
  it("extracts internal links with text, target, and path", () => {
    const children: LexicalNode[] = [
      {
        type: "paragraph",
        children: [
          {
            type: "link",
            version: 3,
            children: [{ type: "text", text: "Kenya", version: 1 }],
            fields: { linkType: "internal", doc: { relationTo: "countries", value: "abc123" } },
          },
        ],
        version: 1,
      },
    ];

    const links = extractLinks(children, "c");
    expect(links).toEqual([
      { path: "c.0.children.0", text: "Kenya", relationTo: "countries", value: "abc123" },
    ]);
  });

  it("normalizes a populated relationship object to its id", () => {
    const children: LexicalNode[] = [
      {
        type: "link",
        version: 3,
        children: [{ type: "text", text: "Kenya", version: 1 }],
        fields: {
          linkType: "internal",
          doc: {
            relationTo: "countries",
            value: { id: "abc123def456abc123def456", title: "Kenya" },
          },
        },
      },
    ];

    const links = extractLinks(children, "c");
    expect(links).toHaveLength(1);
    expect(links[0].value).toBe("abc123def456abc123def456");
  });

  it("ignores custom/external links", () => {
    const children: LexicalNode[] = [
      {
        type: "link",
        version: 3,
        children: [{ type: "text", text: "Site", version: 1 }],
        fields: { linkType: "custom", url: "https://example.com" },
      },
    ];

    expect(extractLinks(children, "c")).toHaveLength(0);
  });
});

describe("extractBlocks", () => {
  it("extracts top-level blocks with context from the preceding heading", () => {
    const children: LexicalNode[] = [
      {
        type: "heading",
        tag: "h2",
        children: [{ type: "text", text: "Gallery section", version: 1 }],
        version: 1,
      },
      { type: "block", version: 2, fields: { blockType: "Gallery" } },
    ];

    const blocks = extractBlocks(children, "c");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ path: "c.1", blockType: "Gallery" });
    expect(blocks[0].context).toContain("Gallery section");
  });

  it("finds blocks nested inside container nodes", () => {
    const children: LexicalNode[] = [
      {
        type: "quote",
        version: 1,
        children: [{ type: "block", version: 2, fields: { blockType: "Cta" } }],
      },
    ];

    const blocks = extractBlocks(children, "c");
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ path: "c.0.children.0", blockType: "Cta" });
  });
});
