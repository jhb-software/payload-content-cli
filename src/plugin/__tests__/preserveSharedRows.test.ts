/**
 * A non-localized array or blocks field holds one set of rows for every
 * locale; the localized values inside are bound to each row's id. These run
 * against real Payload to prove the guard keeps those translations.
 */

import { handleEndpoints, type Field, type Payload } from "payload";
import { beforeAll, describe, expect, it } from "vitest";
import { createMcpContentTools } from "../../mcp/index.js";
import { boot, call, open, toolNamed } from "../../mcp/__tests__/payload.js";
import {
  ALLOW_SHARED_ROW_REPLACEMENT,
  isSharedRowRefusal,
  preserveSharedRowsPlugin,
} from "../index.js";

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

const onlyPublic = () => ({ public: { equals: true } });

let payload: Payload;

beforeAll(async () => {
  // The default key: Payload's REST handler looks the instance up under it.
  payload = await boot("default", {
    localization: { locales: ["en", "de"], defaultLocale: "en" },
    blocks: [
      {
        slug: "section",
        fields: [
          { name: "title", type: "text", localized: true },
          {
            name: "points",
            type: "array",
            fields: [{ name: "text", type: "text", localized: true }],
          },
        ],
      },
    ],
    collections: [
      { slug: "hotels", access: open, fields },
      // Only the API's own code may touch these.
      {
        slug: "vaults",
        access: { read: () => false, create: () => false, update: () => false },
        fields,
      },
      // A caller may write these without being able to read them.
      {
        slug: "drops",
        access: { read: () => false, create: () => true, update: () => true },
        fields: [...fields, { name: "meta", type: "json" }],
      },
      { slug: "bins", access: open, trash: true, fields },
      // Reads reach only public documents; writes reach every memo but no notice.
      {
        slug: "memos",
        access: { read: onlyPublic, create: () => true, update: () => true },
        fields: [...fields, { name: "public", type: "checkbox" }],
      },
      {
        slug: "notices",
        access: { read: onlyPublic, create: () => true, update: () => false },
        fields: [...fields, { name: "public", type: "checkbox" }],
      },
      // Sorted so the bulk test controls which document comes last.
      {
        slug: "rooms",
        access: open,
        defaultSort: "rank",
        fields: [...fields, { name: "rank", type: "number", max: 1000 }],
      },
    ],
    globals: [
      { slug: "nav", access: open, fields },
      { slug: "status", access: open, fields: [linksOnly] },
      { slug: "safe", access: { read: () => false, update: () => false }, fields },
      { slug: "box", access: { read: () => false, update: () => true }, fields },
    ],
    plugins: [
      preserveSharedRowsPlugin(),
      // Listed after the guard, as apps do with plugins that add collections.
      (config) => ({
        ...config,
        collections: [
          ...(config.collections ?? []),
          { slug: "suites", access: open, fields },
          // Rows, but nothing localized in them: no translations to lose.
          { slug: "reports", access: open, fields: [linksOnly] },
        ],
      }),
    ],
  });
});

const linksOnly: Field = { name: "links", type: "array", fields: [{ name: "url", type: "text" }] };

