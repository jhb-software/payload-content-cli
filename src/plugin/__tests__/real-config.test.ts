/**
 * The plugin reads Payload's *sanitized* config structurally (see the `any`s
 * across `src/plugin/*`), so every other plugin test builds its input by hand —
 * which means those tests agree with our assumptions rather than with Payload's.
 * This suite runs the real `buildConfig()` and a real `lexicalEditor()` through
 * the endpoint handler instead, so a Payload upgrade that renames a feature key
 * or reshapes a field fails here rather than silently degrading a user's schema.
 *
 * No network and no database: `buildConfig` only sanitizes, so a stub adapter
 * is enough.
 */

import { describe, it, expect } from "vitest";
import { buildConfig } from "payload";
import {
  lexicalEditor,
  BlocksFeature,
  HeadingFeature,
  LinkFeature,
  UploadFeature,
  BoldFeature,
  ItalicFeature,
  UnorderedListFeature,
  OrderedListFeature,
  HorizontalRuleFeature,
  BlockquoteFeature,
} from "@payloadcms/richtext-lexical";
import { contentCliPlugin } from "../index.js";
import { SCHEMA_CONTRACT_VERSION } from "../../schema-contract.js";
import type { SchemaResponse } from "../../schema-contract.js";

// buildConfig sanitizes only — it never connects, so the adapter is never used.
const stubDb = (() => ({ name: "stub", init: () => {} })) as never;

async function buildSchemaResponse(): Promise<SchemaResponse> {
  const config = await buildConfig({
    secret: "test-secret",
    db: stubDb,
    typescript: { outputFile: "/dev/null" },
    plugins: [contentCliPlugin()],
    collections: [
      {
        slug: "media",
        upload: true,
        fields: [],
      },
      {
        slug: "posts",
        versions: { drafts: true },
        fields: [
          { name: "title", type: "text", required: true },
          { name: "author", type: "relationship", relationTo: "media" },
          { name: "tags", type: "text", hasMany: true },
          {
            name: "layout",
            type: "blocks",
            blocks: [{ slug: "hero", fields: [{ name: "headline", type: "text" }] }],
          },
          {
            name: "body",
            type: "richText",
            editor: lexicalEditor({
              features: [
                BoldFeature(),
                ItalicFeature(),
                HeadingFeature({ enabledHeadingSizes: ["h2", "h3"] }),
                UnorderedListFeature(),
                OrderedListFeature(),
                BlockquoteFeature(),
                HorizontalRuleFeature(),
                LinkFeature({ enabledCollections: ["posts"] }),
                UploadFeature(),
                BlocksFeature({
                  blocks: [{ slug: "callout", fields: [{ name: "text", type: "text" }] }],
                }),
              ],
            }),
          },
        ],
      },
    ],
    globals: [{ slug: "settings", fields: [{ name: "siteName", type: "text" }] }],
  });

  const endpoint = (config.endpoints ?? []).find((ep) => ep.path === "/content-cli/schema");
  if (!endpoint) throw new Error("plugin did not register the schema endpoint");

  const req = { user: { id: "1" }, payload: { config } } as never;
  const response = (await endpoint.handler(req)) as Response;
  return (await response.json()) as SchemaResponse;
}

describe("schema projection against a real sanitized Payload config", () => {
  it("serves the contract shape for every readable entity", async () => {
    const body = await buildSchemaResponse();

    expect(body.version).toBe(SCHEMA_CONTRACT_VERSION);
    // Payload adds its own collections (users, payload-preferences, …) during
    // sanitization, and the endpoint reports whatever the request may read —
    // so assert the declared ones are present rather than pinning the full set.
    expect(Object.keys(body.collections)).toEqual(expect.arrayContaining(["media", "posts"]));
    expect(Object.keys(body.globals)).toEqual(["settings"]);
    expect(body.collections.posts.jsonSchema).toBeDefined();
  });

  it("projects field types and flags the way Payload actually sanitizes them", async () => {
    const body = await buildSchemaResponse();
    const byName = Object.fromEntries(body.collections.posts.fields.map((f) => [f.name, f]));

    expect(byName.title).toMatchObject({ type: "text", required: true });
    expect(byName.author).toMatchObject({ type: "relationship", relationTo: "media" });
    expect(byName.tags).toMatchObject({ type: "text", hasMany: true });

    // Payload injects these during sanitization; the projection must recognize
    // them as bookkeeping rather than author-declared content.
    expect(byName.createdAt?.system).toBe(true);
    expect(byName.updatedAt?.system).toBe(true);
    expect(byName._status?.system).toBe(true);
  });

  it("resolves blocks fields through Payload's blockReferences handling", async () => {
    const body = await buildSchemaResponse();
    const layout = body.collections.posts.fields.find((f) => f.name === "layout");

    // The endpoint inlines blocks; the slug must survive whichever way Payload
    // stored the definition (inline array vs. hoisted into config.blocks).
    expect(layout?.blocks?.map((b) => b.slug)).toEqual(["hero"]);
    expect(layout?.blocks?.[0].fields.map((f) => f.name)).toContain("headline");
  });

  it("maps every configured lexical feature to a typed node, not customNodes", async () => {
    const body = await buildSchemaResponse();
    const body_ = body.collections.posts.fields.find((f) => f.name === "body");
    const features = body_?.lexicalFeatures;

    expect(features).toBeDefined();
    expect(features?.textFormats).toEqual(expect.arrayContaining(["bold", "italic"]));
    expect(features?.blockNodes.heading).toEqual({ sizes: ["h2", "h3"] });
    expect(features?.blockNodes.list?.types).toEqual(["bullet", "number"]);
    expect(features?.blockNodes.quote).toBe(true);
    expect(features?.blockNodes.horizontalrule).toBe(true);
    expect(features?.blockNodes.upload).toBeDefined();
    expect(features?.blockNodes.block?.slugs).toEqual(["callout"]);
    expect(features?.inlineNodes?.link?.enabledCollections).toEqual(["posts"]);

    // The regression this suite exists for: a renamed or restructured feature
    // key stops matching FEATURE_PROJECTIONS and silently degrades into
    // customNodes, so agents lose the typed description of that node.
    expect(features?.customNodes ?? []).toEqual([]);
  });
});
