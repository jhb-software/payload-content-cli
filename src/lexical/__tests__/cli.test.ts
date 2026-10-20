import { describe, it, expect, beforeEach, afterAll } from "vitest";
import { spawnSync, type SpawnSyncReturns } from "node:child_process";
import * as fs from "node:fs/promises";
import * as path from "node:path";

const CLI_ENTRY = path.resolve("src/cli.ts");
const TSX_BIN = path.resolve("node_modules/.bin/tsx");
const TMP = path.resolve(".tmp-lexical-cli-test");
const pagePath = path.join(TMP, "page.json");
const otherPath = path.join(TMP, "other.json");

function runCLI(args: string[], input?: string): SpawnSyncReturns<string> {
  return spawnSync(TSX_BIN, [CLI_ENTRY, "lexical", ...args], {
    encoding: "utf-8",
    input,
    env: {
      PAYLOAD_URL: "http://payload.invalid",
      PAYLOAD_API_KEY: "fake-key-for-local-tests",
      ...process.env,
    },
  });
}

const text = (value: string) => ({
  type: "text",
  version: 1,
  detail: 0,
  format: 0,
  mode: "normal",
  style: "",
  text: value,
});
const element = (type: string, children: unknown[], extra: Record<string, unknown> = {}) => ({
  type,
  version: 1,
  format: "",
  indent: 0,
  direction: "ltr",
  ...extra,
  children,
});
const paragraph = (...children: unknown[]) =>
  element("paragraph", children, { textFormat: 0, textStyle: "" });
const richText = (...children: unknown[]) => ({ root: element("root", children) });
const link = (label: string, id: string) =>
  element("link", [text(label)], {
    version: 3,
    id: `link-${id}`,
    fields: { linkType: "internal", newTab: false, doc: { relationTo: "pages", value: id } },
  });
const alert = (id: string, body: unknown) => ({
  type: "block",
  version: 2,
  format: "",
  fields: { id, blockType: "alert", body },
});

/** A page whose rich text sits in an array row and holds two alert blocks. */
const page = () => ({
  title: "Travel to Japan",
  layout: [
    { id: "row-0", blockType: "hero", heading: "Japan" },
    {
      id: "row-1",
      blockType: "content",
      richText: richText(
        element("heading", [text("Before you go")], { tag: "h2" }),
        paragraph(text("Check the entry rules before booking.")),
        alert("alert-1", richText(paragraph(text("Bring cash.")))),
        alert(
          "alert-2",
          richText(paragraph(text("See "), link("visa requirements", "visa"), text(" first."))),
        ),
      ),
    },
  ],
});

const field = "layout.1.richText";

async function readPage(file = pagePath) {
  return JSON.parse(await fs.readFile(file, "utf-8")) as ReturnType<typeof page>;
}

function outline(file = pagePath, at = field) {
  const result = runCLI(["read", file, at]);
  expect(result.status, result.stderr).toBe(0);
  return result.stdout.trim().split("\n");
}

