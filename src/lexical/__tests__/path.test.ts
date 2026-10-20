import { describe, expect, it } from "vitest";
import { editAtPath, LexicalError, readAtPath } from "../index.js";

const text = (value: string) => ({
  type: "text",
  version: 1,
  detail: 0,
  format: 0,
  mode: "normal",
  style: "",
  text: value,
});

const paragraph = (...children: unknown[]) => ({
  type: "paragraph",
  version: 1,
  format: "",
  indent: 0,
  direction: "ltr",
  textFormat: 0,
  textStyle: "",
  children,
});

const link = (label: string, docId: string) => ({
  type: "link",
  version: 3,
  format: "",
  indent: 0,
  direction: "ltr",
  id: `link-${docId}`,
  fields: { linkType: "internal", newTab: false, doc: { relationTo: "pages", value: docId } },
  children: [text(label)],
});

const richText = (...children: unknown[]) => ({
  root: { type: "root", version: 1, format: "", indent: 0, direction: "ltr", children },
});

const block = (fields: Record<string, unknown>) => ({
  type: "block",
  version: 2,
  format: "",
  fields,
});

/** A gallery block inside a rich text inside an array row. */
const regionDoc = () => ({
  infoSections: [
    {
      id: "row-1",
      richText: richText(
        {
          type: "heading",
          tag: "h2",
          version: 1,
          format: "",
          indent: 0,
          direction: "ltr",
          children: [text("Arrival")],
        },
        block({
          id: "gallery-1",
          blockType: "gallery",
          items: [{ id: "item-1", image: "dead-media" }],
        }),
      ),
    },
  ],
});

/** One paragraph holding three links. */
const linksDoc = () => ({
  content: richText(
    paragraph(text("Intro")),
    paragraph(
      text("More on "),
      link("costs", "costs"),
      text(", "),
      link("entry", "entry"),
      text(" and "),
      link("vaccinations", "old-vaccinations"),
    ),
  ),
});

/** An alert block holding its own rich text. */
const alertDoc = () => ({
  content: richText(
    paragraph(text("Intro")),
    block({
      id: "alert-1",
      blockType: "alert",
      style: "warning",
      richText: richText(paragraph(text("See "), link("safety", "old-safety"))),
    }),
  ),
});

function errorOf(fn: () => unknown): LexicalError | undefined {
  try {
    fn();
  } catch (err) {
    if (err instanceof LexicalError) return err;
    throw err;
  }
  return undefined;
}

function codeOf(fn: () => unknown): string | undefined {
  try {
    fn();
  } catch (err) {
    return err instanceof LexicalError ? err.code : "not a LexicalError";
  }
  return undefined;
}

describe("reading by path", () => {
  it("outlines a rich-text field one line per node", () => {
    const result = readAtPath(linksDoc(), "content");
    expect(result).toEqual([
      "content.0 p: Intro",
      "content.1 p [3 links]: More on costs, entry and vaccinations",
    ]);
  });

  it("outlines blocks with their slug and the text of rich text inside them", () => {
    const result = readAtPath(alertDoc(), "content");
    expect(result).toEqual(["content.0 p: Intro", "content.1 block alert [1 link]: See safety"]);
  });

  it("returns a node without Lexical's default properties", () => {
    const result = readAtPath(linksDoc(), "content.0");
    expect(result).toEqual({
      type: "paragraph",
      version: 1,
      children: [{ type: "text", version: 1, text: "Intro" }],
    });
  });

  it("shows rich text nested in a block as an outline", () => {
    const result = readAtPath(alertDoc(), "content.1");
    expect(result).toMatchObject({
      fields: {
        blockType: "alert",
        richText: ["content.1.fields.richText.0 p [1 link]: See safety"],
      },
    });
  });

  it("descends into rich text inside a block", () => {
    const result = readAtPath(alertDoc(), "content.1.fields.richText.0.children.1.fields.doc");
    expect(result).toEqual({ relationTo: "pages", value: "old-safety" });
  });

  it("reaches rich text inside an array row", () => {
    const result = readAtPath(regionDoc(), "infoSections.0.richText.1.fields.items.0.image");
    expect(result).toBe("dead-media");
  });

  it("outlines every rich text below a path that isn't rich text itself", () => {
    expect(readAtPath(regionDoc(), "infoSections.0")).toEqual({
      id: "row-1",
      richText: [
        "infoSections.0.richText.0 h2: Arrival",
        "infoSections.0.richText.1 block gallery",
      ],
    });
  });

  it("reads the whole document at the empty path", () => {
    expect(readAtPath(linksDoc(), "")).toEqual({
      content: [
        "content.0 p: Intro",
        "content.1 p [3 links]: More on costs, entry and vaccinations",
      ],
    });
  });

  it("does not modify the document when editing", () => {
    const document = alertDoc();
    editAtPath(document, "content.1", "delete");
    expect(document).toEqual(alertDoc());
  });
});

