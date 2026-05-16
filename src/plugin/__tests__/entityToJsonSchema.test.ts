import { describe, it, expect } from "vitest";
import { entityToJsonSchema } from "../index.js";

describe("entityToJsonSchema", () => {
  it("maps scalar field types and marks optional ones nullable", () => {
    const schema = entityToJsonSchema("posts", [
      { name: "title", type: "text", required: true },
      { name: "body", type: "textarea" },
      { name: "views", type: "number" },
      { name: "published", type: "checkbox" },
      { name: "publishedAt", type: "date" },
    ]);

    expect(schema.type).toBe("object");
    expect(schema.title).toBe("posts");
    expect(schema.$schema).toBe("http://json-schema.org/draft-07/schema#");
    expect(schema.properties!.title).toEqual({ type: "string" });
    expect(schema.properties!.body).toEqual({ type: ["string", "null"] });
    expect(schema.properties!.views).toEqual({ type: ["number", "null"] });
    expect(schema.properties!.published).toEqual({
      type: ["boolean", "null"],
    });
    expect(schema.properties!.publishedAt).toEqual({
      type: ["string", "null"],
      format: "date-time",
    });
    expect(schema.required).toEqual(["title"]);
  });

  it("includes system fields and $schema in top-level properties", () => {
    const schema = entityToJsonSchema("posts", []);
    expect(schema.properties!.$schema).toEqual({ type: "string" });
    expect(schema.properties!.id).toEqual({ type: ["string", "number"] });
    expect(schema.properties!.createdAt).toEqual({
      type: "string",
      format: "date-time",
    });
    expect(schema.properties!.updatedAt).toEqual({
      type: "string",
      format: "date-time",
    });
    expect(schema.additionalProperties).toBe(true);
  });

  it("strips virtual fields from properties and required", () => {
    const schema = entityToJsonSchema("pages", [
      { name: "title", type: "text", required: true },
      { name: "path", type: "text", virtual: true, required: true },
    ]);
    expect(schema.properties!.title).toBeDefined();
    expect(schema.properties!.path).toBeUndefined();
    expect(schema.required).toEqual(["title"]);
  });

  it("maps select fields with enum", () => {
    const schema = entityToJsonSchema("posts", [
      {
        name: "status",
        type: "select",
        required: true,
        options: [
          { label: "Draft", value: "draft" },
          { label: "Published", value: "published" },
        ],
      },
    ]);
    expect(schema.properties!.status).toEqual({
      type: "string",
      enum: ["draft", "published"],
    });
  });

  it("allows null for optional select fields with enum", () => {
    const schema = entityToJsonSchema("posts", [
      {
        name: "status",
        type: "select",
        options: [
          { label: "Draft", value: "draft" },
          { label: "Published", value: "published" },
        ],
      },
    ]);
    expect(schema.properties!.status).toEqual({
      type: ["string", "null"],
      enum: ["draft", "published", null],
    });
  });

  it("maps hasMany select to array", () => {
    const schema = entityToJsonSchema("posts", [
      {
        name: "tags",
        type: "select",
        required: true,
        hasMany: true,
        options: [
          { label: "A", value: "a" },
          { label: "B", value: "b" },
        ],
      },
    ]);
    expect(schema.properties!.tags).toEqual({
      type: "array",
      items: { type: "string", enum: ["a", "b"] },
    });
  });

  it("maps monomorphic relationships as nullable id reference", () => {
    const schema = entityToJsonSchema("posts", [
      { name: "author", type: "relationship", relationTo: "users" },
    ]);
    expect(schema.properties!.author).toEqual({
      type: ["string", "number", "null"],
    });
  });

  it("maps polymorphic relationships as relationTo/value object", () => {
    const schema = entityToJsonSchema("posts", [
      {
        name: "related",
        type: "relationship",
        required: true,
        relationTo: ["posts", "pages"],
      },
    ]);
    expect(schema.properties!.related).toEqual({
      type: "object",
      additionalProperties: true,
      properties: {
        relationTo: { type: "string", enum: ["posts", "pages"] },
        value: { type: ["string", "number"] },
      },
      required: ["relationTo", "value"],
    });
  });

  it("maps groups recursively", () => {
    const schema = entityToJsonSchema("posts", [
      {
        name: "meta",
        type: "group",
        required: true,
        fields: [
          { name: "title", type: "text", required: true },
          { name: "description", type: "textarea" },
        ],
      },
    ]);
    expect(schema.properties!.meta).toEqual({
      type: "object",
      additionalProperties: true,
      properties: {
        title: { type: "string" },
        description: { type: ["string", "null"] },
      },
      required: ["title"],
    });
  });

  it("treats a group as required if any descendant is required (mirrors Payload)", () => {
    // The SEO plugin's `meta` group isn't itself marked required, but its
    // `title` and `description` subfields are. Payload's fieldIsRequired
    // bubbles required-ness up, so meta should be non-null and required.
    const schema = entityToJsonSchema("pages", [
      {
        name: "meta",
        type: "group",
        fields: [
          { name: "title", type: "text", required: true },
          { name: "description", type: "textarea", required: true },
          { name: "noIndex", type: "checkbox" },
        ],
      },
    ]);
    expect(schema.properties!.meta).toEqual({
      type: "object",
      additionalProperties: true,
      properties: {
        title: { type: "string" },
        description: { type: "string" },
        noIndex: { type: ["boolean", "null"] },
      },
      required: ["title", "description"],
    });
    expect(schema.required).toContain("meta");
  });

  it("leaves a group nullable when no descendant is required", () => {
    const schema = entityToJsonSchema("pages", [
      {
        name: "meta",
        type: "group",
        fields: [
          { name: "title", type: "text" },
          { name: "description", type: "textarea" },
        ],
      },
    ]);
    expect(schema.properties!.meta).toMatchObject({
      type: ["object", "null"],
    });
    expect(schema.required ?? []).not.toContain("meta");
  });

  it("does not bubble required from array item subfields to the array field", () => {
    // Empty arrays satisfy the parent regardless of item requirements.
    const schema = entityToJsonSchema("pages", [
      {
        name: "links",
        type: "array",
        fields: [{ name: "url", type: "text", required: true }],
      },
    ]);
    expect(schema.properties!.links).toMatchObject({
      type: ["array", "null"],
    });
    expect(schema.required ?? []).not.toContain("links");
  });

  it("maps array fields with id on each item", () => {
    const schema = entityToJsonSchema("posts", [
      {
        name: "links",
        type: "array",
        required: true,
        fields: [{ name: "url", type: "text", required: true }],
      },
    ]);
    expect(schema.properties!.links).toEqual({
      type: "array",
      items: {
        type: "object",
        additionalProperties: true,
        properties: { url: { type: "string" }, id: { type: "string" } },
        required: ["url"],
      },
    });
  });

  it("maps blocks as oneOf with blockType discriminator", () => {
    const schema = entityToJsonSchema("pages", [
      {
        name: "layout",
        type: "blocks",
        required: true,
        blocks: [
          {
            slug: "hero",
            fields: [{ name: "headline", type: "text", required: true }],
          },
          {
            slug: "cta",
            fields: [{ name: "label", type: "text" }],
          },
        ],
      },
    ]);
    const layout = schema.properties!.layout as {
      type: string;
      items: { oneOf: { properties: Record<string, unknown> }[] };
    };
    expect(layout.type).toBe("array");
    expect(layout.items.oneOf).toHaveLength(2);
    expect(layout.items.oneOf[0].properties.blockType).toEqual({
      type: "string",
      const: "hero",
    });
    expect(layout.items.oneOf[1].properties.blockType).toEqual({
      type: "string",
      const: "cta",
    });
  });

  it("represents richText as opaque object", () => {
    const schema = entityToJsonSchema("posts", [
      { name: "body", type: "richText", required: true },
    ]);
    expect(schema.properties!.body).toEqual({ type: "object" });
  });

  it("skips ui fields", () => {
    const schema = entityToJsonSchema("posts", [
      { name: "title", type: "text" },
      { name: "divider", type: "ui" },
    ]);
    expect(schema.properties!.title).toBeDefined();
    expect(schema.properties!.divider).toBeUndefined();
  });
});