type Row = { id: string; item?: { title?: string }; title?: string; text?: string };

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

    expect(isSharedRowRefusal(error)).toBe(true);
    const { message } = error as Error;
    expect(message).toContain("extras");
    expect(message).toContain(extras.join(", "));
    expect(message).toContain("Send each row you keep back with its id");
    // REST and CLI callers can't act on transport-specific advice.
    expect(message).not.toMatch(/replaceRows|MCP|context/);
    expect(await titles(id, "de")).toEqual(["Kulinarik", "Aktivitäten"]);
  });

  it("is told apart from other validation errors", async () => {
    const room = await payload.create({ collection: "rooms", data: {} as never });
    const error = await payload
      .update({ collection: "rooms", id: room.id, data: { rank: 5000 } as never })
      .catch((err: Error) => err);

    expect(error).toBeInstanceOf(Error);
    expect(isSharedRowRefusal(error)).toBe(false);
  });

  it("rewriting blocks given by blockReferences without row ids", async () => {
    const { id } = await hotel();

    await expect(
      updateEnglish(id, { sections: [{ blockType: "section", title: "Hello" }] }),
    ).rejects.toThrow(/sections/);
  });

  it("rewriting the rows inside a block sent without its blockType, which Payload accepts", async () => {
    const created = await payload.create({
      collection: "hotels",
      locale: "en",
      data: { sections: [{ blockType: "section", points: [{ text: "Pool" }] }] } as never,
    });
    const [section] = (created as unknown as { sections: (Row & { points: Row[] })[] }).sections;

    await expect(
      updateEnglish(created.id, { sections: [{ id: section.id, points: [{ text: "Spa" }] }] }),
    ).rejects.toThrow(section.points[0].id);
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

  it("a bulk update by where whose offending document comes after the first hundred", async () => {
    for (let rank = 0; rank < 100; rank++) {
      await payload.create({ collection: "rooms", locale: "en", data: { rank } as never });
    }
    const last = await payload.create({
      collection: "rooms",
      locale: "en",
      data: { rank: 100, extras: [{ item: { title: "Cuisine" } }] } as never,
    });

    await expect(
      payload.update({
        collection: "rooms",
        where: { rank: { exists: true } },
        locale: "en",
        data: { extras: [{ item: { title: "Food" } }] } as never,
      }),
    ).rejects.toThrow(/extras/);
    const stored = (await payload.findByID({ collection: "rooms", id: last.id, locale: "en" })) as {
      extras?: Row[];
    };
    expect(stored.extras?.map((row) => row.item?.title)).toEqual(["Cuisine"]);
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

  it("on a collection a plugin listed after it adds", async () => {
    const suite = await payload.create({
      collection: "suites",
      locale: "en",
      data: { extras: [{ item: { title: "Cuisine" } }] } as never,
    });

    await expect(
      payload.update({
        collection: "suites",
        id: suite.id,
        locale: "en",
        data: { extras: [{ item: { title: "Food" } }] } as never,
      }),
    ).rejects.toThrow(/extras/);
  });
});

describe("preserveSharedRowsPlugin costs nothing", () => {
  // Its hook reads the stored document on every write with rows.
  it("where no rows hold translations", () => {
    const hooked = [
      payload.collections.reports.config,
      payload.globals.config.find((global) => global.slug === "status")!,
    ].filter((entity) => (entity.hooks?.beforeOperation ?? []).length > 0);

    expect(hooked.map((entity) => entity.slug)).toEqual([]);
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

describe("access", () => {
  /** An anonymous write through Payload's own REST routes, which pass no `overrideAccess`. */
  async function anonymousWrite(
    method: "PATCH" | "POST",
    path: string,
    query = "",
    data: unknown = { extras: [{ item: { title: "Probe" } }] },
  ) {
    const response = await handleEndpoints({
      config: payload.config,
      path,
      request: new Request(`http://localhost${path}${query}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      }),
    });
    return { status: response?.status, body: (await response?.text()) ?? "" };
  }

  async function vaultWithARow() {
    const vault = await payload.create({
      collection: "vaults",
      locale: "en",
      data: { extras: [{ item: { title: "Secret" } }] } as never,
    });
    return { id: vault.id, rowId: (vault as unknown as { extras: Row[] }).extras[0].id };
  }

  it("names no stored row id to a REST caller who may not read a document", async () => {
    const { id, rowId } = await vaultWithARow();

    for (const [path, query] of [
      [`/api/vaults/${id}`, ""],
      ["/api/vaults", "?where[id][exists]=true"],
    ]) {
      const answer = await anonymousWrite("PATCH", path, query);
      expect(answer.status).toBe(403);
      expect(answer.body).not.toContain(rowId);
    }
  });

  it("names no stored row id to a REST caller who may not read a global", async () => {
    const safe = await payload.updateGlobal({
      slug: "safe",
      locale: "en",
      data: { extras: [{ item: { title: "Secret" } }] } as never,
    });
    const [row] = (safe as unknown as { extras: Row[] }).extras;

    const answer = await anonymousWrite("POST", "/api/globals/safe");

    expect(answer.status).toBe(403);
    expect(answer.body).not.toContain(row.id);
  });

  it("doesn't tell a REST caller whether an unreadable document matches their filter", async () => {
    await vaultWithARow();
    const answerTo = (title: string) =>
      anonymousWrite("PATCH", "/api/vaults", `?where[extras.item.title][equals]=${title}`);

    expect(await answerTo("Secret")).toEqual(await answerTo("Nothing"));
  });

  /** A document holding one row, titled in English and German. */
  async function translated(collection: "drops" | "memos" | "notices", isPublic?: boolean) {
    const created = await payload.create({
      collection,
      locale: "en",
      data: { public: isPublic, extras: [{ item: { title: "Original" } }] } as never,
    });
    const [row] = (created as unknown as { extras: Row[] }).extras;
    await payload.update({
      collection,
      id: created.id,
      locale: "de",
      data: { extras: [{ id: row.id, item: { title: "Original DE" } }] } as never,
    });
    return { id: created.id, rowId: row.id };
  }

  async function storedRows(collection: "drops" | "memos", id: number | string) {
    const doc = await payload.findByID({ collection, id, locale: "de" });
    return (doc as unknown as { extras: Row[] }).extras.map((row) => [row.id, row.item?.title]);
  }

  it("refuses a write it can't check when the caller may update but not read, keeping the translations", async () => {
    const { id, rowId } = await translated("drops");

    for (const [path, query] of [
      [`/api/drops/${id}`, ""],
      ["/api/drops", `?where[id][equals]=${id}`],
    ]) {
      const answer = await anonymousWrite("PATCH", path, query);
      expect(answer.status).toBe(403);
      expect(answer.body).not.toContain(rowId);
    }
    expect(await storedRows("drops", id)).toEqual([[rowId, "Original DE"]]);
  });

  it("lets a caller who may update but not read write what can't drop shared rows", async () => {
    const { id, rowId } = await translated("drops");

    for (const data of [{ links: [{ url: "https://example.com" }] }, { meta: [{ any: "json" }] }]) {
      const answer = await anonymousWrite("PATCH", `/api/drops/${id}`, "", data);
      expect(answer.status).toBe(200);
    }
    expect(await storedRows("drops", id)).toEqual([[rowId, "Original DE"]]);
  });

  it("refuses the same uncheckable write through the Local API when it runs as the caller", async () => {
    const { id, rowId } = await translated("drops");

    const error = await payload
      .update({
        collection: "drops",
        id,
        locale: "en",
        overrideAccess: false,
        data: { extras: [{ item: { title: "Probe" } }] } as never,
      })
      .catch((err: Error) => err);

    expect((error as { status?: number }).status).toBe(403);
    expect(await storedRows("drops", id)).toEqual([[rowId, "Original DE"]]);
  });

  it("checks a trashed document when the write targets the trash", async () => {
    const created = await payload.create({
      collection: "bins",
      locale: "en",
      data: { extras: [{ item: { title: "Original" } }] } as never,
    });
    const [row] = (created as unknown as { extras: Row[] }).extras;
    await payload.update({
      collection: "bins",
      id: created.id,
      data: { deletedAt: new Date().toISOString() } as never,
      trash: true,
    });

    const replacing = await anonymousWrite("PATCH", `/api/bins/${created.id}`, "?trash=true");
    const bulk = await anonymousWrite(
      "PATCH",
      "/api/bins",
      `?trash=true&where[id][equals]=${created.id}`,
    );
    const keeping = await anonymousWrite("PATCH", `/api/bins/${created.id}`, "?trash=true", {
      extras: [{ id: row.id, item: { title: "Edited" } }],
    });

    expect(replacing.status).toBe(400);
    expect(replacing.body).toContain(row.id);
    expect(bulk.status).toBe(400);
    expect(keeping.status).toBe(200);
  });

  it("refuses a write it can't check to a global the caller may update but not read", async () => {
    const box = await payload.updateGlobal({
      slug: "box",
      locale: "en",
      data: { extras: [{ item: { title: "Original" } }] } as never,
    });
    const [row] = (box as unknown as { extras: Row[] }).extras;

    const answer = await anonymousWrite("POST", "/api/globals/box");

    expect(answer.status).toBe(403);
    expect(answer.body).not.toContain(row.id);
    const stored = await payload.findGlobal({ slug: "box", locale: "en" });
    expect((stored as unknown as { extras: Row[] }).extras[0].id).toBe(row.id);
  });

  it("refuses a write by id to a document outside what the caller may read, keeping the translations", async () => {
    const { id, rowId } = await translated("memos", false);

    const answer = await anonymousWrite("PATCH", `/api/memos/${id}`);

    expect(answer.status).toBe(404);
    expect(answer.body).not.toContain(rowId);
    expect(await storedRows("memos", id)).toEqual([[rowId, "Original DE"]]);
  });

  it("doesn't reveal whether a document outside what the caller may read matches their filter", async () => {
    await translated("notices", false);
    const answerTo = (title: string) =>
      anonymousWrite("PATCH", "/api/notices", `?where[extras.item.title][equals]=${title}`);

    expect(await answerTo("Original")).toEqual(await answerTo("Nothing"));
  });

  it("still refuses a REST write that would drop rows the caller may read", async () => {
    const { id, extras } = await hotel();

    const answer = await anonymousWrite("PATCH", `/api/hotels/${id}`);

    expect(answer.status).toBe(400);
    expect(answer.body).toContain(extras[0]);
    expect(await titles(id, "de")).toEqual(["Kulinarik", "Aktivitäten"]);
  });

  it("gives a caller who may not update the document Payload's refusal, not the stored row ids", async () => {
    const vault = await payload.create({
      collection: "vaults",
      locale: "en",
      data: { extras: [{ item: { title: "Secret" } }] } as never,
    });
    const storedIds = (vault as unknown as { extras: Row[] }).extras.map((row) => row.id);

    const error = await payload
      .update({
        collection: "vaults",
        id: vault.id,
        locale: "en",
        overrideAccess: false,
        data: { extras: [{ item: { title: "Probe" } }] } as never,
      })
      .catch((err: Error) => err);

    expect(isSharedRowRefusal(error)).toBe(false);
    expect((error as Error).message).not.toContain(storedIds[0]);
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

  it("writes rows to a global in one locale without copying the default locale's untranslated values", async () => {
    const nav = (await payload.updateGlobal({
      slug: "nav",
      locale: "en",
      data: {
        extras: [{ item: { title: "Cuisine" } }],
        perLocale: [{ title: "English only" }],
      } as never,
      context: { [ALLOW_SHARED_ROW_REPLACEMENT]: true },
    })) as unknown as { extras: Row[] };

    const result = await call(payload, update, {
      collection: "globals/nav",
      locale: "de",
      data: { extras: [{ id: nav.extras[0].id, item: { title: "Kulinarik" } }] },
    });

    expect(result.error).toBeUndefined();
    const de = await payload.findGlobal({
      slug: "nav",
      locale: "de",
      fallbackLocale: false,
      depth: 0,
    });
    expect((de as unknown as { perLocale?: Row[] }).perLocale ?? []).toEqual([]);
  });

  it("adds a row inside a block from rows sent as ids alone, keeping every translation", async () => {
    const created = await payload.create({
      collection: "hotels",
      locale: "en",
      data: { sections: [{ blockType: "section", title: "Rooms", points: [{ text: "Pool" }] }] },
    });
    const [section] = (created as unknown as { sections: (Row & { points: Row[] })[] }).sections;
    const [pool] = section.points;
    await payload.update({
      collection: "hotels",
      id: created.id,
      locale: "de",
      data: {
        sections: [{ id: section.id, title: "Zimmer", points: [{ id: pool.id, text: "Pool DE" }] }],
      } as never,
    });

    const result = await call(payload, update, {
      collection: "hotels",
      id: created.id,
      locale: "en",
      data: { sections: [{ id: section.id, points: [{ id: pool.id }, { text: "Spa" }] }] },
    });

    expect(result).toEqual({ id: created.id });
    const read = async (locale: "en" | "de") =>
      (
        (await payload.findByID({
          collection: "hotels",
          id: created.id,
          locale,
          fallbackLocale: false,
          depth: 0,
        })) as unknown as { sections: (Row & { points: Row[] })[] }
      ).sections[0];
    expect(await read("en")).toMatchObject({
      title: "Rooms",
      points: [{ text: "Pool" }, { text: "Spa" }],
    });
    const de = await read("de");
    expect(de.title).toBe("Zimmer");
    expect(de.points.map((point) => point.text ?? null)).toEqual(["Pool DE", null]);
  });
});
