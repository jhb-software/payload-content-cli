import { BlocksFeature, lexicalEditor } from "@payloadcms/richtext-lexical";
import type { Payload } from "payload";
import { beforeAll, describe, expect, it } from "vitest";
import { createMcpContentTools } from "../index.js";
import { boot, call, open, toolNamed } from "./payload.js";

const tools = createMcpContentTools();
const listEntities = toolNamed(tools, "listEntities");
const getEntitySchema = toolNamed(tools, "getEntitySchema");
const getBlockSchema = toolNamed(tools, "getBlockSchema");

const editor = lexicalEditor({
  features: ({ defaultFeatures }) => [
    ...defaultFeatures,
    BlocksFeature({
      blocks: [{ slug: "alert", fields: [{ name: "style", type: "text", required: true }] }],
    }),
  ],
});

let payload: Payload;

beforeAll(async () => {
  payload = await boot("mcp-schema", {
    localization: { locales: ["en", "de"], defaultLocale: "en" },
    blocks: [
      {
        slug: "hero",
        fields: [
          { name: "heading", type: "text", required: true, localized: true },
          { name: "cards", type: "blocks", blockReferences: ["cta"], blocks: [] },
        ],
      },
      { slug: "cta", fields: [{ name: "label", type: "text" }] },
    ],
    collections: [
      {
        slug: "pages",
        access: open,
        versions: { drafts: true },
        fields: [
          { name: "title", type: "text", required: true, localized: true },
          {
            name: "theme",
            type: "select",
            options: ["light", "dark"],
            defaultValue: "light",
          },
          {
            name: "accent",
            type: "text",
            admin: {
              condition: (_, siblings) => siblings.theme === "dark",
              custom: { condition: { field: "theme", equals: "dark" } },
            },
          },
          { name: "author", type: "relationship", relationTo: "authors" },
          { name: "layout", type: "blocks", blockReferences: ["hero", "cta"], blocks: [] },
          { name: "body", type: "richText", editor },
          {
            name: "links",
            type: "array",
            fields: [{ name: "url", type: "text" }],
          },
        ],
      },
      { slug: "authors", access: open, fields: [{ name: "name", type: "text" }] },
      { slug: "secrets", access: { read: () => false }, fields: [{ name: "x", type: "text" }] },
    ],
    globals: [{ slug: "footer", access: open, fields: [{ name: "note", type: "text" }] }],
  });
});

describe("listEntities", () => {
  it("lists what the user may read, globals addressable as globals/<slug>, and the locales", async () => {
    const result = await call(payload, listEntities, {}, { id: 1, collection: "users" });

    expect(result).toEqual({
      collections: ["pages", "authors", "users"],
      globals: ["globals/footer"],
      locales: ["en", "de"],
      defaultLocale: "en",
    });
  });
});

describe("getEntitySchema", () => {
  it("answers one line per field: required, lists, options, targets, defaults, locales, conditions", async () => {
    const tree = await call(payload, getEntitySchema, { collection: "pages" });

    expect(tree).toBe(
      [
        "pages (collection)",
        "  title*: text (localized)",
        '  theme: select (light | dark) = "light"',
        '  accent: text [when {"field":"theme","equals":"dark"}]',
        "  author: relationship → authors",
        "  layout[]: blocks (hero | cta)",
        "  body: richText",
        "    ✎ text formats: bold, code, italic, strikethrough, subscript, superscript, underline",
        "    ✎ block nodes: paragraph, heading (h1, h2, h3, h4, h5, h6), quote, list (bullet, check, number), horizontalrule, upload, relationship, block (alert)",
        "    ✎ inline nodes: link",
        "    ✎ layout: align, indent",
        "  links[]: array",
        "    url: text",
      ].join("\n"),
    );
  });

  it("reads a global addressed as globals/<slug>", async () => {
    const tree = await call(payload, getEntitySchema, { collection: "globals/footer" });

    expect(tree).toBe("footer (global)\n  note: text");
  });

  it("refuses an entity the user can't read, naming it", async () => {
    const result = await call(payload, getEntitySchema, { collection: "secrets" });

    expect(result.error).toMatch(/secrets/);
  });
});

describe("getBlockSchema", () => {
  it("resolves several blocks in one call, keeping their nested blocks as slugs", async () => {
    const tree = await call(payload, getBlockSchema, { slugs: ["hero", "alert"] });

    expect(tree).toBe(
      [
        "hero (block)",
        "  heading*: text (localized)",
        "  cards[]: blocks (cta)",
        "",
        "alert (block)",
        "  style*: text",
      ].join("\n"),
    );
  });

  it("names the unknown slugs", async () => {
    const result = await call(payload, getBlockSchema, { slugs: ["hero", "nope"] });

    expect(result.error).toMatch(/"nope"/);
  });
});

describe("tool annotations", () => {
  it("tell clients no tool reaches beyond the app's own content", () => {
    const openWorld = tools.filter((tool) => tool.annotations?.openWorldHint !== false);

    expect(openWorld.map((tool) => tool.name)).toEqual([]);
  });
});
