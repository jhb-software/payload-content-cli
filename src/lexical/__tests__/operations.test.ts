import { describe, it, expect } from "vitest";
import {
  listNodes,
  getNode,
  addNode,
  replaceNode,
  removeNode,
  setNodeProp,
  searchText,
  linkText,
  extractLinks,
  extractBlocks,
} from "../operations.js";
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

describe("listNodes", () => {
  it("returns flat list with addresses and types", () => {
    const entries = listNodes(makeChildren());
    expect(entries).toHaveLength(4); // heading, heading.text, paragraph, paragraph.text
    expect(entries[0]).toEqual({
      address: "0",
      type: "heading",
      preview: '"Title"',
    });
    expect(entries[1]).toEqual({
      address: "0.0",
      type: "text",
      preview: '"Title"',
    });
  });
});

describe("getNode", () => {
  it("returns the correct node", () => {
    const node = getNode(makeChildren(), "1");
    expect(node.type).toBe("paragraph");
  });

  it("returns nested node", () => {
    const node = getNode(makeChildren(), "0.0");
    expect(node.type).toBe("text");
    expect(node.text).toBe("Title");
  });
});

describe("addNode", () => {
  it("inserts before", () => {
    const original = makeChildren();
    const result = addNode(original, "1", "before", {
      type: "paragraph",
      children: [],
      version: 1,
    });
    expect(result).toHaveLength(3);
    expect(result[1].type).toBe("paragraph");
    expect((result[1] as unknown as { children: unknown[] }).children).toHaveLength(0);
    // Original unchanged
    expect(original).toHaveLength(2);
  });

  it("inserts after", () => {
    const result = addNode(makeChildren(), "0", "after", {
      type: "paragraph",
      children: [],
      version: 1,
    });
    expect(result).toHaveLength(3);
    expect(result[0].type).toBe("heading");
    expect((result[1] as unknown as { children: unknown[] }).children).toHaveLength(0);
  });

  it("inserts at start of element children", () => {
    const result = addNode(makeChildren(), "0", "start", {
      type: "text",
      text: "Prepended",
      version: 1,
    });
    const heading = result[0] as unknown as { children: LexicalNode[] };
    expect(heading.children).toHaveLength(2);
    expect(heading.children[0].text).toBe("Prepended");
  });

  it("inserts at end of element children", () => {
    const result = addNode(makeChildren(), "0", "end", {
      type: "text",
      text: "Appended",
      version: 1,
    });
    const heading = result[0] as unknown as { children: LexicalNode[] };
    expect(heading.children).toHaveLength(2);
    expect(heading.children[1].text).toBe("Appended");
  });

  it("does not mutate original", () => {
    const original = makeChildren();
    addNode(original, "0", "after", {
      type: "paragraph",
      children: [],
      version: 1,
    });
    expect(original).toHaveLength(2);
  });
});

describe("replaceNode", () => {
  it("replaces a node at address", () => {
    const result = replaceNode(makeChildren(), "0", {
      type: "paragraph",
      children: [],
      version: 1,
    });
    expect(result[0].type).toBe("paragraph");
    expect((result[0] as unknown as { children: unknown[] }).children).toHaveLength(0);
  });

  it("does not mutate original", () => {
    const original = makeChildren();
    replaceNode(original, "0", { type: "paragraph", children: [], version: 1 });
    expect(original[0].type).toBe("heading");
  });
});

describe("removeNode", () => {
  it("removes a node", () => {
    const result = removeNode(makeChildren(), "0");
    expect(result).toHaveLength(1);
    expect(result[0].type).toBe("paragraph");
  });

  it("does not mutate original", () => {
    const original = makeChildren();
    removeNode(original, "0");
    expect(original).toHaveLength(2);
  });
});

describe("searchText", () => {
  it("finds unlinked text matches with addresses", () => {
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

    const matches = searchText(children, "Great Migration");
    expect(matches).toHaveLength(2);
    expect(matches[0].address).toBe("0.0");
    expect(matches[0].context).toContain("Great Migration");
    expect(matches[1].address).toBe("1.0");
  });

  it("skips text inside link nodes", () => {
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

    const matches = searchText(children, "Great Migration");
    expect(matches).toHaveLength(1);
    expect(matches[0].address).toBe("1.0");
  });

  it("returns empty array when no matches", () => {
    const matches = searchText(makeChildren(), "nonexistent");
    expect(matches).toHaveLength(0);
  });

  it("skips text inside autolink nodes", () => {
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

    expect(searchText(children, "Great Migration")).toHaveLength(0);
  });
});

describe("linkText", () => {
  const link: LexicalNode = {
    type: "link",
    version: 3,
    children: [{ type: "text", text: "Migration", version: 1 }],
    fields: { linkType: "internal", doc: { relationTo: "topics", value: "m1" } },
  };

  it("splits a text node into before/link/after and preserves formatting", () => {
    const children: LexicalNode[] = [
      {
        type: "paragraph",
        children: [{ type: "text", text: "The Migration starts.", format: 1, version: 1 }],
        version: 1,
      },
    ];

    const result = linkText(children, "Migration", link);
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

    const result = linkText(children, "Migration", link);
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

    const result = linkText(children, "Migration", link);
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

    expect(() => linkText(children, "Migration", link)).toThrow(/not found/);
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

    expect(() => linkText(children, "Migration", link)).toThrow(/not found/);
  });

  it("throws when the text is not found", () => {
    expect(() => linkText(makeChildren(), "missing", link)).toThrow(/not found/);
  });
});

describe("extractLinks", () => {
  it("extracts internal links with text, target, and address", () => {
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

    const links = extractLinks(children);
    expect(links).toEqual([
      { address: "0.0", text: "Kenya", relationTo: "countries", value: "abc123" },
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

    const links = extractLinks(children);
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

    expect(extractLinks(children)).toHaveLength(0);
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

    const blocks = extractBlocks(children);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ address: "1", blockType: "Gallery" });
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

    const blocks = extractBlocks(children);
    expect(blocks).toHaveLength(1);
    expect(blocks[0]).toMatchObject({ address: "0.0", blockType: "Cta" });
  });
});

describe("setNodeProp", () => {
  it("sets a property on a node", () => {
    const result = setNodeProp(makeChildren(), "0", "tag", "h3");
    expect(result[0].tag).toBe("h3");
  });

  it("sets a nested node property", () => {
    const result = setNodeProp(makeChildren(), "0.0", "text", "Updated");
    const heading = result[0] as unknown as { children: LexicalNode[] };
    expect(heading.children[0].text).toBe("Updated");
  });

  it("does not mutate original", () => {
    const original = makeChildren();
    setNodeProp(original, "0", "tag", "h3");
    expect(original[0].tag).toBe("h1");
  });

  it("rejects setting a non-existent prop without --create", () => {
    expect(() => setNodeProp(makeChildren(), "0", "text", "Hi")).toThrow(
      /does not exist on node at "0"/,
    );
  });

  it("allows creating a new prop when create option is set", () => {
    const result = setNodeProp(makeChildren(), "0", "customProp", "x", {
      create: true,
    });
    expect((result[0] as Record<string, unknown>).customProp).toBe("x");
  });
});
