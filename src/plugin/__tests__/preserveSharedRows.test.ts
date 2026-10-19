/**
 * A non-localized array or blocks field holds one set of rows for every
 * locale; the localized values inside are bound to each row's id. These run
 * against real Payload to prove the guard keeps those translations.
 */

import type { Field, Payload } from "payload";
import { beforeAll, describe, expect, it } from "vitest";
import { createMcpContentTools } from "../../mcp/index.js";
import { boot, call, open, toolNamed } from "../../mcp/__tests__/payload.js";
import { ALLOW_SHARED_ROW_REPLACEMENT, preserveSharedRowsPlugin } from "../index.js";

const fields: Field[] = [
  {
    name: "extras",
    type: "array",
    fields: [
      { name: "item", type: "group", fields: [{ name: "title", type: "text", localized: true }] },
    ],
  },
  { name: "sections", type: "blocks", blockReferences: ["section"], blocks: [] },
  { name: "links", type: "array", fields: [{ name: "url", type: "text" }] },
  {
    name: "perLocale",
    type: "array",
    localized: true,
    fields: [{ name: "title", type: "text", localized: true }],
  },
];

let payload: Payload;

beforeAll(async () => {
  payload = await boot("shared-rows", {
    localization: { locales: ["en", "de"], defaultLocale: "en" },
    blocks: [{ slug: "section", fields: [{ name: "title", type: "text", localized: true }] }],
    collections: [{ slug: "hotels", access: open, fields }],
    globals: [{ slug: "nav", access: open, fields }],
    plugins: [preserveSharedRowsPlugin()],
  });
});

type Row = { id: string; item?: { title?: string }; title?: string };

/** A hotel with two extras and a section, each titled in English and German. */
async function hotel() {
  const created = await payload.create({
    collection: "hotels",
    locale: "en",
    data: {
      extras: [{ item: { title: "Cuisine" } }, { item: { title: "Activities" } }],
      sections: [{ blockType: "section", title: "Welcome" }],
      links: [{ url: "https://example.com" }],
    } as never,
  });
  const extras = (created as unknown as { extras: Row[] }).extras;
  const sections = (created as unknown as { sections: Row[] }).sections;
  await payload.update({
    collection: "hotels",
    id: created.id,
    locale: "de",
    data: {
      extras: [
        { id: extras[0].id, item: { title: "Kulinarik" } },
        { id: extras[1].id, item: { title: "Aktivitäten" } },
      ],
      sections: [{ id: sections[0].id, blockType: "section", title: "Willkommen" }],
    } as never,
  });
  return { id: created.id, extras: extras.map((row) => row.id), section: sections[0].id };
}

async function titles(id: number | string, locale: "en" | "de") {
  const doc = (await payload.findByID({
    collection: "hotels",
    id,
    locale,
    fallbackLocale: false,
    depth: 0,
  })) as unknown as { extras: Row[] };
  return doc.extras.map((row) => row.item?.title ?? null);
}

function updateEnglish(id: number | string, data: Record<string, unknown>, context = {}) {
  return payload.update({ collection: "hotels", id, locale: "en", data: data as never, context });
}

describe("preserveSharedRowsPlugin refuses", () => {
  it("rewriting a shared array without row ids, and says how to keep the translations", async () => {
    const { id, extras } = await hotel();

    const error = await updateEnglish(id, { extras: [{ item: { title: "Food" } }] }).catch(
      (err: Error) => err,
    );

    expect(error).toBeInstanceOf(Error);
    expect((error as Error).message).toContain("extras");
    expect((error as Error).message).toContain(extras.join(", "));
    expect((error as Error).message).toContain("replaceRows");
    expect(await titles(id, "de")).toEqual(["Kulinarik", "Aktivitäten"]);
  });

  it("rewriting blocks given by blockReferences without row ids", async () => {
    const { id } = await hotel();

    await expect(
      updateEnglish(id, { sections: [{ blockType: "section", title: "Hello" }] }),
    ).rejects.toThrow(/sections/);
  });

  it("rows whose id is null", async () => {
    const { id } = await hotel();

    await expect(
      updateEnglish(id, { extras: [{ id: null, item: { title: "Food" } }] }),
    ).rejects.toThrow(/extras/);
  });

  it("a bulk update by where", async () => {
    const { id } = await hotel();

    await expect(
      payload.update({
        collection: "hotels",
        where: { id: { equals: id } },
        locale: "en",
        data: { extras: [{ item: { title: "Food" } }] } as never,
      }),
    ).rejects.toThrow(/extras/);
  });

  it("a global", async () => {
    await payload.updateGlobal({
      slug: "nav",
      locale: "en",
      data: { extras: [{ item: { title: "Cuisine" } }] } as never,
    });

    await expect(
      payload.updateGlobal({
        slug: "nav",
        locale: "en",
        data: { extras: [{ item: { title: "Food" } }] } as never,
      }),
    ).rejects.toThrow(/extras/);
  });
});

describe("preserveSharedRowsPlugin allows", () => {
  it("rows sent back with their ids, keeping the other locale", async () => {
    const { id, extras } = await hotel();

    await updateEnglish(id, {
      extras: [
        { id: extras[0], item: { title: "Food" } },
        { id: extras[1], item: { title: "Activities" } },
      ],
    });

    expect(await titles(id, "en")).toEqual(["Food", "Activities"]);
    expect(await titles(id, "de")).toEqual(["Kulinarik", "Aktivitäten"]);
  });

  it("an edit plus a new row", async () => {
    const { id, extras } = await hotel();

    await updateEnglish(id, { extras: [{ id: extras[0] }, { item: { title: "Spa" } }] });

    expect(await titles(id, "en")).toEqual(["Cuisine", "Spa"]);
  });

  it("a localized array without ids, whose rows are per locale anyway", async () => {
    const { id } = await hotel();

    await expect(updateEnglish(id, { perLocale: [{ title: "New" }] })).resolves.toBeDefined();
  });

  it("an array without localized fields, which has no translations to lose", async () => {
    const { id } = await hotel();

    await expect(
      updateEnglish(id, { links: [{ url: "https://example.org" }] }),
    ).resolves.toBeDefined();
  });

  it("clearing an array", async () => {
    const { id } = await hotel();

    await expect(updateEnglish(id, { extras: [] })).resolves.toBeDefined();
  });

  // The admin panel mints an id for every new row, so even replacing all rows arrives with ids.
  it("replacing every row with freshly minted ids, as the admin panel does", async () => {
    const { id } = await hotel();

    await expect(
      updateEnglish(id, {
        extras: [{ id: "6a8c47004bdbf60004ef9762", item: { title: "One" } }],
      }),
    ).resolves.toBeDefined();
  });

  it("replacing the rows on purpose, via the operation context", async () => {
    const { id } = await hotel();

    await updateEnglish(
      id,
      { extras: [{ item: { title: "Food" } }] },
      { [ALLOW_SHARED_ROW_REPLACEMENT]: true },
    );

    expect(await titles(id, "en")).toEqual(["Food"]);
  });
});

describe("the update tool", () => {
  const update = toolNamed(createMcpContentTools(), "update");

  it("passes the refusal on to the agent, and replaces the rows with replaceRows", async () => {
    const { id } = await hotel();
    const args = {
      collection: "hotels",
      id,
      locale: "en",
      data: { extras: [{ item: { title: "Food" } }] },
    };

    const refused = await call(payload, update, args);
    expect(refused.error).toContain("replaceRows");

    expect(await call(payload, update, { ...args, replaceRows: true })).toEqual({ id });
    expect(await titles(id, "en")).toEqual(["Food"]);
  });
});
