import { describe, it, expect, vi } from "vitest";
import { Readable } from "node:stream";
import {
  buildText,
  buildParagraph,
  buildHeading,
  parseNodeArg,
} from "../nodes.js";

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
    await expect(parseNodeArg({ json: "not json" })).rejects.toThrow(
      "Invalid JSON",
    );
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
});
