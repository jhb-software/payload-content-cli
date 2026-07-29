import { describe, it, expect, vi } from "vitest";
import { Readable } from "node:stream";
import {
  buildText,
  buildParagraph,
  buildHeading,
  buildList,
  buildHorizontalRule,
  buildBlock,
  buildElement,
  buildInternalLink,
  parseNodeArg,
} from "../nodes.js";
import { validateTree } from "../validate.js";

describe("buildText", () => {
  it("creates a valid text node", () => {
    const node = buildText("Hello");
    expect(node.type).toBe("text");
    expect(node.text).toBe("Hello");
    expect(node.version).toBe(1);
    expect(node.format).toBe(0);
    expect(node.mode).toBe("normal");
  });
});

describe("buildParagraph", () => {
  it("creates a paragraph with a text child", () => {
    const node = buildParagraph("Hello world");
    expect(node.type).toBe("paragraph");
    expect(node.children).toHaveLength(1);
    expect(node.children[0].type).toBe("text");
    expect(node.children[0].text).toBe("Hello world");
    expect(node.version).toBe(1);
    expect(node.direction).toBe("ltr");
  });
});

describe("buildHeading", () => {
  it("defaults to h2", () => {
    const node = buildHeading("Title");
    expect(node.type).toBe("heading");
    expect(node.tag).toBe("h2");
    expect(node.children).toHaveLength(1);
  });

  it("accepts custom tag", () => {
    const node = buildHeading("Title", "h3");
    expect(node.tag).toBe("h3");
  });

  it("rejects an invalid heading tag", () => {
    expect(() => buildHeading("Title", "h7")).toThrow(/Invalid heading tag "h7"/);
    expect(() => buildHeading("Title", "div")).toThrow(/Invalid heading tag/);
  });
});

describe("buildList", () => {
  it("builds a bullet list whose items Payload can render", () => {
    const node = buildList(["first", "second"]);
    expect(node).toEqual({
      type: "list",
      listType: "bullet",
      tag: "ul",
      start: 1,
      children: [
        {
          type: "listitem",
          value: 1,
          children: [buildText("first")],
          direction: "ltr",
          format: "",
          indent: 0,
          version: 1,
        },
        {
          type: "listitem",
          value: 2,
          children: [buildText("second")],
          direction: "ltr",
          format: "",
          indent: 0,
          version: 1,
        },
      ],
      direction: "ltr",
      format: "",
      indent: 0,
      version: 1,
    });
  });

  it("builds a numbered list", () => {
    const node = buildList(["only"], "number");
    expect(node.listType).toBe("number");
    expect(node.tag).toBe("ol");
  });

  it("rejects an unknown list type", () => {
    expect(() => buildList(["a"], "bulleted" as never)).toThrow(/Invalid list type "bulleted"/);
  });
});

describe("inline children", () => {
  it("accepts pre-built inline nodes instead of plain text", () => {
    const link = buildInternalLink("docs", "pages", "42");
    const node = buildParagraph([buildText("see "), link]);

    expect(node.children).toEqual([buildText("see "), link]);
  });

  it("accepts them for headings and list items too", () => {
    const heading = buildHeading([buildText("Title")], "h3");
    expect(heading.children).toEqual([buildText("Title")]);

    const list = buildList([[buildText("item")]]);
    expect(list.children[0].children).toEqual([buildText("item")]);
  });
});

describe("buildElement", () => {
  it("builds an arbitrary element node with the base props Payload expects", () => {
    const node = buildElement("customBlock", [buildText("inner")]);

    expect(node).toEqual({
      type: "customBlock",
      children: [buildText("inner")],
      direction: "ltr",
      format: "",
      indent: 0,
      version: 1,
    });
  });

  it("defaults to no children", () => {
    expect(buildElement("spacer").children).toEqual([]);
  });
});

describe("buildHorizontalRule", () => {
  it("builds the leaf node Payload serializes", () => {
    expect(buildHorizontalRule()).toEqual({ type: "horizontalrule", version: 1 });
  });
});

describe("buildBlock", () => {
  it("wraps block fields in a block node", () => {
    const node = buildBlock({ blockType: "cta", label: "Read more" });
    expect(node).toEqual({
      type: "block",
      fields: { blockType: "cta", label: "Read more" },
      format: "",
      version: 2,
    });
  });

  it("rejects fields without a blockType, which Payload cannot resolve", () => {
    expect(() => buildBlock({ label: "orphan" })).toThrow(/blockType/);
  });
});

describe("built nodes", () => {
  it("pass tree validation, so they can be written without a fixup step", () => {
    expect(
      validateTree([
        buildParagraph("text"),
        buildHeading("Title"),
        buildList(["a", "b"], "number"),
        buildHorizontalRule(),
        buildBlock({ blockType: "cta" }),
      ]),
    ).toEqual([]);
  });
});

describe("parseNodeArg", () => {
  it("builds paragraph from --paragraph", async () => {
    const node = await parseNodeArg({ paragraph: "Test" });
    expect(node.type).toBe("paragraph");
  });

  it("builds heading from --heading", async () => {
    const node = await parseNodeArg({ heading: "Title", tag: "h3" });
    expect(node.type).toBe("heading");
    expect(node.tag).toBe("h3");
  });

  it("builds text from --text", async () => {
    const node = await parseNodeArg({ text: "Hello" });
    expect(node.type).toBe("text");
  });

  it("parses raw JSON from --json", async () => {
    const json = '{"type":"paragraph","children":[],"version":1}';
    const node = await parseNodeArg({ json });
    expect(node.type).toBe("paragraph");
  });

  it("throws on invalid JSON", async () => {
    await expect(parseNodeArg({ json: "not json" })).rejects.toThrow("Invalid JSON");
  });

  it("reads JSON from stdin when --json is -", async () => {
    const json = '{"type":"paragraph","children":[],"version":1}';
    const mockStdin = Readable.from([json]);
    vi.spyOn(process, "stdin", "get").mockReturnValue(mockStdin as never);

    const node = await parseNodeArg({ json: "-" });
    expect(node.type).toBe("paragraph");

    vi.restoreAllMocks();
  });

  it("throws when no input provided", async () => {
    await expect(parseNodeArg({})).rejects.toThrow("Node input required");
  });

  it("rejects more than one node input option", async () => {
    await expect(parseNodeArg({ paragraph: "a", heading: "b" })).rejects.toThrow(/only one of/);
    await expect(parseNodeArg({ text: "a", json: "{}" })).rejects.toThrow(/only one of/);
  });
});
