import { describe, it, expect } from "vitest";
import { toFieldSchemas } from "../index.js";

describe("toFieldSchemas", () => {
  it("extracts basic named fields", () => {
    const fields = [
      { name: "title", type: "text", required: true },
      { name: "body", type: "richText" },
    ];
    expect(toFieldSchemas(fields)).toEqual([
      { name: "title", type: "text", required: true },
      { name: "body", type: "richText" },
    ]);
  });

  it("hoists fields from unnamed tabs", () => {
    const fields = [
      {
        type: "tabs",
        tabs: [
          {
            label: "Content",
            fields: [
              { name: "title", type: "text" },
              { name: "body", type: "richText" },
            ],
          },
          {
            label: "Meta",
            fields: [{ name: "slug", type: "text" }],
          },
        ],
      },
    ];
    expect(toFieldSchemas(fields)).toEqual([
      { name: "title", type: "text" },
      { name: "body", type: "richText" },
      { name: "slug", type: "text" },
    ]);
  });

  it("keeps named tabs as nested groups", () => {
    const fields = [
      {
        type: "tabs",
        tabs: [
          {
            name: "meta",
            fields: [
              { name: "slug", type: "text" },
              { name: "description", type: "textarea" },
            ],
          },
        ],
      },
    ];
    expect(toFieldSchemas(fields)).toEqual([
      {
        name: "meta",
        type: "tab",
        fields: [
          { name: "slug", type: "text" },
          { name: "description", type: "textarea" },
        ],
      },
    ]);
  });

  it("handles mix of named and unnamed tabs", () => {
    const fields = [
      {
        type: "tabs",
        tabs: [
          {
            label: "Content",
            fields: [{ name: "title", type: "text" }],
          },
          {
            name: "seo",
            fields: [{ name: "metaTitle", type: "text" }],
          },
        ],
      },
    ];
    expect(toFieldSchemas(fields)).toEqual([
      { name: "title", type: "text" },
      {
        name: "seo",
        type: "tab",
        fields: [{ name: "metaTitle", type: "text" }],
      },
    ]);
  });

  it("hoists fields from unnamed rows", () => {
    const fields = [
      {
        type: "row",
        fields: [
          { name: "firstName", type: "text" },
          { name: "lastName", type: "text" },
        ],
      },
    ];
    expect(toFieldSchemas(fields)).toEqual([
      { name: "firstName", type: "text" },
      { name: "lastName", type: "text" },
    ]);
  });

  it("hoists fields from unnamed collapsibles", () => {
    const fields = [
      {
        type: "collapsible",
        label: "Advanced",
        fields: [
          { name: "cssClass", type: "text" },
          { name: "anchor", type: "text" },
        ],
      },
    ];
    expect(toFieldSchemas(fields)).toEqual([
      { name: "cssClass", type: "text" },
      { name: "anchor", type: "text" },
    ]);
  });

  it("hoists fields from unnamed groups", () => {
    const fields = [
      {
        type: "group",
        label: "Hero",
        fields: [
          { name: "heading", type: "text" },
          { name: "description", type: "textarea" },
        ],
      },
    ];
    expect(toFieldSchemas(fields)).toEqual([
      { name: "heading", type: "text" },
      { name: "description", type: "textarea" },
    ]);
  });

  it("keeps named groups as nested", () => {
    const fields = [
      {
        name: "hero",
        type: "group",
        fields: [{ name: "heading", type: "text" }],
      },
    ];
    expect(toFieldSchemas(fields)).toEqual([
      {
        name: "hero",
        type: "group",
        fields: [{ name: "heading", type: "text" }],
      },
    ]);
  });

  it("handles nested tabs inside collapsibles", () => {
    const fields = [
      {
        type: "collapsible",
        label: "Details",
        fields: [
          {
            type: "tabs",
            tabs: [
              {
                label: "Info",
                fields: [{ name: "info", type: "text" }],
              },
            ],
          },
        ],
      },
    ];
    expect(toFieldSchemas(fields)).toEqual([{ name: "info", type: "text" }]);
  });

  it("resolves blockReferences from blocksBySlug", () => {
    const blocksBySlug = {
      quote: {
        slug: "quote",
        fields: [{ name: "quoteText", type: "text", required: true }],
      },
      cta: {
        slug: "cta",
        fields: [{ name: "buttonText", type: "text" }],
      },
    };
    const fields = [
      {
        name: "layout",
        type: "blocks",
        blocks: [],
        blockReferences: ["quote", "cta"],
      },
    ];
    expect(toFieldSchemas(fields, blocksBySlug)).toEqual([
      {
        name: "layout",
        type: "blocks",
        blocks: [
          {
            slug: "quote",
            fields: [{ name: "quoteText", type: "text", required: true }],
          },
          {
            slug: "cta",
            fields: [{ name: "buttonText", type: "text" }],
          },
        ],
      },
    ]);
  });

  it("merges inline blocks with blockReferences", () => {
    const blocksBySlug = {
      cta: {
        slug: "cta",
        fields: [{ name: "buttonText", type: "text" }],
      },
    };
    const fields = [
      {
        name: "layout",
        type: "blocks",
        blocks: [
          {
            slug: "hero",
            fields: [{ name: "heading", type: "text" }],
          },
        ],
        blockReferences: ["cta"],
      },
    ];
    expect(toFieldSchemas(fields, blocksBySlug)).toEqual([
      {
        name: "layout",
        type: "blocks",
        blocks: [
          {
            slug: "hero",
            fields: [{ name: "heading", type: "text" }],
          },
          {
            slug: "cta",
            fields: [{ name: "buttonText", type: "text" }],
          },
        ],
      },
    ]);
  });

  it("skips unresolvable blockReferences", () => {
    const fields = [
      {
        name: "layout",
        type: "blocks",
        blocks: [],
        blockReferences: ["nonexistent"],
      },
    ];
    expect(toFieldSchemas(fields, {})).toEqual([{ name: "layout", type: "blocks" }]);
  });

  it("handles blockReferences as objects with slug", () => {
    const blocksBySlug = {
      quote: {
        slug: "quote",
        fields: [{ name: "text", type: "text" }],
      },
    };
    const fields = [
      {
        name: "content",
        type: "blocks",
        blocks: [],
        blockReferences: [{ slug: "quote" }],
      },
    ];
    expect(toFieldSchemas(fields, blocksBySlug)).toEqual([
      {
        name: "content",
        type: "blocks",
        blocks: [
          {
            slug: "quote",
            fields: [{ name: "text", type: "text" }],
          },
        ],
      },
    ]);
  });

  it("emits block slugs instead of inlining fields in reference mode", () => {
    const blocksBySlug: Record<string, any> = {
      cta: { slug: "cta", fields: [{ name: "buttonText", type: "text" }] },
    };
    const fields = [
      {
        name: "layout",
        type: "blocks",
        blocks: [{ slug: "hero", fields: [{ name: "heading", type: "text" }] }],
        blockReferences: ["cta"],
      },
    ];
    expect(toFieldSchemas(fields, blocksBySlug, { blocks: "reference" })).toEqual([
      { name: "layout", type: "blocks", blockSlugs: ["hero", "cta"] },
    ]);
  });

  it("registers inline block definitions so a later lookup can resolve the slugs", () => {
    // Blocks declared inline on the field exist nowhere in config.blocks, so
    // referencing them is only safe if the projection registers them.
    const blocksBySlug: Record<string, any> = {};
    toFieldSchemas(
      [
        {
          name: "layout",
          type: "blocks",
          blocks: [{ slug: "hero", fields: [{ name: "heading", type: "text" }] }],
        },
      ],
      blocksBySlug,
      { blocks: "reference" },
    );
    expect(blocksBySlug.hero?.fields).toEqual([{ name: "heading", type: "text" }]);
  });

  it("references blocks nested inside groups and arrays too", () => {
    const blocksBySlug: Record<string, any> = {};
    const fields = [
      {
        name: "sections",
        type: "array",
        fields: [
          {
            name: "layout",
            type: "blocks",
            blocks: [{ slug: "hero", fields: [] }],
          },
        ],
      },
    ];
    expect(toFieldSchemas(fields, blocksBySlug, { blocks: "reference" })).toEqual([
      {
        name: "sections",
        type: "array",
        fields: [{ name: "layout", type: "blocks", blockSlugs: ["hero"] }],
      },
    ]);
  });

  it("includes static defaultValues but skips function defaults", () => {
    const fields = [
      { name: "title", type: "text", defaultValue: "Untitled" },
      { name: "tags", type: "array", defaultValue: [{ tag: "draft" }] },
      { name: "publishedAt", type: "date", defaultValue: () => new Date() },
    ];
    expect(toFieldSchemas(fields)).toEqual([
      { name: "title", type: "text", defaultValue: "Untitled" },
      { name: "tags", type: "array", defaultValue: [{ tag: "draft" }] },
      { name: "publishedAt", type: "date" },
    ]);
  });

  it("marks join fields as virtual so pulls strip them", () => {
    const fields = [
      { name: "title", type: "text" },
      { name: "relatedPosts", type: "join", collection: "posts", on: "category" },
    ];
    expect(toFieldSchemas(fields)).toEqual([
      { name: "title", type: "text" },
      { name: "relatedPosts", type: "join", virtual: true },
    ]);
  });

  it("marks fields Payload injects as system", () => {
    const fields = [
      { name: "title", type: "text" },
      { name: "createdAt", type: "date" },
      { name: "updatedAt", type: "date" },
      { name: "_status", type: "select", options: ["draft", "published"] },
      { name: "blockName", type: "text" },
    ];
    expect(toFieldSchemas(fields)).toEqual([
      { name: "title", type: "text" },
      { name: "createdAt", type: "date", system: true },
      { name: "updatedAt", type: "date", system: true },
      {
        name: "_status",
        type: "select",
        system: true,
        options: [
          { label: "draft", value: "draft" },
          { label: "published", value: "published" },
        ],
      },
      { name: "blockName", type: "text", system: true },
    ]);
  });

  it("marks generated row ids as system but keeps a custom collection ID field", () => {
    // Payload's baseIDField (array/block rows) is hidden and self-populating;
    // a custom collection ID field is author-declared and must be set on create,
    // so hiding it would hide the one field a create can't omit.
    const [customId, rows] = toFieldSchemas([
      { name: "id", type: "text", required: true },
      {
        name: "rows",
        type: "array",
        fields: [
          // as Payload's baseIDField appears on a sanitized config
          { name: "id", type: "text", admin: { hidden: true }, defaultValue: () => "generated" },
          { name: "label", type: "text" },
        ],
      },
    ]);
    expect(customId).toEqual({ name: "id", type: "text", required: true });
    expect(rows?.fields).toEqual([
      { name: "id", type: "text", system: true },
      { name: "label", type: "text" },
    ]);
  });

  it("flags fields gated by an admin condition", () => {
    const fields = [
      { name: "type", type: "select", options: ["internal"] },
      { name: "url", type: "text", admin: { condition: () => true } },
      { name: "label", type: "text", admin: { description: "no condition" } },
    ];
    const [, url, label] = toFieldSchemas(fields);
    expect(url?.hasCondition).toBe(true);
    expect(label?.hasCondition).toBeUndefined();
  });

  it("includes static filterOptions but skips function forms", () => {
    const fields = [
      {
        name: "favicon",
        type: "upload",
        relationTo: "media",
        filterOptions: { mimeType: { equals: "image/svg+xml" } },
      },
      {
        name: "related",
        type: "relationship",
        relationTo: "posts",
        filterOptions: () => ({ status: { equals: "published" } }),
      },
    ];
    expect(toFieldSchemas(fields)).toEqual([
      {
        name: "favicon",
        type: "upload",
        relationTo: "media",
        filterOptions: { mimeType: { equals: "image/svg+xml" } },
      },
      { name: "related", type: "relationship", relationTo: "posts" },
    ]);
  });

  it("skips unnamed fields without layout semantics", () => {
    const fields = [
      { type: "ui", admin: { components: {} } },
      { name: "title", type: "text" },
    ];
    expect(toFieldSchemas(fields)).toEqual([{ name: "title", type: "text" }]);
  });
});
