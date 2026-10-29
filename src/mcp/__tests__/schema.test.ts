import { BlocksFeature, LinkFeature, lexicalEditor } from "@payloadcms/richtext-lexical";
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
  // Payload 4's default: a field inside a localized one keeps `localized`.
  process.env.PAYLOAD_DO_NOT_SANITIZE_LOCALIZED_PROPERTY = "true";
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
      { slug: "cta", fields: [{ name: "label", type: "text", localized: true }] },
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
          {
            name: "faq",
            type: "array",
            fields: [{ name: "q", type: "text", localized: true }],
          },
          {
            name: "gallery",
            type: "array",
            localized: true,
            fields: [{ name: "caption", type: "text", localized: true }],
          },
          {
            type: "tabs",
            tabs: [
              {
                name: "seo",
                localized: true,
                fields: [
                  {
                    name: "keywords",
                    type: "array",
                    fields: [{ name: "k", type: "text", localized: true }],
                  },
                ],
              },
            ],
          },
        ],
      },
      {
        slug: "products",
        access: open,
        fields: [
          {
            name: "body",
            type: "richText",
            editor: lexicalEditor({
              features: [
                LinkFeature({
                  fields: ({ defaultFields }) => [
                    ...defaultFields,
                    { name: "rel", type: "select", options: ["nofollow", "sponsored"] },
                  ],
                }),
              ],
            }),
          },
          // Maintained by the app: hidden and read-only, yet find returns them.
          { name: "price", type: "number", admin: { hidden: true, readOnly: true } },
          {
            name: "meta",
            type: "group",
            fields: [
              { name: "title", type: "text" },
              {
                name: "alternatePaths",
                type: "array",
                admin: { hidden: true, readOnly: true },
                fields: [{ name: "path", type: "text" }],
              },
            ],
          },
        ],
      },
      { slug: "authors", access: open, fields: [{ name: "name", type: "text" }] },
      { slug: "secrets", access: { read: () => false }, fields: [{ name: "x", type: "text" }] },
    ],
    globals: [{ slug: "footer", access: open, fields: [{ name: "note", type: "text" }] }],
  });
  delete process.env.PAYLOAD_DO_NOT_SANITIZE_LOCALIZED_PROPERTY;
});

describe("listEntities", () => {
  it("lists what the user may read, globals addressable as globals/<slug>, and the locales", async () => {
    const result = await call(payload, listEntities, {}, { id: 1, collection: "users" });

    expect(result).toEqual({
      collections: ["pages", "products", "authors", "users"],
      globals: ["globals/footer"],
      locales: ["en", "de"],
      defaultLocale: "en",
    });
  });
});

describe("getEntitySchema", () => {
  it("answers one line per field: required, lists, options, targets, defaults, locales, shared rows, conditions", async () => {
    const tree = await call(payload, getEntitySchema, { collection: "pages" });

    expect(tree).toBe(
      [
        "pages (collection)",
        "  title*: text (localized)",
        '  theme: select (light | dark) = "light"',
        '  accent: text [when {"field":"theme","equals":"dark"}]',
        "  author: relationship → authors",
        "  layout[]: blocks (hero | cta) (shared rows)",
        "  body: richText",
        "    ✎ text formats: bold, code, italic, strikethrough, subscript, superscript, underline",
        "    ✎ block nodes: paragraph, heading (h1, h2, h3, h4, h5, h6), quote, list (bullet, check, number), horizontalrule, upload, relationship, block (alert)",
        "    ✎ inline nodes: link",
        "    ✎ layout: align, indent",
        "  links[]: array",
        "    url: text",
        "  faq[]: array (shared rows)",
        "    q: text (localized)",
        "  gallery[]: array (localized)",
        "    caption: text (localized)",
        "  seo: tab (localized)",
        "    keywords[]: array",
        "      k: text (localized)",
      ].join("\n"),
    );
  });

  it("names the fields an app maintains, which find returns but nothing may write", async () => {
    const tree = (await call(payload, getEntitySchema, { collection: "products" })) as string;

    expect(tree.split("\n").at(-1)).toBe("  read-only: price, meta.alternatePaths");
    expect(tree).not.toMatch(/createdAt|updatedAt|\bid\b/);
  });

  it("lists the fields a link takes beyond the built-in ones", async () => {
    const tree = (await call(payload, getEntitySchema, { collection: "products" })) as string;

    expect(tree).toContain(
      ["    ✎ inline nodes: link", "        rel: select (nofollow | sponsored)"].join("\n"),
    );
    expect(tree).not.toMatch(/linkType|newTab/);
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

  it("suggests the slug an agent meant by a block's config name", async () => {
    const result = await call(payload, getBlockSchema, { slugs: ["HeroBlock"] });

    expect(result.error).toMatch(/"HeroBlock" → "hero"/);
    expect(result.error).toMatch(/blockSlugs/);
  });

  it("still lists the valid slugs when only some names are close", async () => {
    const result = await call(payload, getBlockSchema, { slugs: ["HeroBlock", "nope"] });

    expect(result.error).toMatch(/"HeroBlock" → "hero"/);
    expect(result.error).toMatch(/Valid slugs: alert, cta, hero\./);
  });

  it("lists the valid slugs, and where a field's own are, when nothing is close", async () => {
    const result = await call(payload, getBlockSchema, { slugs: ["nope"] });

    expect(result.error).toMatch(/Valid slugs: alert, cta, hero\./);
    expect(result.error).toMatch(/blockSlugs/);
  });
});

describe("tool annotations", () => {
  it("tell clients no tool reaches beyond the app's own content", () => {
    const openWorld = tools.filter((tool) => tool.annotations?.openWorldHint !== false);

    expect(openWorld.map((tool) => tool.name)).toEqual([]);
  });
});