describe("lexical CLI", () => {
  beforeEach(async () => {
    await fs.mkdir(TMP, { recursive: true });
    await fs.writeFile(pagePath, JSON.stringify(page(), null, 2));
  });

  afterAll(async () => {
    await fs.rm(TMP, { recursive: true, force: true });
  });

  it("lists every rich-text field with its outline when no path is given", () => {
    const result = runCLI(["read", pagePath]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim().split("\n")).toEqual([
      `${field}.0 h2: Before you go`,
      `${field}.1 p: Check the entry rules before booking.`,
      `${field}.2 block alert: Bring cash.`,
      `${field}.3 block alert [1 link]: See [visa requirements] first.`,
    ]);
  });

  it("reaches the rich text of the second of two blocks of the same type", () => {
    expect(outline(pagePath, `${field}.3.fields.body`)).toEqual([
      `${field}.3.fields.body.0 p [1 link]: See [visa requirements] first.`,
    ]);
  });

  it("retargets a link inside a block with one path and saves the file", async () => {
    const result = runCLI([
      "set",
      pagePath,
      `${field}.3.fields.body.0.children.1.fields.doc.value`,
      "new-visa",
    ]);
    expect(result.status, result.stderr).toBe(0);

    const saved = JSON.stringify(await readPage());
    expect(saved).toContain('"value":"new-visa"');
    expect(saved).not.toContain('"value":"visa"');
  });

  it("refuses to set a key the node doesn't have, naming the ones it has", () => {
    const result = runCLI(["set", pagePath, `${field}.0.colour`, "red"]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/No "colour" in layout\.1\.richText\.0\. It has: .*tag/);
  });

  it("inserts a shorthand node at an index and reports which nodes moved", async () => {
    const result = runCLI([
      "insert",
      pagePath,
      `${field}.2`,
      '{"type":"p","text":"Japan uses type A plugs."}',
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ count: 5, note: expect.any(String) });
    expect(outline()[2]).toBe(`${field}.2 p: Japan uses type A plugs.`);
  });

  it("deletes a node", () => {
    const result = runCLI(["delete", pagePath, `${field}.2`]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({
      deleted: `${field}.2 block alert: Bring cash.`,
      count: 3,
    });
    expect(outline()).toHaveLength(3);
  });

  it("copies a block between files by piping read --full into insert", async () => {
    await fs.writeFile(otherPath, JSON.stringify({ content: richText(paragraph(text("Hi"))) }));
    const read = runCLI(["read", pagePath, `${field}.3`, "--full"]);
    expect(read.status, read.stderr).toBe(0);

    const insert = runCLI(["insert", otherPath, "content.1", "--json", "-"], read.stdout);
    expect(insert.status, insert.stderr).toBe(0);

    expect(outline(otherPath, "content")).toEqual([
      "content.0 p: Hi",
      "content.1 block alert [1 link]: See [visa requirements] first.",
    ]);
  });

  it("leaves the file untouched when the new node is invalid", async () => {
    const before = await fs.readFile(pagePath, "utf-8");
    const result = runCLI(["insert", pagePath, `${field}.0`, '{"type":"block","fields":{}}']);
    expect(result.status).toBe(1);
    expect(await fs.readFile(pagePath, "utf-8")).toBe(before);
  });

  it("names the valid range for an index that doesn't exist", () => {
    const result = runCLI(["read", pagePath, `${field}.9`]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/4 nodes \(0–3\)/);
  });

  it("searches every rich-text value, nested ones included, and prints full paths", () => {
    const result = runCLI(["search", pagePath, "--text", "cash"]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout.trim()).toBe(`[${field}.2.fields.body.0.children.0] "Bring cash."`);
  });

  it("links text anywhere in the document and prints the new link's path", async () => {
    const result = runCLI([
      "link",
      pagePath,
      "--text",
      "entry rules",
      "--relationTo",
      "pages",
      "--value",
      "entry",
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.parse(result.stdout)).toMatchObject({ linked: `${field}.1.children.1` });
    expect(outline()[1]).toBe(`${field}.1 p [1 link]: Check the [entry rules] before booking.`);
  });

  it("links only inside the path when one is given", async () => {
    const result = runCLI([
      "link",
      pagePath,
      `${field}.3`,
      "--text",
      "entry rules",
      "--relationTo",
      "pages",
      "--value",
      "entry",
    ]);
    expect(result.status).toBe(1);
    expect(result.stderr).toMatch(/No unlinked "entry rules" in layout\.1\.richText\.3/);
  });

  it("copies a link's target from another file by the link's path", async () => {
    await fs.writeFile(
      otherPath,
      JSON.stringify({ content: richText(paragraph(text("Read about visa requirements."))) }),
    );
    const result = runCLI([
      "link",
      otherPath,
      "--from",
      pagePath,
      "--link",
      `${field}.3.fields.body.0.children.1`,
    ]);
    expect(result.status, result.stderr).toBe(0);
    expect(JSON.stringify(await readPage(otherPath))).toContain('"value":"visa"');
  });

  it("diffs two files and names links by their full path", async () => {
    const target = page();
    target.layout[1].richText = richText(paragraph(text("Nothing linked here.")));
    await fs.writeFile(otherPath, JSON.stringify(target));
    const result = runCLI(["diff", pagePath, otherPath]);
    expect(result.status, result.stderr).toBe(0);
    expect(result.stdout).toContain(`[${field}.3.fields.body.0.children.1] "visa requirements"`);
  });
});
