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

  it("includes static defaultValues but skips function defaults", () => {
    const fields = [
      { name: "title", type: "text", defaultValue: "Untitled" },
      { name: "tags", type: "array", defaultValue: [{ tag: "draft" }] },
      { name: "createdAt", type: "date", defaultValue: () => new Date() },
    ];
    expect(toFieldSchemas(fields)).toEqual([
      { name: "title", type: "text", defaultValue: "Untitled" },
      { name: "tags", type: "array", defaultValue: [{ tag: "draft" }] },
      { name: "createdAt", type: "date" },
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
