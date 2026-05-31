import { describe, it, expect } from "vitest";
import type { PayloadRequest } from "payload";
import { getEntitySchema } from "../index.js";

/** Build a mock PayloadRequest carrying a config and an optional user. */
function mockReq(
  config: { collections?: any[]; globals?: any[]; blocks?: any[] },
  user: any = { id: 1 },
): PayloadRequest {
  return {
    user,
    payload: {
      config: {
        collections: config.collections ?? [],
        globals: config.globals ?? [],
        blocks: config.blocks ?? [],
      },
    },
  } as unknown as PayloadRequest;
}

describe("getEntitySchema", () => {
  it("returns slug, fields, and jsonSchema for a collection", async () => {
    const req = mockReq({
      collections: [
        {
          slug: "posts",
          fields: [
            { name: "title", type: "text", required: true },
            { name: "body", type: "richText" },
          ],
        },
      ],
    });

    const result = await getEntitySchema({ req, type: "collection", slug: "posts" });

    expect(result.slug).toBe("posts");
    expect(result.fields).toEqual([
      { name: "title", type: "text", required: true },
      { name: "body", type: "richText" },
    ]);
    // jsonSchema is the draft-07 validation doc, with required fields surfaced.
    expect(result.jsonSchema.title).toBe("posts");
    expect(result.jsonSchema.required).toContain("title");
    expect(result.jsonSchema.required).not.toContain("body");
  });

  it("returns the schema for a global", async () => {
    const req = mockReq({
      globals: [{ slug: "settings", fields: [{ name: "siteName", type: "text", required: true }] }],
    });

    const result = await getEntitySchema({ req, type: "global", slug: "settings" });

    expect(result.slug).toBe("settings");
    expect(result.fields).toEqual([{ name: "siteName", type: "text", required: true }]);
  });

  it("resolves the correct namespace when a collection and global share a slug", async () => {
    const req = mockReq({
      collections: [{ slug: "settings", fields: [{ name: "collectionField", type: "text" }] }],
      globals: [{ slug: "settings", fields: [{ name: "globalField", type: "text" }] }],
    });

    const asCollection = await getEntitySchema({ req, type: "collection", slug: "settings" });
    const asGlobal = await getEntitySchema({ req, type: "global", slug: "settings" });

    expect(asCollection.fields).toEqual([{ name: "collectionField", type: "text" }]);
    expect(asGlobal.fields).toEqual([{ name: "globalField", type: "text" }]);
  });

  it("resolves blockReferences from payload.config.blocks", async () => {
    const req = mockReq({
      collections: [
        {
          slug: "pages",
          fields: [{ name: "layout", type: "blocks", blocks: [], blockReferences: ["cta"] }],
        },
      ],
      blocks: [{ slug: "cta", fields: [{ name: "label", type: "text" }] }],
    });

    const result = await getEntitySchema({ req, type: "collection", slug: "pages" });

    expect(result.fields).toEqual([
      {
        name: "layout",
        type: "blocks",
        blocks: [{ slug: "cta", fields: [{ name: "label", type: "text" }] }],
      },
    ]);
  });

  it("throws a distinct error for an unknown slug", async () => {
    const req = mockReq({ collections: [{ slug: "posts", fields: [] }] });

    await expect(getEntitySchema({ req, type: "collection", slug: "nope" })).rejects.toThrow(
      /no collection.*"nope"/i,
    );
    await expect(getEntitySchema({ req, type: "global", slug: "nope" })).rejects.toThrow(
      /no global.*"nope"/i,
    );
  });

  it("throws a distinct error when access is denied", async () => {
    const req = mockReq({
      collections: [{ slug: "secrets", fields: [], access: { read: () => false } }],
    });

    await expect(getEntitySchema({ req, type: "collection", slug: "secrets" })).rejects.toThrow(
      /access denied.*"secrets"/i,
    );
  });

  it("allows access when access.read returns a where clause (lenient, matches the endpoint)", async () => {
    const req = mockReq({
      collections: [
        {
          slug: "posts",
          fields: [{ name: "title", type: "text" }],
          access: { read: () => ({ author: { equals: 1 } }) },
        },
      ],
    });

    const result = await getEntitySchema({ req, type: "collection", slug: "posts" });
    expect(result.slug).toBe("posts");
  });

  it("denies access when access.read is undefined and there is no user", async () => {
    const req = mockReq({ collections: [{ slug: "posts", fields: [] }] }, null);

    await expect(getEntitySchema({ req, type: "collection", slug: "posts" })).rejects.toThrow(
      /access denied/i,
    );
  });

  it("passes req to the entity's access.read", async () => {
    let capturedArg: any;
    const req = mockReq({
      collections: [
        {
          slug: "posts",
          fields: [],
          access: {
            read: (arg: any) => {
              capturedArg = arg;
              return true;
            },
          },
        },
      ],
    });

    await getEntitySchema({ req, type: "collection", slug: "posts" });
    expect(capturedArg.req).toBe(req);
  });
});
