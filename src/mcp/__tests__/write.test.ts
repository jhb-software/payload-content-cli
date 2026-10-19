import type { Payload } from "payload";
import { beforeAll, describe, expect, it } from "vitest";
import { createMcpContentTools, type McpContentToolsOptions } from "../index.js";
import { boot, call, open, toolNamed } from "./payload.js";

let payload: Payload;

beforeAll(async () => {
  payload = await boot("mcp-write", {
    localization: { locales: ["en", "de"], defaultLocale: "en" },
    collections: [
      {
        slug: "posts",
        access: open,
        versions: { drafts: true },
        fields: [
          { name: "title", type: "text", required: true, localized: true },
          { name: "slug", type: "text" },
        ],
      },
      { slug: "authors", access: open, fields: [{ name: "name", type: "text" }] },
    ],
    globals: [
      {
        slug: "footer",
        access: open,
        versions: { drafts: true },
        fields: [{ name: "note", type: "text" }],
      },
    ],
  });
});

function tool(name: string, args: Record<string, unknown>, options?: McpContentToolsOptions) {
  return call(payload, toolNamed(createMcpContentTools(options), name), args);
}

const read = (id: number, draft: boolean) =>
  payload.findByID({ collection: "posts", id, draft, locale: "en", depth: 0 });

async function publishedPost(title: string, slug = "post") {
  const post = await payload.create({
    collection: "posts",
    data: { title, slug, _status: "published" } as never,
    locale: "en",
  });
  return post.id as number;
}

describe("create", () => {
  it("creates an unpublished draft by default, taking data as a JSON string too", async () => {
    const result = await tool("create", { collection: "posts", data: '{"slug":"draft-only"}' });

    expect(result).toEqual({ id: expect.any(Number), status: "draft" });
    expect((await read(result.id, true))._status).toBe("draft");
  });

  it("publishes with draft:false", async () => {
    const result = await tool("create", {
      collection: "posts",
      data: { title: "Live" },
      draft: false,
    });

    expect(result.status).toBe("published");
    expect((await read(result.id, false)).title).toBe("Live");
  });

  it("names the failing field and why when a published document is invalid", async () => {
    const result = await tool("create", { collection: "posts", data: { slug: "x" }, draft: false });

    expect(result.error).toMatch(/title/);
    expect(result.error).toMatch(/required/i);
  });

  it("creates in a collection without drafts", async () => {
    const result = await tool("create", { collection: "authors", data: { name: "Ada" } });

    expect(result).toEqual({ id: expect.any(Number) });
  });

  it("refuses to create a global", async () => {
    const result = await tool("create", { collection: "globals/footer", data: { note: "x" } });

    expect(result.error).toMatch(/global/i);
  });
});

describe("update", () => {
  it("saves a draft by default, leaving the live version alone", async () => {
    const id = await publishedPost("Live");

    const result = await tool("update", { collection: "posts", id, data: { title: "Draft" } });

    expect(result).toEqual({ id, status: "draft" });
    expect((await read(id, true)).title).toBe("Draft");
    expect((await read(id, false)).title).toBe("Live");
  });

  it("with draft:false publishes the latest draft together with the changes", async () => {
    const id = await publishedPost("Live");
    await payload.update({ collection: "posts", id, data: { title: "Draft" }, draft: true });

    const result = await tool("update", {
      collection: "posts",
      id,
      data: { slug: "new" },
      draft: false,
    });

    expect(result).toEqual({ id, status: "published" });
    expect(await read(id, false)).toMatchObject({ title: "Draft", slug: "new" });
  });

  it("updates every document a where clause matches", async () => {
    const a = await publishedPost("A", "bulk");
    const b = await publishedPost("B", "bulk");

    const result = await tool("update", {
      collection: "posts",
      where: { slug: { equals: "bulk" } },
      data: { title: "Same" },
    });

    expect(result).toEqual({ ids: expect.arrayContaining([a, b]), status: "draft" });
    expect((await read(b, true)).title).toBe("Same");
  });

  // Payload publishes a bulk update from the live documents, not their drafts.
  it("refuses a bulk publish that would discard newer drafts, unless overwriteDraft", async () => {
    const id = await publishedPost("Live", "bulk-guard");
    await payload.update({ collection: "posts", id, data: { title: "Draft" }, draft: true });
    const args = {
      collection: "posts",
      where: { slug: { equals: "bulk-guard" } },
      data: { slug: "bulk-guard-2" },
      draft: false,
    };

    const refused = await tool("update", args);
    expect(refused.error).toMatch(/unpublished draft changes/);
    expect((await read(id, true)).title).toBe("Draft");

    const forced = await tool("update", { ...args, overwriteDraft: true });
    expect(forced).toEqual({ ids: [id], status: "published" });
  });

  it("updates a global addressed as globals/<slug>", async () => {
    const result = await tool("update", { collection: "globals/footer", data: { note: "Hi" } });

    expect(result).toEqual({ status: "draft" });
    expect((await payload.findGlobal({ slug: "footer", draft: true })).note).toBe("Hi");
  });

  it("asks for an id or a where clause", async () => {
    const result = await tool("update", { collection: "posts", data: { title: "x" } });

    expect(result.error).toMatch(/id or where/);
  });

  it("refuses an id the app's checkId rejects", async () => {
    const result = await tool(
      "update",
      { collection: "posts", id: "post", data: { title: "x" } },
      { checkId: () => "Pass the numeric id." },
    );

    expect(result).toEqual({ error: "Pass the numeric id." });
  });

  it("writes the locale the app's resolveLocale picks", async () => {
    const id = await publishedPost("Hello");

    await tool(
      "update",
      { collection: "posts", id, data: { title: "Hallo" } },
      { resolveLocale: (_, { locale }) => locale ?? "de" },
    );

    const german = await payload.findByID({ collection: "posts", id, draft: true, locale: "de" });
    expect(german.title).toBe("Hallo");
    expect((await read(id, true)).title).toBe("Hello");
  });

  it('refuses locale "all", which takes values per locale', async () => {
    const id = await publishedPost("Hello");

    const result = await tool("update", {
      collection: "posts",
      id,
      locale: "all",
      data: { title: "x" },
    });

    expect(result.error).toMatch(/one locale/i);
  });
});
