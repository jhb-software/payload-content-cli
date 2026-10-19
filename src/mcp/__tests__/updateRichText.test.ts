/**
 * Runs the tool against a real Payload with an in-memory SQLite database, so
 * the draft/publish semantics, locales and access checks are Payload's own.
 */

import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { BlocksFeature, lexicalEditor } from "@payloadcms/richtext-lexical";
import { buildConfig, createLocalReq, getPayload, type Payload } from "payload";
import { beforeAll, describe, expect, it } from "vitest";
import { buildBlock, buildInternalLink, buildParagraph, buildText } from "../../lexical/nodes.js";
import { updateRichTextTool, type McpContentToolsOptions } from "../index.js";

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
      typescript: { outputFile: "/dev/null" },
      localization: { locales: ["en", "de"], defaultLocale: "en" },
      collections: [
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
          slug: "articles",
          access: open,
          versions: { drafts: true },
          fields: [
            { name: "title", type: "text", required: true },
            { name: "content", type: "richText", editor },
          ],
        },
      ],
      globals: [
        { slug: "footer", access: open, fields: [{ name: "content", type: "richText", editor }] },
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

async function call(args: Record<string, unknown>, options?: McpContentToolsOptions) {
  const req = await createLocalReq({}, payload);
  const response = await updateRichTextTool(options).handler(args, req);
  return JSON.parse(response.content[0].text) as unknown;
}

async function readPost(id: string | number, draft: boolean, locale = "en") {
  const post = await payload.findByID({ collection: "posts", id, draft, locale, depth: 0 });
  return JSON.stringify(post.content);
}

describe("updateRichText", () => {
  it("reads a field as an outline, then one node as compact JSON", async () => {
    const page = await payload.create({ collection: "pages", data: { title: "Safety" } });
    const id = await createPost(page.id);

    expect(await call({ collection: "posts", id, path: "content", operation: "read" })).toEqual([
      "content.0 p: Intro",
      "content.1 block alert [1 link]: See safety",
    ]);
    expect(await call({ collection: "posts", id, path: "content.0", operation: "read" })).toEqual({
      type: "paragraph",
      version: 1,
      children: [{ type: "text", version: 1, text: "Intro" }],
    });
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
    ).toMatchObject({ count: 3 });
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

  it("reads and writes the locale the resolveLocale hook picks", async () => {
    const page = await payload.create({ collection: "pages", data: { title: "Safety" } });
    const id = await createPost(page.id);

    const outline = await call(
      { collection: "posts", id, path: "content", operation: "read" },
      { resolveLocale: () => "de" },
    );

    expect(outline).toEqual(["content.0 p: Einleitung"]);
  });

  it("starts a locale's empty rich text instead of editing another locale's text through fallback", async () => {
    const post = await payload.create({
      collection: "posts",
      data: { content: richText(buildParagraph("English")), _status: "published" } as never,
      locale: "en",
    });
    const id = post.id;

    expect(
      await call({ collection: "posts", id, path: "content", operation: "read", locale: "de" }),
    ).toEqual([]);
    await call({
      collection: "posts",
      id,
      path: "content.0",
      operation: "insert",
      value: { type: "p", text: "Deutsch" },
      locale: "de",
    });

    expect(await readPost(id, true, "de")).toContain("Deutsch");
    expect(await readPost(id, true, "de")).not.toContain("English");
    expect(await readPost(id, true, "en")).toContain("English");
  });

  it("refuses the ids checkId rejects, before looking them up", async () => {
    const result = await call(
      { collection: "posts", id: "post_123", path: "content", operation: "read" },
      {
        checkId: (_collection, id) =>
          String(id).includes("_") ? "Use the numeric id." : undefined,
      },
    );

    expect(result).toEqual({ error: "Use the numeric id." });
  });

  it("reports a path mistake with its code and what the path could have said", async () => {
    const page = await payload.create({ collection: "pages", data: { title: "Safety" } });
    const id = await createPost(page.id);

    const result = await call({ collection: "posts", id, path: "content.5", operation: "read" });

    expect(result).toEqual({ error: expect.stringMatching(/2 nodes \(0–1\).*PATH_NOT_FOUND/) });
  });
});
