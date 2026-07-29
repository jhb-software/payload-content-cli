import { describe, it, expect } from "vitest";
import { getBlockSchema } from "../index.js";

/** Build a mock PayloadRequest carrying top-level block definitions. */
function mockReq(blocks: any[], user: any = { id: 1 }) {
  return { user, payload: { config: { blocks, collections: [], globals: [] } } };
}

describe("getBlockSchema", () => {
  it("returns { slug, fields } for each requested block slug", async () => {
    const req = mockReq([
      { slug: "cta", fields: [{ name: "label", type: "text", required: true }] },
      { slug: "quote", fields: [{ name: "text", type: "textarea" }] },
    ]);

    const result = await getBlockSchema({ req, slugs: ["cta", "quote"] });

    expect(result).toEqual([
      { slug: "cta", fields: [{ name: "label", type: "text", required: true }] },
      { slug: "quote", fields: [{ name: "text", type: "textarea" }] },
    ]);
  });

  it("preserves the requested order, not the config order", async () => {
    const req = mockReq([
      { slug: "a", fields: [] },
      { slug: "b", fields: [] },
    ]);

    const result = await getBlockSchema({ req, slugs: ["b", "a"] });
    expect(result.map((r) => r.slug)).toEqual(["b", "a"]);
  });

  it("references a nested block by slug so detail unfolds one call at a time", async () => {
    const req = mockReq([
      {
        slug: "section",
        fields: [{ name: "items", type: "blocks", blocks: [], blockReferences: ["cta"] }],
      },
      { slug: "cta", fields: [{ name: "label", type: "text" }] },
    ]);

    const result = await getBlockSchema({ req, slugs: ["section"] });

    expect(result).toEqual([
      { slug: "section", fields: [{ name: "items", type: "blocks", blockSlugs: ["cta"] }] },
    ]);
  });

  it("resolves nested blockReferences within a block in inline mode", async () => {
    const req = mockReq([
      {
        slug: "section",
        fields: [{ name: "items", type: "blocks", blocks: [], blockReferences: ["cta"] }],
      },
      { slug: "cta", fields: [{ name: "label", type: "text" }] },
    ]);

    const result = await getBlockSchema({ req, slugs: ["section"], blocks: "inline" });

    expect(result).toEqual([
      {
        slug: "section",
        fields: [
          {
            name: "items",
            type: "blocks",
            blocks: [{ slug: "cta", fields: [{ name: "label", type: "text" }] }],
          },
        ],
      },
    ]);
  });

  it("resolves a block declared inline on a field, not just those on config.blocks", async () => {
    // Payload projects commonly declare blocks inline on the field. A slug the
    // entity schema hands out must resolve here, however it was declared.
    const req = {
      user: { id: 1 },
      payload: {
        config: {
          blocks: [],
          collections: [
            {
              slug: "pages",
              fields: [
                {
                  name: "layout",
                  type: "blocks",
                  blocks: [{ slug: "hero", fields: [{ name: "heading", type: "text" }] }],
                },
              ],
            },
          ],
          globals: [],
        },
      },
    };

    const result = await getBlockSchema({ req, slugs: ["hero"] });

    expect(result).toEqual([{ slug: "hero", fields: [{ name: "heading", type: "text" }] }]);
  });

  it("resolves a block nested inside another inline block", async () => {
    const req = {
      user: { id: 1 },
      payload: {
        config: {
          blocks: [],
          globals: [
            {
              slug: "settings",
              fields: [
                {
                  name: "layout",
                  type: "blocks",
                  blocks: [
                    {
                      slug: "section",
                      fields: [
                        {
                          name: "items",
                          type: "blocks",
                          blocks: [{ slug: "cta", fields: [{ name: "label", type: "text" }] }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
          collections: [],
        },
      },
    };

    const result = await getBlockSchema({ req, slugs: ["cta"] });

    expect(result).toEqual([{ slug: "cta", fields: [{ name: "label", type: "text" }] }]);
  });

  it("returns an empty array for an empty slug list", async () => {
    const req = mockReq([{ slug: "cta", fields: [] }]);
    expect(await getBlockSchema({ req, slugs: [] })).toEqual([]);
  });

  it("throws a distinct error for a single unknown slug", async () => {
    const req = mockReq([{ slug: "cta", fields: [] }]);
    await expect(getBlockSchema({ req, slugs: ["nope"] })).rejects.toThrow(
      /no block with slug "nope"/i,
    );
  });

  it("throws listing all unknown slugs when several are missing", async () => {
    const req = mockReq([{ slug: "cta", fields: [] }]);
    await expect(getBlockSchema({ req, slugs: ["cta", "x", "y"] })).rejects.toThrow(
      /no blocks with slugs "x", "y"/i,
    );
  });

  it("points the caller at where valid slugs come from", async () => {
    const req = mockReq([{ slug: "cta", fields: [] }]);
    await expect(getBlockSchema({ req, slugs: ["nope"] })).rejects.toThrow(/in the entity schema/);
  });

  it("does not gate on access — blocks resolve even without a user", async () => {
    const req = mockReq([{ slug: "cta", fields: [{ name: "label", type: "text" }] }], null);
    const result = await getBlockSchema({ req, slugs: ["cta"] });
    expect(result).toEqual([{ slug: "cta", fields: [{ name: "label", type: "text" }] }]);
  });
});