describe("setting by path", () => {
  it("swaps a value inside a block without touching ids or other fields", () => {
    const { doc, result } = editAtPath(
      regionDoc(),
      "infoSections.0.richText.1.fields.items.0.image",
      "set",
      "new-media",
    );
    expect(result).toEqual({ set: "infoSections.0.richText.1.fields.items.0.image" });
    const expected = regionDoc();
    (expected.infoSections[0].richText.root.children[1] as ReturnType<typeof block>).fields.items =
      [{ id: "item-1", image: "new-media" }];
    expect(doc).toEqual(expected);
  });

  it("retargets one link and keeps the other two", () => {
    const { doc } = editAtPath(linksDoc(), "content.1.children.5.fields.doc", "set", {
      relationTo: "pages",
      value: "new-vaccinations",
    });
    expect(JSON.stringify(doc)).toBe(
      JSON.stringify(linksDoc()).replace(
        '"value":"old-vaccinations"',
        '"value":"new-vaccinations"',
      ),
    );
  });

  it("parses a JSON string given for an object value", () => {
    const { result } = editAtPath(
      linksDoc(),
      "content.1.children.5.fields.doc",
      "set",
      '{"relationTo":"pages","value":"new-vaccinations"}',
    );
    expect(result).toEqual({ set: "content.1.children.5.fields.doc" });
  });

  it("retargets a link inside a block's rich text", () => {
    const { doc } = editAtPath(
      alertDoc(),
      "content.1.fields.richText.0.children.1.fields.doc.value",
      "set",
      "new-safety",
    );
    expect(JSON.stringify(doc)).toBe(
      JSON.stringify(alertDoc()).replace('"old-safety"', '"new-safety"'),
    );
  });

  it("writes back a node as read, restoring defaults and nested rich text", () => {
    const read = readAtPath(alertDoc(), "content.1") as {
      fields: Record<string, unknown>;
    };
    read.fields.style = "info";
    const { doc } = editAtPath(alertDoc(), "content.1", "set", read);
    const expected = alertDoc();
    (expected.content.root.children[1] as ReturnType<typeof block>).fields.style = "info";
    expect(doc).toEqual(expected);
  });

  it("rejects an edited outline in place of nested rich text, naming the path to edit instead", () => {
    const read = readAtPath(alertDoc(), "content.1") as {
      fields: Record<string, unknown>;
    };
    read.fields.richText = ["content.1.fields.richText.0 p: something else"];
    expect(() => editAtPath(alertDoc(), "content.1", "set", read)).toThrow(
      /content\.1\.fields\.richText\.<index>/,
    );
  });

  it("builds a node from shorthand, given as an object or a JSON string, and answers its outline line", () => {
    const { doc, result } = editAtPath(
      linksDoc(),
      "content.0",
      "set",
      '{"type":"h2","text":"New"}',
    );
    expect(result).toEqual({ set: "content.0 h2: New" });
    expect(readAtPath(doc, "content.0")).toEqual({
      type: "heading",
      tag: "h2",
      version: 1,
      children: [{ type: "text", version: 1, text: "New" }],
    });
  });

  it("refuses shorthand that would drop the links of the node it replaces, pointing to its text", () => {
    const error = errorOf(() =>
      editAtPath(linksDoc(), "content.1", "set", { type: "p", text: "More on costs, entry" }),
    );

    expect(error?.code).toBe("UNSUPPORTED_AT_PATH");
    expect(error?.message).toContain("3 links");
    expect(error?.message).toContain("content.1.children.0.text");
  });

  it("refuses shorthand that would drop formatting", () => {
    const doc = { content: richText(paragraph({ ...text("Bold"), format: 1 })) };

    expect(codeOf(() => editAtPath(doc, "content.0", "set", { type: "p", text: "Bold" }))).toBe(
      "UNSUPPORTED_AT_PATH",
    );
  });

  it("replaces a node holding links when given the node with its children", () => {
    const { doc } = editAtPath(linksDoc(), "content.1", "set", paragraph(text("No links")));

    expect(readAtPath(doc, "content.1")).toMatchObject({ children: [{ text: "No links" }] });
  });

  it("gives a link node without a version the current link version", () => {
    const { doc } = editAtPath(linksDoc(), "content.0.children.0", "set", {
      type: "link",
      fields: { linkType: "internal", doc: { relationTo: "pages", value: "x" } },
      children: [{ type: "text", text: "Intro" }],
    });
    expect(readAtPath(doc, "content.0.children.0")).toMatchObject({ type: "link", version: 3 });
  });

  it("refuses to replace a whole rich-text field", () => {
    expect(codeOf(() => editAtPath(linksDoc(), "content", "set", {}))).toBe("UNSUPPORTED_AT_PATH");
  });

  it("rejects a node Payload would not accept", () => {
    expect(codeOf(() => editAtPath(linksDoc(), "content.0", "set", { text: "no type" }))).toBe(
      "INVALID_NODE",
    );
  });
});

