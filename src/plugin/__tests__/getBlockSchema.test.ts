import { describe, it, expect } from "vitest";
import { getBlockSchema } from "../index.js";

/** Build a mock PayloadRequest carrying top-level block definitions. */
function mockReq(blocks: any[], user: any = { id: 1 }) {
  return { user, payload: { config: { blocks } } };
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

  it("resolves nested blockReferences within a block via the shared map", async () => {
    const req = mockReq([
      {
        slug: "section",
        fields: [{ name: "items", type: "blocks", blocks: [], blockReferences: ["cta"] }],
      },
      { slug: "cta", fields: [{ name: "label", type: "text" }] },
    ]);

    const result = await getBlockSchema({ req, slugs: ["section"] });

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
