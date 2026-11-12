/**
 * Runs the tool against a real Payload with an in-memory SQLite database, so
 * the draft/publish semantics, locales and access checks are Payload's own.
 */

import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { BlocksFeature, lexicalEditor } from "@payloadcms/richtext-lexical";
import { buildConfig, createLocalReq, getPayload, type Payload } from "payload";
import { beforeAll, describe, expect, it } from "vitest";
import { z } from "zod/v3";
import { buildBlock, buildInternalLink, buildParagraph, buildText } from "../../lexical/nodes.js";
import { createMcpContentTools, type McpContentToolsOptions } from "../index.js";
import { toolNamed } from "./payload.js";

const open = { read: () => true, create: () => true, update: () => true };

const editor = lexicalEditor({
  features: ({ defaultFeatures }) => [
    ...defaultFeatures,
    BlocksFeature({
      blocks: [
        {
          slug: "alert",
          fields: [
            { name: "style", type: "text" },
            { name: "body", type: "richText", editor: lexicalEditor() },
          ],
        },
      ],
    }),
  ],
});

let payload: Payload;

beforeAll(async () => {
  payload = await getPayload({
    config: buildConfig({
      secret: "test-secret",
      db: sqliteAdapter({ client: { url: ":memory:" } }),
      typescript: { autoGenerate: false },
      localization: { locales: ["en", "de"], defaultLocale: "en" },
      collections: [
        {
          slug: "settings",
          access: open,
          fields: Array.from({ length: 35 }, (_, i) => ({ name: `f${i}`, type: "text" as const })),
        },
        {
          slug: "pages",
          access: open,
          fields: [
            { name: "title", type: "text" },
            { name: "layout", type: "blocks", blocks: [{ slug: "hero", fields: [] }] },
          ],
        },
        {
          slug: "posts",
          access: open,
          versions: { drafts: true },
          fields: [{ name: "content", type: "richText", localized: true, editor }],
        },
        {
          slug: "guides",
          access: open,
          fields: [
            {
              name: "sections",
              type: "array",
              fields: [
                { name: "heading", type: "text" },
                { name: "body", type: "richText", editor },
              ],
            },
          ],
        },
        {
          slug: "articles",
          access: open,
          versions: { drafts: true },
          fields: [
            { name: "title", type: "text", required: true },
            { name: "content", type: "richText", editor },
            {
              name: "sections",
              type: "blocks",
              blocks: [{ slug: "text", fields: [{ name: "body", type: "richText", editor }] }],
            },
          ],
        },
        {
          slug: "landings",
          access: open,
          versions: { drafts: true },
          fields: [
            { name: "title", type: "text" },
            {
              type: "tabs",
              tabs: [
                {
                  name: "aside",
                  localized: true,
                  fields: [
                    { name: "heading", type: "richText", editor },
                    { name: "links", type: "array", fields: [{ name: "url", type: "text" }] },
                    {
                      name: "box",
                      type: "group",
                      fields: [{ name: "body", type: "richText", editor }],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
      globals: [
        {
          slug: "footer",
          access: open,
          fields: [
            { name: "content", type: "richText", editor },
            { name: "tagline", type: "text", localized: true },
          ],
        },
      ],
    }),
  });
});

function richText(...children: unknown[]) {
  return {
    root: { type: "root", direction: "ltr", format: "", indent: 0, version: 1, children },
  };
}

function internalLink(text: string, id: string | number) {
  return buildInternalLink(text, { relationTo: "pages", value: id });
}

/** A published post: an intro paragraph, and an alert block whose body links to `linkTo`. */
async function createPost(linkTo: string | number) {
  const content = richText(
    buildParagraph("Intro"),
    buildBlock({
      id: "6ad6120ac7d850432e0bcd00",
      blockType: "alert",
      style: "warning",
      body: richText(buildParagraph([buildText("See "), internalLink("safety", linkTo)])),
    }),
  );
  const post = await payload.create({
    collection: "posts",
    data: { content, _status: "published" } as never,
    locale: "en",
  });
  await payload.update({
    collection: "posts",
    id: post.id,
    data: { content: richText(buildParagraph("Einleitung")) } as never,
    locale: "de",
  });
  return post.id;
}

/**
 * A landing page whose aside has a heading in "en" only. Payload reads a
 * localized named tab back without its key in a locale that has no value for
 * it, while another locale has one.
 */
async function createLanding() {
  const landing = await payload.create({
    collection: "landings",
    data: { title: "Contact", aside: { heading: richText(buildParagraph("Contact us")) } } as never,
    draft: true,
    locale: "en",
  });
  return landing.id;
}

async function tool(
  name: string,
  args: Record<string, unknown>,
  options?: McpContentToolsOptions,
): Promise<any> {
  const req = await createLocalReq({}, payload);
  const mcpTool = toolNamed(createMcpContentTools(options), name);
  // As the MCP SDK does before the handler: refuse what the advertised schema
  // doesn't allow, and drop the keys it doesn't name.
  const checked = z.object(mcpTool.parameters).safeParse(args);
  if (!checked.success) return { error: `Input validation error: ${checked.error.message}` };
  const response = await mcpTool.handler(checked.data, req);
  return JSON.parse(response.content[0].text) as unknown;
}

const batch = (args: Record<string, unknown>, options?: McpContentToolsOptions) =>
  tool("updateRichText", args, options);

/** One edit, answering with its result (or the error). */
async function call(args: Record<string, unknown>, options?: McpContentToolsOptions) {
  const { path, operation, value, text, ...rest } = args;
  const answer = await batch({ ...rest, edits: [{ path, operation, value, text }] }, options);
  return answer.error ? answer : answer.results[0];
}

const find = (args: Record<string, unknown>, options?: McpContentToolsOptions) =>
  tool("find", args, options);

async function readPost(id: string | number, draft: boolean, locale = "en") {
  const post = await payload.findByID({ collection: "posts", id, draft, locale, depth: 0 });
  return JSON.stringify(post.content);
}

describe("find", () => {
  it("shows rich text as an outline whose lines are the paths to edit", async () => {
    const page = await payload.create({ collection: "pages", data: { title: "Safety" } });
    const id = await createPost(page.id);

    expect((await find({ collection: "posts", id })).content).toEqual([
      "content.0 p: Intro",
      "content.1 block alert: See [safety]",
    ]);
  });

  it("reads one node by path as compact JSON, with the rich text inside it outlined", async () => {
    const page = await payload.create({ collection: "pages", data: { title: "Safety" } });
    const id = await createPost(page.id);

    expect(await find({ collection: "posts", id, path: "content.0" })).toEqual({
      type: "paragraph",
      version: 1,
      children: [{ type: "text", version: 1, text: "Intro" }],
    });
    expect(await find({ collection: "posts", id, path: "content.1" })).toMatchObject({
      fields: { blockType: "alert", body: ["content.1.fields.body.0 p: See [safety]"] },
    });
  });

  it("reads several paths at once, keyed by path", async () => {
    const id = await createPost(1);

    const result = await find({
      collection: "posts",
      id,
      path: ["content.0.children.0.text", "content.1.fields.style"],
    });

    expect(result).toEqual({
      "content.0.children.0.text": "Intro",
      "content.1.fields.style": "warning",
    });
  });

  it("finds text in rich text by path, marking text that is already linked", async () => {
    const page = await payload.create({ collection: "pages", data: { title: "Safety" } });
    const id = await createPost(page.id);

    expect(await find({ collection: "posts", id, text: "safety" })).toEqual([
      {
        path: "content.1.fields.body.0.children.1.children.0",
        context: "safety",
        linked: true,
      },
    ]);
  });

  it("reads the locale the resolveLocale hook picks", async () => {
    const page = await payload.create({ collection: "pages", data: { title: "Safety" } });
    const id = await createPost(page.id);

    const outline = await find(
      { collection: "posts", id, path: "content" },
      { resolveLocale: () => "de" },
    );

    expect(outline).toEqual(["content.0 p: Einleitung"]);
  });
});

describe("find on a path the stored document lacks", () => {
  it("reads a field this locale has no value for as null", async () => {
    const id = await createLanding();

    const result = await find({
      collection: "landings",
      id,
      path: ["aside.heading", "aside.links", "title"],
      locale: "de",
    });

    expect(result).toEqual({ "aside.heading": null, "aside.links": null, title: "Contact" });
  });

  it("answers a row of a list this locale has no value for as a row past the end", async () => {
    const id = await createLanding();

    const empty = await find({
      collection: "landings",
      id,
      path: "aside.links.0.url",
      locale: "en",
    });
    const missing = await find({
      collection: "landings",
      id,
      path: "aside.links.0.url",
      locale: "de",
    });

    expect(missing).toEqual({ error: 'No "0" at aside.links: it has no items.' });
    expect(missing).toEqual(empty);
  });

  it("names the fields the schema has where a path names one it doesn't, in a tab with no value", async () => {
    const id = await createLanding();

    const result = await find({ collection: "landings", id, path: "aside.headng", locale: "de" });

    expect(result).toEqual({ error: 'No "headng" in aside. Its fields: heading, links, box.' });
  });

  it("names only the first 30 fields of a level that has more", async () => {
    const { id } = await payload.create({ collection: "settings", data: {} });

    const result = await find({ collection: "settings", id, path: "nope" });

    const first30 = Array.from({ length: 30 }, (_, i) => `f${i}`).join(", ");
    expect(result).toEqual({
      error: `No "nope" in the document. Its fields: ${first30} and 5 more (see getEntitySchema).`,
    });
  });
});

describe("update with rich text as find shows it", () => {
  it("keeps rich text sent back as an unchanged outline", async () => {
    const page = await payload.create({ collection: "pages", data: { title: "Safety" } });
    const id = await createPost(page.id);
    const before = await readPost(id, true);
    const { content } = await find({ collection: "posts", id });

    const result = await tool("update", { collection: "posts", id, data: { content } });

    expect(result).toEqual({ id, status: "draft" });
    expect(await readPost(id, true)).toBe(before);
  });

  it("refuses an edited outline, pointing to the node paths instead", async () => {
    const page = await payload.create({ collection: "pages", data: { title: "Safety" } });
    const id = await createPost(page.id);
    const before = await readPost(id, true);

    const result = await tool("update", {
      collection: "posts",
      id,
      data: { content: ["content.0 p: Changed", "content.1 block alert: See [safety]"] },
    });

    expect(result).toEqual({ error: expect.stringMatching(/outline.*content\.<index>/) });
    expect(await readPost(id, true)).toBe(before);
  });
});

describe("create and update with rich text", () => {
  it("update takes a rich-text field as a list of nodes, shorthand included", async () => {
    const id = await createPost(1);

    const result = await tool("update", {
      collection: "posts",
      id,
      data: {
        content: [
          { type: "h2", text: "Visa" },
          { type: "p", text: "Apply early." },
        ],
      },
    });

    expect(result).toEqual({ id, status: "draft" });
    expect((await find({ collection: "posts", id })).content).toEqual([
      "content.0 h2: Visa",
      "content.1 p: Apply early.",
    ]);
    const stored = await payload.findByID({ collection: "posts", id, draft: true, locale: "en" });
    expect(stored.content).toMatchObject({
      root: { type: "root", children: [{ type: "heading", tag: "h2" }, { type: "paragraph" }] },
    });
  });

  it("update takes rich text inside a block row sent without its blockType", async () => {
    const created = await tool("create", {
      collection: "articles",
      data: {
        title: "Visa",
        sections: [{ blockType: "text", body: [{ type: "p", text: "Old" }] }],
      },
    });
    const id = created.id as number;
    const [section] = (await payload.findByID({ collection: "articles", id, draft: true }))
      .sections as { id: string }[];

    const result = await tool("update", {
      collection: "articles",
      id,
      data: { sections: [{ id: section.id, body: [{ type: "p", text: "New" }] }] },
    });

    expect(result).toEqual({ id, status: "draft" });
    const stored = await payload.findByID({ collection: "articles", id, draft: true });
    expect(stored.sections).toMatchObject([
      { blockType: "text", body: { root: { children: [{ type: "paragraph" }] } } },
    ]);
  });

  it("create takes rich text as {root:{children}} with shorthand nodes", async () => {
    const result = await tool("create", {
      collection: "articles",
      data: { title: "Visa", content: { root: { children: [{ type: "p", text: "Hi" }] } } },
    });

    const stored = await payload.findByID({ collection: "articles", id: result.id, draft: true });
    expect(stored.content).toMatchObject({
      root: {
        type: "root",
        version: 1,
        children: [{ type: "paragraph", children: [{ type: "text", text: "Hi", format: 0 }] }],
      },
    });
  });

  it("refuses a rich-text value that isn't Lexical, leaving the stored text alone", async () => {
    const id = await createPost(1);
    const before = await readPost(id, true);

    const result = await tool("update", {
      collection: "posts",
      id,
      data: { content: "Apply early." },
    });

    expect(result).toEqual({ error: expect.stringMatching(/content is rich text/) });
    expect(await readPost(id, true)).toBe(before);
  });

  it("refuses a block the rich-text field doesn't allow", async () => {
    const result = await tool("create", {
      collection: "articles",
      data: { title: "Visa", content: [{ type: "block", fields: { blockType: "hero" } }] },
    });

    expect(result).toEqual({ error: expect.stringMatching(/"hero".*alert/) });
  });
});

describe("updateRichText", () => {
  it("links text to a document and answers with the link's path and its node's outline", async () => {
    const page = await payload.create({ collection: "pages", data: { title: "Safety" } });
    const intro = await payload.create({ collection: "pages", data: { title: "Intro" } });
    const id = await createPost(page.id);

    const result = await call({
      collection: "posts",
      id,
      path: "content",
      operation: "link",
      text: "Intro",
      value: { relationTo: "pages", value: intro.id },
    });

    expect(result).toEqual({
      linked: "content.0.children.0",
      outline: "content.0 p: [Intro]",
    });
    expect(await find({ collection: "posts", id, path: "content.0.children.0.fields" })).toEqual({
      linkType: "internal",
      newTab: false,
      doc: { relationTo: "pages", value: intro.id },
    });
  });

  it("refuses to link to a document that doesn't exist", async () => {
    const page = await payload.create({ collection: "pages", data: { title: "Safety" } });
    const id = await createPost(page.id);

    const result = await call({
      collection: "posts",
      id,
      path: "content",
      operation: "link",
      text: "Intro",
      value: { relationTo: "pages", value: 999999 },
    });

    expect(result).toEqual({ error: expect.stringContaining("doesn't exist") });
  });

  it("retargets a link inside a block as a draft, leaving the live version and other locales alone", async () => {
    const oldPage = await payload.create({ collection: "pages", data: { title: "Old" } });
    const newPage = await payload.create({ collection: "pages", data: { title: "New" } });
    const id = await createPost(oldPage.id);
    const liveBefore = await readPost(id, false);
    const germanBefore = await readPost(id, true, "de");

    const result = await call({
      collection: "posts",
      id,
      path: "content.1.fields.body.0.children.1.fields.doc.value",
      operation: "set",
      value: newPage.id,
    });

    expect(result).toEqual({ set: "content.1.fields.body.0.children.1.fields.doc.value" });
    expect(await readPost(id, true)).toContain(`"value":${JSON.stringify(newPage.id)}`);
    expect(await readPost(id, false)).toBe(liveBefore);
    expect(await readPost(id, true, "de")).toBe(germanBefore);
  });

  it("refuses a link to a document that doesn't exist", async () => {
    const page = await payload.create({ collection: "pages", data: { title: "Safety" } });
    const id = await createPost(page.id);
    const before = await readPost(id, true);

    const result = await call({
      collection: "posts",
      id,
      path: "content.1.fields.body.0.children.1.fields.doc.value",
      operation: "set",
      value: 999999,
    });

    expect(result).toEqual({ error: expect.stringContaining('pages "999999"') });
    expect(await readPost(id, true)).toBe(before);
  });

  it("asks for relationTo when an upload node's default media collection doesn't exist", async () => {
    const page = await payload.create({ collection: "pages", data: { title: "Safety" } });
    const id = await createPost(page.id);

    const result = await call({
      collection: "posts",
      id,
      path: "content.0",
      operation: "insert",
      value: { type: "upload", value: 1 },
    });

    expect(result).toEqual({ error: expect.stringMatching(/"media".*relationTo/) });
  });

  it("refuses a block the config doesn't define", async () => {
    const page = await payload.create({ collection: "pages", data: { title: "Safety" } });
    const id = await createPost(page.id);

    const result = await call({
      collection: "posts",
      id,
      path: "content.0",
      operation: "insert",
      value: { type: "block", fields: { blockType: "carousel" } },
    });

    expect(result).toEqual({ error: expect.stringContaining('"carousel"') });
  });

  it("refuses a block that exists in the config but not in this rich-text field", async () => {
    const page = await payload.create({ collection: "pages", data: { title: "Safety" } });
    const id = await createPost(page.id);
    const before = await readPost(id, true);

    const topLevel = await call({
      collection: "posts",
      id,
      path: "content.0",
      operation: "insert",
      value: { type: "block", fields: { blockType: "hero" } },
    });
    const nested = await call({
      collection: "posts",
      id,
      path: "content.1.fields.body.0",
      operation: "insert",
      value: { type: "block", fields: { blockType: "alert" } },
    });

    expect(topLevel).toEqual({ error: expect.stringMatching(/"hero".*alert/) });
    expect(nested).toEqual({ error: expect.stringContaining('"alert"') });
    expect(await readPost(id, true)).toBe(before);
  });

  it("publishes with draft:false, but not over newer draft changes unless told to", async () => {
    const page = await payload.create({ collection: "pages", data: { title: "Safety" } });
    const id = await createPost(page.id);
    const publish = { collection: "posts", id, operation: "insert", draft: false };

    expect(
      await call({ ...publish, path: "content.0", value: { type: "h2", text: "Live" } }),
    ).toEqual({ inserted: "content.0 h2: Live" });
    expect(await readPost(id, false)).toContain('"text":"Live"');

    await call({
      collection: "posts",
      id,
      path: "content.0",
      operation: "insert",
      value: { type: "p", text: "Pending" },
    });
    const refused = await call({
      ...publish,
      path: "content.0",
      value: { type: "p", text: "Over it" },
    });
    expect(refused).toEqual({ error: expect.stringContaining("unpublished draft changes") });
    expect(await readPost(id, false)).not.toContain("Over it");

    await call({
      ...publish,
      path: "content.0",
      value: { type: "p", text: "Over it" },
      overwriteDraft: true,
    });
    expect(await readPost(id, false)).toContain("Over it");
  });

  it("names the failing field and why when publishing an invalid document", async () => {
    const article = await payload.create({
      collection: "articles",
      data: { _status: "draft" } as never,
      draft: true,
    });

    const result = await call({
      collection: "articles",
      id: article.id,
      path: "content.0",
      operation: "insert",
      value: { type: "p", text: "Hello" },
      draft: false,
    });

    expect(result).toEqual({ error: expect.stringMatching(/title.*required/is) });
  });

  it("edits a global", async () => {
    await payload.updateGlobal({
      slug: "footer",
      data: { content: richText(buildParagraph("Old")) } as never,
    });

    await call({
      collection: "globals/footer",
      path: "content.0",
      operation: "set",
      value: { type: "p", text: "New" },
    });

    const footer = await payload.findGlobal({ slug: "footer", depth: 0 });
    expect(JSON.stringify(footer.content)).toContain('"text":"New"');
  });

  it("edits a global in a locale without copying the default locale into its untranslated fields", async () => {
    await payload.updateGlobal({
      slug: "footer",
      locale: "en",
      data: { content: richText(buildParagraph("Old")), tagline: "Welcome" } as never,
    });

    await call({
      collection: "globals/footer",
      locale: "de",
      path: "content.0",
      operation: "set",
      value: { type: "p", text: "Neu" },
    });

    const de = await payload.findGlobal({ slug: "footer", locale: "de", fallbackLocale: false });
    expect(JSON.stringify(de.content)).toContain('"text":"Neu"');
    expect(de.tagline ?? null).toBeNull();
  });

  it("writes the locale the resolveLocale hook picks", async () => {
    const page = await payload.create({ collection: "pages", data: { title: "Safety" } });
    const id = await createPost(page.id);

    await call(
      { collection: "posts", id, path: "content.0", operation: "delete" },
      { resolveLocale: () => "de" },
    );

    expect(await readPost(id, true, "de")).not.toContain("Einleitung");
    expect(await readPost(id, true, "en")).toContain("Intro");
  });

  it("starts a locale's empty rich text instead of editing another locale's text through fallback", async () => {
    const post = await payload.create({
      collection: "posts",
      data: { content: richText(buildParagraph("English")), _status: "published" } as never,
      locale: "en",
    });
    const id = post.id;

    const result = await call({
      collection: "posts",
      id,
      path: "content.0",
      operation: "insert",
      value: { type: "p", text: "Deutsch" },
      locale: "de",
    });

    expect(result).toEqual({ inserted: "content.0 p: Deutsch" });
    expect(await readPost(id, true, "de")).toContain("Deutsch");
    expect(await readPost(id, true, "de")).not.toContain("English");
    expect(await readPost(id, true, "en")).toContain("English");
  });

  it("refuses the ids checkId rejects, before looking them up", async () => {
    const result = await call(
      { collection: "posts", id: "post_123", path: "content.0", operation: "delete" },
      {
        checkId: (_req, { id }) => (String(id).includes("_") ? "Use the numeric id." : undefined),
      },
    );

    expect(result).toEqual({ error: "Use the numeric id." });
  });

  it("reports a path mistake with what the path could have said", async () => {
    const page = await payload.create({ collection: "pages", data: { title: "Safety" } });
    const id = await createPost(page.id);

    const result = await call({ collection: "posts", id, path: "content.5", operation: "delete" });

    expect(result).toEqual({
      error: 'Edit 1 of 1 (content.5): No "5" at content: it has 2 nodes (0–1). Nothing was saved.',
    });
  });

  it("refuses changing a kept block into one the field doesn't allow", async () => {
    const page = await payload.create({ collection: "pages", data: { title: "Safety" } });
    const id = await createPost(page.id);
    const before = await readPost(id, true);

    const byValue = await call({
      collection: "posts",
      id,
      path: "content.1.fields.blockType",
      operation: "set",
      value: "hero",
    });
    const byNode = await call({
      collection: "posts",
      id,
      path: "content.1",
      operation: "set",
      value: {
        type: "block",
        fields: { id: "6ad6120ac7d850432e0bcd00", blockType: "carousel" },
      },
    });

    expect(byValue).toEqual({ error: expect.stringMatching(/"hero".*alert/) });
    expect(byNode).toEqual({ error: expect.stringContaining('"carousel"') });
    expect(await readPost(id, true)).toBe(before);
  });

  it("starts rich text nobody has written yet inside an array row", async () => {
    const guide = await payload.create({
      collection: "guides",
      data: { sections: [{ heading: "Packing" }] } as never,
    });

    const result = await call({
      collection: "guides",
      id: guide.id,
      path: "sections.0.body.0",
      operation: "insert",
      value: { type: "p", text: "Bring cash." },
    });

    expect(result).toEqual({ inserted: "sections.0.body.0 p: Bring cash." });
    const saved = await payload.findByID({ collection: "guides", id: guide.id, depth: 0 });
    expect(JSON.stringify(saved.sections)).toContain("Bring cash.");
    expect(saved.sections?.[0]?.heading).toBe("Packing");
  });

  it("starts rich text in a group inside a localized named tab this locale has no value for", async () => {
    const id = await createLanding();

    const result = await call({
      collection: "landings",
      id,
      path: "aside.box.body.0",
      operation: "insert",
      value: { type: "p", text: "Kontakt" },
      locale: "de",
    });

    expect(result).toMatchObject({ inserted: "aside.box.body.0 p: Kontakt" });
    const read = async (locale: string) =>
      JSON.stringify(
        (await payload.findByID({ collection: "landings", id, draft: true, locale })).aside,
      );
    expect(await read("de")).toContain("Kontakt");
    expect(await read("en")).toContain("Contact us");
    expect(await read("en")).not.toContain("Kontakt");
  });

  it("names the fields the schema has where a path names one it doesn't", async () => {
    const id = await createLanding();

    const result = await call({
      collection: "landings",
      id,
      path: "asid.heading.0",
      operation: "insert",
      value: { type: "p", text: "Kontakt" },
      locale: "de",
      draft: false,
    });

    expect(result).toEqual({
      error:
        'Edit 1 of 1 (asid.heading.0): No "asid" in the document. Its fields: title, aside. Nothing was saved.',
    });
  });
});

describe("updateRichText with several edits", () => {
  /** A draft post of paragraphs, read back through find's outline. */
  async function createParagraphs(...texts: string[]) {
    const post = await payload.create({
      collection: "posts",
      data: { content: richText(...texts.map((t) => buildParagraph(t))) } as never,
      draft: true,
      locale: "en",
    });
    return post.id;
  }

  const outline = async (id: string | number) => (await find({ collection: "posts", id })).content;

  const versionCount = async (collection: "posts" | "articles", id: string | number) =>
    (await payload.findVersions({ collection, where: { parent: { equals: id } } })).totalDocs;

  it("saves a batch of edits as one version, with every path as find showed it", async () => {
    const masaiMara = await payload.create({ collection: "pages", data: { title: "Masai Mara" } });
    const serengeti = await payload.create({ collection: "pages", data: { title: "Serengeti" } });
    const id = await createParagraphs(
      "Heading",
      "Kenya is great.",
      "Migration",
      "The herds reach the Masai Mara in July. Read our Serengeti guide.",
      "Outdated fees.",
      "Second to last.",
      "Contact us.",
    );
    const versionsBefore = await versionCount("posts", id);

    const answer = await batch({
      collection: "posts",
      id,
      edits: [
        { path: "content.1.children.0.text", operation: "set", value: "Kenya is year-round." },
        {
          path: "content.3",
          operation: "link",
          text: "Masai Mara",
          value: { relationTo: "pages", value: masaiMara.id },
        },
        {
          path: "content.3",
          operation: "link",
          text: "Serengeti",
          value: { relationTo: "pages", value: serengeti.id },
        },
        { path: "content.4", operation: "delete" },
        { path: "content.5.children.0.text", operation: "set", value: "Still second to last." },
        { path: "content.6", operation: "insert", value: { type: "p", text: "Book early." } },
      ],
    });

    expect(await outline(id)).toEqual([
      "content.0 p: Heading",
      "content.1 p: Kenya is year-round.",
      "content.2 p: Migration",
      "content.3 p: The herds reach the [Masai Mara] in July. Read our [Serengeti] guide.",
      "content.4 p: Still second to last.",
      "content.5 p: Book early.",
      "content.6 p: Contact us.",
    ]);
    expect(await versionCount("posts", id)).toBe(versionsBefore + 1);
    expect(answer).toEqual({
      results: [
        { set: "content.1.children.0.text" },
        {
          linked: "content.3.children.1",
          outline:
            "content.3 p: The herds reach the [Masai Mara] in July. Read our Serengeti guide.",
        },
        {
          linked: "content.3.children.3",
          outline:
            "content.3 p: The herds reach the [Masai Mara] in July. Read our [Serengeti] guide.",
        },
        { deleted: "content.4 p: Outdated fees." },
        { set: "content.5.children.0.text" },
        { inserted: "content.6 p: Book early." },
      ],
      shifted: true,
    });
  });

  it("saves nothing when one edit fails, and names that edit", async () => {
    const id = await createParagraphs("One", "Two");
    const versionsBefore = await versionCount("posts", id);

    const answer = await batch({
      collection: "posts",
      id,
      edits: [
        { path: "content.0.children.0.text", operation: "set", value: "Changed" },
        { path: "content.7", operation: "delete" },
      ],
    });

    expect(answer).toEqual({
      error: 'Edit 2 of 2 (content.7): No "7" at content: it has 2 nodes (0–1). Nothing was saved.',
    });
    expect(await outline(id)).toEqual(["content.0 p: One", "content.1 p: Two"]);
    expect(await versionCount("posts", id)).toBe(versionsBefore);
  });

  it("saves nothing when a value the batch adds links to a missing document", async () => {
    const id = await createParagraphs("One", "Two");

    const answer = await batch({
      collection: "posts",
      id,
      edits: [
        { path: "content.0.children.0.text", operation: "set", value: "Changed" },
        {
          path: "content.1",
          operation: "link",
          text: "Two",
          value: { relationTo: "pages", value: 999999 },
        },
      ],
    });

    expect(answer).toEqual({
      error: expect.stringMatching(/doesn't exist\. Nothing was saved\.$/),
    });
    expect(await outline(id)).toEqual(["content.0 p: One", "content.1 p: Two"]);
  });

  it("orders indexes as numbers, so content.10 runs before content.2", async () => {
    const id = await createParagraphs(...Array.from({ length: 11 }, (_, i) => `P${i}`));

    await batch({
      collection: "posts",
      id,
      edits: [
        { path: "content.2", operation: "delete" },
        { path: "content.10", operation: "delete" },
      ],
    });

    expect(await outline(id)).toEqual(
      ["P0", "P1", "P3", "P4", "P5", "P6", "P7", "P8", "P9"].map(
        (text, i) => `content.${i} p: ${text}`,
      ),
    );
  });

  it("replaces a node and inserts before it at the same index", async () => {
    const id = await createParagraphs("One", "Two");

    await batch({
      collection: "posts",
      id,
      edits: [
        { path: "content.1", operation: "insert", value: { type: "p", text: "New" } },
        { path: "content.1", operation: "set", value: { type: "p", text: "Replaced" } },
      ],
    });

    expect(await outline(id)).toEqual([
      "content.0 p: One",
      "content.1 p: New",
      "content.2 p: Replaced",
    ]);
  });

  it("deletes a node and inserts in its place", async () => {
    const id = await createParagraphs("One", "Two", "Three");

    await batch({
      collection: "posts",
      id,
      edits: [
        { path: "content.1", operation: "insert", value: { type: "p", text: "New" } },
        { path: "content.1", operation: "delete" },
      ],
    });

    expect(await outline(id)).toEqual([
      "content.0 p: One",
      "content.1 p: New",
      "content.2 p: Three",
    ]);
  });

  it("edits inside a node and inserts before that node", async () => {
    const id = await createParagraphs("One", "Two");

    await batch({
      collection: "posts",
      id,
      edits: [
        { path: "content.1", operation: "insert", value: { type: "p", text: "New" } },
        { path: "content.1.children.0.text", operation: "set", value: "Changed" },
      ],
    });

    expect(await outline(id)).toEqual([
      "content.0 p: One",
      "content.1 p: New",
      "content.2 p: Changed",
    ]);
  });

  it("keeps paths as read inside rich text nested in a block", async () => {
    const post = await payload.create({
      collection: "posts",
      data: {
        content: richText(
          buildParagraph("Intro"),
          buildBlock({
            id: "6ad6120ac7d850432e0bcd01",
            blockType: "alert",
            style: "warning",
            body: richText(buildParagraph("One"), buildParagraph("Two"), buildParagraph("Three")),
          }),
        ),
      } as never,
      draft: true,
      locale: "en",
    });

    await batch({
      collection: "posts",
      id: post.id,
      edits: [
        { path: "content.0", operation: "delete" },
        { path: "content.1.fields.body.0", operation: "delete" },
        { path: "content.1.fields.body.2.children.0.text", operation: "set", value: "Changed" },
      ],
    });

    expect(await find({ collection: "posts", id: post.id, path: "content.0.fields.body" })).toEqual(
      ["content.0.fields.body.0 p: Two", "content.0.fields.body.1 p: Changed"],
    );
  });

  it("refuses edits to a node and to something inside it, saving nothing", async () => {
    const id = await createParagraphs("One", "Two");

    const answer = await batch({
      collection: "posts",
      id,
      edits: [
        { path: "content.0", operation: "delete" },
        { path: "content.00.children.0.text", operation: "set", value: "Changed" },
      ],
    });

    expect(answer).toEqual({
      error: expect.stringMatching(/^Edits 1 and 2 overlap.*Nothing was saved\.$/),
    });
    expect(await outline(id)).toEqual(["content.0 p: One", "content.1 p: Two"]);
  });

  it("refuses two edits to one path written differently", async () => {
    const id = await createParagraphs("One");

    const answer = await batch({
      collection: "posts",
      id,
      edits: [
        { path: "content.0", operation: "set", value: { type: "p", text: "A" } },
        { path: "content.00", operation: "set", value: { type: "p", text: "B" } },
      ],
    });

    expect(answer).toEqual({ error: expect.stringContaining("Edits 1 and 2 overlap") });
    expect(await outline(id)).toEqual(["content.0 p: One"]);
  });

  it("refuses an insert inside a node the batch deletes", async () => {
    const id = await createParagraphs("One");

    const answer = await batch({
      collection: "posts",
      id,
      edits: [
        { path: "content.0.children.0", operation: "insert", value: { type: "text", text: "A" } },
        { path: "content.0", operation: "delete" },
      ],
    });

    expect(answer).toEqual({ error: expect.stringContaining("Edits 1 and 2 overlap") });
    expect(await outline(id)).toEqual(["content.0 p: One"]);
  });

  it("refuses two inserts at one index, pointing to insert's list form", async () => {
    const id = await createParagraphs("One");

    const answer = await batch({
      collection: "posts",
      id,
      edits: [
        { path: "content.0", operation: "insert", value: { type: "p", text: "A" } },
        { path: "content.0", operation: "insert", value: { type: "p", text: "B" } },
      ],
    });

    expect(answer).toEqual({ error: expect.stringMatching(/content\.0.*list of nodes/) });
    expect(await outline(id)).toEqual(["content.0 p: One"]);
  });

  it("links repeated text in one node in the order sent", async () => {
    const first = await payload.create({ collection: "pages", data: { title: "First" } });
    const second = await payload.create({ collection: "pages", data: { title: "Second" } });
    const id = await createParagraphs("camp one camp two");

    await batch({
      collection: "posts",
      id,
      edits: [
        {
          path: "content.0",
          operation: "link",
          text: "camp",
          value: { relationTo: "pages", value: first.id },
        },
        {
          path: "content.0",
          operation: "link",
          text: "camp",
          value: { relationTo: "pages", value: second.id },
        },
      ],
    });

    expect(await outline(id)).toEqual(["content.0 p: [camp] one [camp] two"]);
    expect(
      await find({
        collection: "posts",
        id,
        path: ["content.0.children.0.fields.doc.value", "content.0.children.2.fields.doc.value"],
      }),
    ).toEqual({
      "content.0.children.0.fields.doc.value": first.id,
      "content.0.children.2.fields.doc.value": second.id,
    });
  });

  it("refuses two links at one text node, pointing to the node holding it", async () => {
    const page = await payload.create({ collection: "pages", data: { title: "Page" } });
    const id = await createParagraphs("Lodge and camp");
    const value = { relationTo: "pages", value: page.id };

    const answer = await batch({
      collection: "posts",
      id,
      edits: [
        { path: "content.0.children.0", operation: "link", text: "Lodge", value },
        { path: "content.0.children.0", operation: "link", text: "camp", value },
      ],
    });

    expect(answer).toEqual({ error: expect.stringMatching(/text node.*content\.0\b/) });
    expect(await outline(id)).toEqual(["content.0 p: Lodge and camp"]);
  });

  it("refuses a link searching a whole field alongside another edit to that field", async () => {
    const page = await payload.create({ collection: "pages", data: { title: "Page" } });
    const id = await createParagraphs("Lodge", "Camp");

    const answer = await batch({
      collection: "posts",
      id,
      edits: [
        { path: "content.1", operation: "insert", value: { type: "p", text: "Lodge" } },
        {
          path: "content",
          operation: "link",
          text: "Lodge",
          value: { relationTo: "pages", value: page.id },
        },
      ],
    });

    expect(answer).toEqual({ error: expect.stringMatching(/Edits 1 and 2 overlap.*narrow/i) });
    expect(await outline(id)).toEqual(["content.0 p: Lodge", "content.1 p: Camp"]);
  });

  it("refuses a link whose search covers another link, instead of swapping their targets", async () => {
    const first = await payload.create({ collection: "pages", data: { title: "First" } });
    const second = await payload.create({ collection: "pages", data: { title: "Second" } });
    const id = await createParagraphs("camp one camp two");

    const answer = await batch({
      collection: "posts",
      id,
      edits: [
        {
          path: "content",
          operation: "link",
          text: "camp",
          value: { relationTo: "pages", value: first.id },
        },
        {
          path: "content.0",
          operation: "link",
          text: "camp",
          value: { relationTo: "pages", value: second.id },
        },
      ],
    });

    expect(answer).toEqual({ error: expect.stringContaining("Edits 1 and 2 overlap") });
    expect(await outline(id)).toEqual(["content.0 p: camp one camp two"]);
  });

  it("reads a path through root.children as the same path, keeping it as read", async () => {
    const id = await createParagraphs("P0", "P1", "P2", "P3", "P4");

    await batch({
      collection: "posts",
      id,
      edits: [
        { path: "content.1", operation: "delete" },
        { path: "content.root.children.3", operation: "delete" },
      ],
    });

    expect(await outline(id)).toEqual(["content.0 p: P0", "content.1 p: P2", "content.2 p: P4"]);
  });

  it("refuses overlapping edits when one path goes through root.children", async () => {
    const id = await createParagraphs("One", "Two");

    const answer = await batch({
      collection: "posts",
      id,
      edits: [
        { path: "content.0", operation: "delete" },
        { path: "content.root.children.0.children.0.text", operation: "set", value: "Changed" },
      ],
    });

    expect(answer).toEqual({ error: expect.stringContaining("Edits 1 and 2 overlap") });
    expect(await outline(id)).toEqual(["content.0 p: One", "content.1 p: Two"]);
  });

  it("publishes several edits together with draft:false", async () => {
    const post = await payload.create({
      collection: "posts",
      data: {
        content: richText(buildParagraph("One"), buildParagraph("Two")),
        _status: "published",
      } as never,
      locale: "en",
    });

    await batch({
      collection: "posts",
      id: post.id,
      draft: false,
      edits: [
        { path: "content.0.children.0.text", operation: "set", value: "Live one" },
        { path: "content.1.children.0.text", operation: "set", value: "Live two" },
      ],
    });

    const live = await readPost(post.id, false);
    expect(live).toContain("Live one");
    expect(live).toContain("Live two");
  });

  it("edits several fields and saves one version, starting rich text nobody has written", async () => {
    const article = await payload.create({
      collection: "articles",
      data: {
        title: "Visa",
        content: richText(buildParagraph("Old")),
        sections: [{ blockType: "text" }],
        _status: "draft",
      } as never,
      draft: true,
    });
    const versionsBefore = await versionCount("articles", article.id);

    const answer = await batch({
      collection: "articles",
      id: article.id,
      edits: [
        { path: "content.0.children.0.text", operation: "set", value: "New" },
        { path: "sections.0.body.0", operation: "insert", value: { type: "p", text: "Started" } },
      ],
    });

    expect(answer).toEqual({
      results: [{ set: "content.0.children.0.text" }, { inserted: "sections.0.body.0 p: Started" }],
    });
    const saved = await payload.findByID({ collection: "articles", id: article.id, draft: true });
    expect(JSON.stringify(saved.content)).toContain('"text":"New"');
    expect(JSON.stringify(saved.sections)).toContain("Started");
    expect(saved.title).toBe("Visa");
    expect(await versionCount("articles", article.id)).toBe(versionsBefore + 1);
  });

  it("says indexes moved after an insert, not after a set or an append", async () => {
    const id = await createParagraphs("One", "Two");
    const edit = (edits: unknown[]) => batch({ collection: "posts", id, edits });

    const set = await edit([{ path: "content.0.children.0.text", operation: "set", value: "A" }]);
    const appended = await edit([
      { path: "content.2", operation: "insert", value: { type: "p", text: "End" } },
    ]);
    const inserted = await edit([
      { path: "content.0", operation: "insert", value: { type: "p", text: "Start" } },
    ]);

    expect(set).not.toHaveProperty("shifted");
    expect(appended).not.toHaveProperty("shifted");
    expect(inserted).toMatchObject({ shifted: true });
  });

  it("refuses an empty list of edits instead of publishing", async () => {
    const id = await createParagraphs("One");
    const before = await payload.findByID({ collection: "posts", id, draft: true });

    const answer = await batch({ collection: "posts", id, edits: [], draft: false });

    expect(answer).toEqual({ error: expect.stringContaining("at least one edit") });
    const after = await payload.findByID({ collection: "posts", id, draft: true });
    expect(after._status).toBe(before._status);
  });

  it("takes edits sent as a JSON string, as some clients send them", async () => {
    const id = await createParagraphs("One");

    await batch({
      collection: "posts",
      id,
      edits: JSON.stringify([
        { path: "content.0.children.0.text", operation: "set", value: "Changed" },
      ]),
    });

    expect(await outline(id)).toEqual(["content.0 p: Changed"]);
  });

  it("still takes one edit as path and operation, answering as before, for clients that cached the old schema", async () => {
    const id = await createParagraphs("One", "Two");

    const answer = await batch({ collection: "posts", id, path: "content.0", operation: "delete" });

    expect(answer).toEqual({
      deleted: "content.0 p: One",
      count: 1,
      note: "Nodes after content.0 moved up by one.",
    });
    expect(await outline(id)).toEqual(["content.0 p: Two"]);
  });

  it("refuses edits sent alongside a single path, saving nothing", async () => {
    const id = await createParagraphs("One");

    const answer = await batch({
      collection: "posts",
      id,
      path: "content.0",
      operation: "delete",
      edits: [{ path: "content.0", operation: "set", value: { type: "p", text: "Changed" } }],
    });

    expect(answer.error).toMatch(/either edits or path/);
    expect(await outline(id)).toEqual(["content.0 p: One"]);
  });
});
