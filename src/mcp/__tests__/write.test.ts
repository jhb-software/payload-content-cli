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
      {
        slug: "notes",
        access: open,
        versions: { drafts: { localizeStatus: true } },
        fields: [{ name: "title", type: "text", localized: true }],
      },
      {
        slug: "trips",
        access: open,
        versions: { drafts: true },
        fields: [
          { name: "facts", type: "array", fields: [{ name: "label", type: "text" }] },
          {
            name: "sections",
            type: "blocks",
            blocks: [
              {
                slug: "list",
                fields: [
                  { name: "items", type: "array", fields: [{ name: "label", type: "text" }] },
                ],
              },
            ],
          },
        ],
      },
    ],
    experimental: { localizeStatus: true },
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

  it("with a status per locale, publishes only the locale it writes", async () => {
    const { id } = await payload.create({
      collection: "notes",
      data: { title: "Live", _status: "published" } as never,
      locale: "en",
    });
    await payload.update({
      collection: "notes",
      id,
      data: { title: "Live DE", _status: "published" } as never,
      locale: "de",
    });
    await payload.update({
      collection: "notes",
      id,
      data: { title: "Draft" },
      draft: true,
      locale: "en",
    });

    const result = await tool("update", {
      collection: "notes",
      id,
      locale: "de",
      data: { title: "Neu" },
      draft: false,
    });

    expect(result).toEqual({ id, status: "published" });
    const live = (locale: string) =>
      payload.findByID({ collection: "notes", id, draft: false, locale, depth: 0 });
    expect((await live("de")).title).toBe("Neu");
    expect((await live("en")).title).toBe("Live");
  });

  it("answers with the message of a locale the app's resolveLocale refuses", async () => {
    const id = await publishedPost("Hello");
    const resolveLocale = () => {
      throw new Error("This site doesn't serve de.");
    };

    const result = await tool(
      "update",
      { collection: "posts", id, locale: "de", data: { title: "Hallo" } },
      { resolveLocale },
    );

    expect(result).toEqual({ error: "This site doesn't serve de." });
  });

  it("refuses a locale the app doesn't have, instead of writing nothing", async () => {
    const id = await publishedPost("Hello");

    const result = await tool("update", {
      collection: "posts",
      id,
      locale: "fr",
      data: { title: "Bonjour" },
    });

    expect(result).toEqual({ error: 'Unknown locale "fr". Use one of: en, de.' });
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

type Row = { id: string; label?: string; items?: Row[] };

async function trip() {
  const created = (await payload.create({
    collection: "trips",
    data: {
      facts: [{ label: "Wildlife" }, { label: "Lodges" }, { label: "Flights" }],
      sections: [{ blockType: "list", items: [{ label: "Day 1" }, { label: "Day 2" }] }],
    } as never,
  })) as unknown as { id: number; facts: Row[]; sections: Row[] };
  return created;
}

const storedTrip = async (id: number) =>
  (await payload.findByID({ collection: "trips", id, draft: true, depth: 0 })) as unknown as {
    facts: Row[];
    sections: Row[];
  };

describe("update with rows", () => {
  it("refuses rows that leave out stored ones, naming them, and keeps every row", async () => {
    const { id, facts } = await trip();

    const result = await tool("update", {
      collection: "trips",
      id,
      data: { facts: [{ id: facts[0].id, label: "Big five" }] },
    });

    expect(result.error).toContain("facts");
    expect(result.error).toContain(facts[1].id);
    expect(result.error).toContain(facts[2].id);
    expect((await storedTrip(id)).facts.map((row) => row.label)).toEqual([
      "Wildlife",
      "Lodges",
      "Flights",
    ]);
  });

  it("refuses leaving out rows of an array inside a block", async () => {
    const { id, sections } = await trip();
    const [section] = sections;

    const result = await tool("update", {
      collection: "trips",
      id,
      data: {
        sections: [{ ...section, items: [section.items![0], { label: "Day 3" }] }],
      },
    });

    expect(result.error).toContain(section.items![1].id);
    expect((await storedTrip(id)).sections[0].items).toHaveLength(2);
  });

  it("takes every row back, edited, reordered and with a new one", async () => {
    const { id, facts } = await trip();

    const result = await tool("update", {
      collection: "trips",
      id,
      data: { facts: [facts[2], { ...facts[0], label: "Big five" }, facts[1], { label: "Spa" }] },
    });

    expect(result.error).toBeUndefined();
    expect((await storedTrip(id)).facts.map((row) => row.label)).toEqual([
      "Flights",
      "Big five",
      "Lodges",
      "Spa",
    ]);
  });

  it("removes rows with replaceRows", async () => {
    const { id, facts } = await trip();

    await tool("update", {
      collection: "trips",
      id,
      data: { facts: [facts[0]] },
      replaceRows: true,
    });

    expect((await storedTrip(id)).facts.map((row) => row.label)).toEqual(["Wildlife"]);
  });

  it("refuses a bulk update that would replace the rows of every matched document", async () => {
    const { id } = await trip();

    const result = await tool("update", {
      collection: "trips",
      where: { id: { equals: id } },
      data: { facts: [{ label: "Only" }] },
    });

    expect(result.error).toContain("replaceRows");
    expect((await storedTrip(id)).facts).toHaveLength(3);
  });
});
