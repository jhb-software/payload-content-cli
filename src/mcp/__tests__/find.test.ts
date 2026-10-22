import type { Payload } from "payload";
import { beforeAll, describe, expect, it } from "vitest";
import { createMcpContentTools, type McpContentToolsOptions } from "../index.js";
import { boot, call, open, toolNamed } from "./payload.js";

let payload: Payload;

beforeAll(async () => {
  payload = await boot("mcp-find", {
    localization: { locales: ["en", "de"], defaultLocale: "en" },
    collections: [
      {
        slug: "posts",
        access: open,
        versions: { drafts: true },
        fields: [
          { name: "title", type: "text", localized: true },
          { name: "slug", type: "text" },
        ],
      },
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

function find(args: Record<string, unknown>, options?: McpContentToolsOptions) {
  return call(payload, toolNamed(createMcpContentTools(options), "find"), args);
}

async function publishedPost(slug: string, title: string) {
  return payload.create({
    collection: "posts",
    data: { slug, title, _status: "published" } as never,
    locale: "en",
  });
}

describe("find", () => {
  it("queries with where and select given as JSON strings, as some clients send them", async () => {
    await publishedPost("alpha", "Alpha");
    await publishedPost("beta", "Beta");

    const result = await find({
      collection: "posts",
      where: '{"slug":{"equals":"beta"}}',
      select: '{"title":true}',
    });

    expect(result).toEqual({
      docs: [{ id: expect.any(Number), title: "Beta" }],
      totalDocs: 1,
      page: 1,
      totalPages: 1,
    });
  });

  it("reads the draft by default, and the live version with draft:false", async () => {
    const post = await publishedPost("gamma", "Live title");
    await payload.update({
      collection: "posts",
      id: post.id,
      data: { title: "Draft title" },
      draft: true,
      locale: "en",
    });

    const draft = await find({ collection: "posts", id: post.id, select: { title: true } });
    const live = await find({
      collection: "posts",
      id: post.id,
      select: { title: true },
      draft: false,
    });

    expect(draft.title).toBe("Draft title");
    expect(live.title).toBe("Live title");
  });

  it("shows only what a locale stores, so an untranslated field doesn't read as translated", async () => {
    const post = await publishedPost("delta", "English only");

    const german = await find({ collection: "posts", id: post.id, locale: "de" });

    expect(german.title ?? null).toBeNull();
  });

  it("refuses a locale the app doesn't have, naming the ones it has", async () => {
    const { id } = await publishedPost("locale", "Hello");

    const result = await find({ collection: "posts", id, locale: "fr" });

    expect(result).toEqual({ error: 'Unknown locale "fr". Use one of: en, de.' });
  });

  it('refuses path and text with locale "all", which read one locale', async () => {
    const { id } = await publishedPost("all-locales", "Hello");

    const result = await find({ collection: "posts", id, locale: "all", path: "title" });

    expect(result).toEqual({ error: expect.stringMatching(/one locale/) });
  });

  it('reads every locale with "*", as Payload does', async () => {
    const { id } = await publishedPost("star-locale", "Hello");

    const result = await find({ collection: "posts", id, locale: "*", select: { title: true } });

    expect(result).toMatchObject({ title: { en: "Hello" } });
  });

  it("reads a global addressed as globals/<slug>", async () => {
    await payload.updateGlobal({ slug: "footer", data: { note: "Hello" } as never });

    expect(await find({ collection: "globals/footer", select: { note: true } })).toMatchObject({
      note: "Hello",
    });
  });

  it("says when a document doesn't exist", async () => {
    expect(await find({ collection: "posts", id: 999999 })).toEqual({
      error: 'No posts document with id "999999".',
    });
  });

  it("names the collections there are when the slug is wrong", async () => {
    const result = await find({ collection: "post" });

    expect(result).toEqual({ error: 'No collection "post". Collections: posts.' });
  });

  it("names the globals there are when the global is wrong", async () => {
    const result = await find({ collection: "globals/header" });

    expect(result).toEqual({ error: 'No global "header". Globals: globals/footer.' });
  });

  it("refuses an id the app's checkId rejects, before looking it up", async () => {
    const result = await find(
      { collection: "posts", id: "gamma" },
      { checkId: (_, { id }) => (typeof id === "string" ? "Pass the numeric id." : undefined) },
    );

    expect(result).toEqual({ error: "Pass the numeric id." });
  });

  it("reads the locale the app's resolveLocale picks when the agent passes none", async () => {
    const post = await publishedPost("epsilon", "Hello");
    await payload.update({
      collection: "posts",
      id: post.id,
      data: { title: "Hallo" },
      locale: "de",
    });

    const result = await find(
      { collection: "posts", id: post.id, select: { title: true } },
      { resolveLocale: (_, { locale }) => locale ?? "de" },
    );

    expect(result.title).toBe("Hallo");
  });

  it("blames the app's resolveLocale, not the agent, for a locale it swapped in", async () => {
    const post = await publishedPost("zeta", "Hello");

    const result = await find(
      { collection: "posts", id: post.id, locale: "de" },
      { resolveLocale: () => "fr" },
    );

    expect(result.error).toMatch(/resolveLocale picked "fr"/);
  });
});