describe("inserting and deleting by path", () => {
  it("inserts before an index and says which nodes moved", () => {
    const { doc, result } = editAtPath(linksDoc(), "content.1", "insert", {
      type: "h2",
      text: "Costs",
    });
    expect(result).toEqual({
      inserted: "content.1 h2: Costs",
      count: 3,
      note: "Nodes from content.1 on moved down by one.",
    });
    expect(readAtPath(doc, "content")).toEqual([
      "content.0 p: Intro",
      "content.1 h2: Costs",
      "content.2 p [3 links]: More on costs, entry and vaccinations",
    ]);
  });

  it("inserts a list of nodes at one index, in order", () => {
    const { doc, result } = editAtPath(linksDoc(), "content.1", "insert", [
      { type: "h2", text: "Costs" },
      { type: "p", text: "Fees vary." },
    ]);

    expect(result).toEqual({
      inserted: ["content.1 h2: Costs", "content.2 p: Fees vary."],
      count: 4,
      note: "Nodes from content.1 on moved down by 2.",
    });
    expect(readAtPath(doc, "content")).toEqual([
      "content.0 p: Intro",
      "content.1 h2: Costs",
      "content.2 p: Fees vary.",
      "content.3 p [3 links]: More on costs, entry and vaccinations",
    ]);
  });

  it("appends at index = count", () => {
    const { doc } = editAtPath(linksDoc(), "content.2", "insert", {
      type: "ul",
      items: ["a", "b"],
    });
    expect((readAtPath(doc, "content") as string[])[2]).toBe("content.2 ul (2 items): a; b");
  });

  it("gives inserted blocks an id", () => {
    const { doc } = editAtPath(linksDoc(), "content.0", "insert", {
      type: "block",
      fields: { blockType: "alert" },
    });
    expect((readAtPath(doc, "content.0.fields") as { id: string }).id).toMatch(/^[0-9a-f]{24}$/);
  });

  it("builds upload nodes from a media id", () => {
    const { doc } = editAtPath(linksDoc(), "content.0", "insert", {
      type: "upload",
      value: "media-1",
    });
    expect(readAtPath(doc, "content.0")).toMatchObject({
      type: "upload",
      relationTo: "media",
      value: "media-1",
    });
  });

  it("deletes a node and returns its outline line", () => {
    const { doc, result } = editAtPath(linksDoc(), "content.0", "delete");
    expect(result).toEqual({
      deleted: "content.0 p: Intro",
      count: 1,
      note: "Nodes after content.0 moved up by one.",
    });
    expect(readAtPath(doc, "content")).toEqual([
      "content.0 p [3 links]: More on costs, entry and vaccinations",
    ]);
  });

  it("refuses a copied block whose nested rich text is still an outline", () => {
    const read = readAtPath(alertDoc(), "content.1");
    expect(() => editAtPath(alertDoc(), "content.2", "insert", read)).toThrow(
      /content\.2\.fields\.richText.*"root"/,
    );
  });

  it("refuses an outline set where the stored node has no rich text to restore", () => {
    const read = readAtPath(alertDoc(), "content.1");
    expect(codeOf(() => editAtPath(alertDoc(), "content.0", "set", read))).toBe("INVALID_NODE");
  });

  it("copies a block given its nested rich text as nodes, under a fresh id", () => {
    const read = readAtPath(alertDoc(), "content.1") as {
      fields: Record<string, unknown>;
    };
    read.fields.richText = { root: { children: [{ type: "p", text: "Copied" }] } };
    const { doc } = editAtPath(alertDoc(), "content.2", "insert", read);

    expect(readAtPath(doc, "content")).toEqual([
      "content.0 p: Intro",
      "content.1 block alert [1 link]: See safety",
      "content.2 block alert: Copied",
    ]);
    const copy = readAtPath(doc, "content.2.fields") as { id: string };
    expect(copy.id).not.toBe("alert-1");
    expect(readAtPath(doc, "content.2.fields.richText.0")).toEqual({
      type: "paragraph",
      version: 1,
      children: [{ type: "text", version: 1, text: "Copied" }],
    });
  });

  it("gives a block set over another node a fresh id when its id is taken", () => {
    const read = readAtPath(alertDoc(), "content.1") as {
      fields: Record<string, unknown>;
    };
    read.fields.richText = { root: { children: [{ type: "p", text: "Copied" }] } };
    const { doc } = editAtPath(alertDoc(), "content.0", "set", read);
    const ids = [0, 1].map((i) => (readAtPath(doc, `content.${i}.fields`) as { id: string }).id);
    expect(ids[1]).toBe("alert-1");
    expect(ids[0]).not.toBe("alert-1");
  });

  it("keeps a block's id when it is set back in place", () => {
    const read = readAtPath(alertDoc(), "content.1");
    const { doc } = editAtPath(alertDoc(), "content.1", "set", read);
    expect((readAtPath(doc, "content.1.fields") as { id: string }).id).toBe("alert-1");
  });

  it("starts a block's empty nested rich text from nodes given as shorthand", () => {
    const doc = alertDoc();
    (doc.content.root.children[1] as ReturnType<typeof block>).fields.richText = null;
    const { doc: changed } = editAtPath(doc, "content.1.fields.richText", "set", {
      root: { children: [{ type: "h2", text: "Started" }] },
    });
    expect(readAtPath(changed, "content.1.fields.richText")).toEqual([
      "content.1.fields.richText.0 h2: Started",
    ]);
    expect(readAtPath(changed, "content.1.fields.richText.0.children.0")).toEqual({
      type: "text",
      version: 1,
      text: "Started",
    });
  });

  it("treats a block's own array field named children as data, not nodes", () => {
    const doc = {
      content: richText(block({ id: "b-1", blockType: "tabs", children: [{ label: "A" }] })),
    };
    expect(codeOf(() => editAtPath(doc, "content.0.fields.children.0", "insert", {}))).toBe(
      "UNSUPPORTED_AT_PATH",
    );
  });

  it("only inserts into a list of nodes", () => {
    expect(
      codeOf(() =>
        editAtPath(regionDoc(), "infoSections.0.richText.1.fields.items.0", "insert", {}),
      ),
    ).toBe("UNSUPPORTED_AT_PATH");
  });
});

describe("path errors", () => {
  it("refuses inherited keys, so a path can't reach Object.prototype", () => {
    const original = Object.prototype.hasOwnProperty;
    for (const path of [
      "content.0.__proto__.hasOwnProperty",
      "content.0.constructor.prototype.x",
    ]) {
      expect(codeOf(() => editAtPath(linksDoc(), path, "set", "pwned"))).toBe("PATH_NOT_FOUND");
    }
    expect(Object.prototype.hasOwnProperty).toBe(original);
    expect(codeOf(() => readAtPath(linksDoc(), "content.0.toString"))).toBe("PATH_NOT_FOUND");
  });

  it("names the valid range", () => {
    expect(() => readAtPath(linksDoc(), "content.7")).toThrow(/2 nodes \(0–1\)/);
  });

  it("names the available keys", () => {
    expect(() => readAtPath(alertDoc(), "content.1.fields.body")).toThrow(
      /id, blockType, style, richText/,
    );
  });

  it("points a path outside rich text to the rich-text fields below it", () => {
    expect(() => editAtPath(regionDoc(), "infoSections.0", "delete")).toThrow(
      /not inside rich text.*infoSections\.0\.richText/,
    );
  });
});
