import { describe, it, expect } from "vitest";
import { extractLexicalSummary, toFieldSchemas } from "../index.js";

/**
 * A lexical editor as it appears on a sanitized Payload config: an object with
 * a `features` array of `{ key, serverFeatureProps }`. The extractor reads this
 * structurally, so it has no hard dependency on @payloadcms/richtext-lexical.
 */
function editor(features: { key: string; serverFeatureProps?: unknown }[]) {
  return { features };
}

/**
 * The other shape Payload exposes: `editor.editorConfig.resolvedFeatureMap`, a
 * deduped `Map` of feature key → resolved feature carrying
 * `sanitizedServerFeatureProps`. This is the path real configs hit.
 */
function resolvedEditor(
  features: { key: string; sanitizedServerFeatureProps?: unknown; nodeTypes?: string[] }[],
) {
  const resolvedFeatureMap = new Map(
    features.map((f) => [
      f.key,
      {
        sanitizedServerFeatureProps: f.sanitizedServerFeatureProps,
        // Mirror Payload's resolved-feature `nodes` shape: each entry is
        // `{ node }` where `node.getType()` returns the node's `type` string.
        nodes: (f.nodeTypes ?? []).map((type) => ({ node: { getType: () => type } })),
      },
    ]),
  );
  return { editorConfig: { resolvedFeatureMap } };
}

describe("toFieldSchemas lexical summary", () => {
  it("buckets text-format marks into textFormats, sorted and deduped", () => {
    const [field] = toFieldSchemas([
      {
        name: "content",
        type: "richText",
        editor: editor([
          { key: "bold" },
          { key: "italic" },
          { key: "inlineCode" },
          { key: "bold" },
        ]),
      },
    ]);
    // inlineCode maps to the format-bit name `code`.
    expect(field.lexicalFeatures?.textFormats).toEqual(["bold", "code", "italic"]);
  });

  it("maps element features to their richtext node `type` strings", () => {
    const [field] = toFieldSchemas([
      {
        name: "content",
        type: "richText",
        editor: editor([{ key: "paragraph" }, { key: "blockquote" }, { key: "horizontalRule" }]),
      },
    ]);
    expect(field.lexicalFeatures?.blockNodes).toEqual({
      paragraph: true,
      quote: true,
      horizontalrule: true,
    });
  });

  it("collapses list variants into a single `list` node with its types", () => {
    const [field] = toFieldSchemas([
      {
        name: "content",
        type: "richText",
        editor: editor([{ key: "orderedList" }, { key: "unorderedList" }, { key: "checklist" }]),
      },
    ]);
    expect(field.lexicalFeatures?.blockNodes.list).toEqual({
      types: ["bullet", "check", "number"],
    });
  });

  it("collects align/indent as layoutProps, not block nodes", () => {
    const [field] = toFieldSchemas([
      {
        name: "content",
        type: "richText",
        editor: editor([{ key: "align" }, { key: "indent" }, { key: "paragraph" }]),
      },
    ]);
    expect(field.lexicalFeatures?.layoutProps).toEqual(["align", "indent"]);
    expect(field.lexicalFeatures?.blockNodes).toEqual({ paragraph: true });
  });

  it("drops editor-chrome and debug feature keys", () => {
    const [field] = toFieldSchemas([
      {
        name: "content",
        type: "richText",
        editor: editor([
          { key: "toolbarFixed" },
          { key: "toolbarInline" },
          { key: "treeView" },
          { key: "bold" },
        ]),
      },
    ]);
    expect(field.lexicalFeatures).toEqual({ textFormats: ["bold"], blockNodes: {} });
  });

  it("projects enabled heading sizes, defaulting to all six when unspecified", () => {
    const [withSizes] = toFieldSchemas([
      {
        name: "a",
        type: "richText",
        editor: editor([
          { key: "heading", serverFeatureProps: { enabledHeadingSizes: ["h2", "h3"] } },
        ]),
      },
    ]);
    expect(withSizes.lexicalFeatures?.blockNodes.heading).toEqual({ sizes: ["h2", "h3"] });

    const [withoutSizes] = toFieldSchemas([
      { name: "b", type: "richText", editor: editor([{ key: "heading" }]) },
    ]);
    expect(withoutSizes.lexicalFeatures?.blockNodes.heading).toEqual({
      sizes: ["h1", "h2", "h3", "h4", "h5", "h6"],
    });
  });

  it("surfaces link as an inline node with its target collections", () => {
    const [field] = toFieldSchemas([
      {
        name: "content",
        type: "richText",
        editor: editor([
          { key: "link", serverFeatureProps: { enabledCollections: ["pages", "posts"] } },
        ]),
      },
    ]);
    expect(field.lexicalFeatures?.inlineNodes?.link).toEqual({
      enabledCollections: ["pages", "posts"],
    });
  });

  it("surfaces custom link fields once they sanitize to an array", () => {
    const [field] = toFieldSchemas([
      {
        name: "content",
        type: "richText",
        editor: editor([
          { key: "link", serverFeatureProps: { fields: [{ name: "rel", type: "text" }] } },
        ]),
      },
    ]);
    expect(field.lexicalFeatures?.inlineNodes?.link?.fields).toEqual([
      { name: "rel", type: "text" },
    ]);
  });

  it("omits link fields while they are still a callback", () => {
    const [field] = toFieldSchemas([
      {
        name: "content",
        type: "richText",
        editor: editor([{ key: "link", serverFeatureProps: { fields: () => [] } }]),
      },
    ]);
    expect(field.lexicalFeatures?.inlineNodes?.link?.fields).toBeUndefined();
  });

  it("surfaces relationship as a block node with its enabled collections", () => {
    const [field] = toFieldSchemas([
      {
        name: "content",
        type: "richText",
        editor: editor([
          { key: "relationship", serverFeatureProps: { enabledCollections: ["authors"] } },
        ]),
      },
    ]);
    expect(field.lexicalFeatures?.blockNodes.relationship).toEqual({
      enabledCollections: ["authors"],
    });
  });

  it("does not report a phantom allow-list for a default upload feature", () => {
    // A default `UploadFeature()` configures no enabled/disabled collections, so
    // uploads are authorable against any upload collection. The summary must not
    // surface `collections: []`, which reads as "no collections to upload to".
    const [field] = toFieldSchemas([
      { name: "content", type: "richText", editor: editor([{ key: "upload" }]) },
    ]);
    expect(field.lexicalFeatures?.blockNodes.upload).toEqual({});
  });

  it("surfaces upload enabled/disabled collections like relationship", () => {
    const [enabled] = toFieldSchemas([
      {
        name: "a",
        type: "richText",
        editor: editor([{ key: "upload", serverFeatureProps: { enabledCollections: ["media"] } }]),
      },
    ]);
    expect(enabled.lexicalFeatures?.blockNodes.upload).toEqual({ enabledCollections: ["media"] });

    const [disabled] = toFieldSchemas([
      {
        name: "b",
        type: "richText",
        editor: editor([
          { key: "upload", serverFeatureProps: { disabledCollections: ["secrets"] } },
        ]),
      },
    ]);
    expect(disabled.lexicalFeatures?.blockNodes.upload).toEqual({
      disabledCollections: ["secrets"],
    });
  });

  it("surfaces per-collection custom upload fields keyed by collection slug", () => {
    // `UploadFeature({ collections: { media: { fields } } })` adds custom fields
    // to the upload node when it targets that collection — extra data an agent
    // must author, so it belongs in the summary keyed by collection.
    const [field] = toFieldSchemas([
      {
        name: "content",
        type: "richText",
        editor: editor([
          {
            key: "upload",
            serverFeatureProps: {
              collections: {
                media: { fields: [{ name: "caption", type: "text", required: true }] },
              },
            },
          },
        ]),
      },
    ]);
    expect(field.lexicalFeatures?.blockNodes.upload).toEqual({
      fields: { media: [{ name: "caption", type: "text", required: true }] },
    });
  });

  it("projects block slugs and registers inline blocks on the shared blocksBySlug map", () => {
    // Schema has two richText fields: one defines an inline `callout` block;
    // the other references it by slug. The reference should resolve to the
    // inline block's fields, mirroring how top-level `blockReferences` work.
    const blocksBySlug: Record<string, unknown> = {};
    const [defining, referencing] = toFieldSchemas(
      [
        {
          name: "intro",
          type: "richText",
          editor: editor([
            {
              key: "blocks",
              serverFeatureProps: {
                blocks: [
                  { slug: "callout", fields: [{ name: "text", type: "text", required: true }] },
                ],
              },
            },
            {
              key: "inlineBlocks",
              serverFeatureProps: { blocks: [{ slug: "mention", fields: [] }] },
            },
          ]),
        },
        {
          name: "body",
          type: "blocks",
          blockReferences: ["callout"],
          blocks: [],
        },
      ],
      blocksBySlug,
    );
    expect(defining.lexicalFeatures?.blockNodes.block).toEqual({ slugs: ["callout"] });
    expect(defining.lexicalFeatures?.inlineNodes?.inlineBlock).toEqual({ slugs: ["mention"] });
    expect(referencing.blocks).toEqual([
      { slug: "callout", fields: [{ name: "text", type: "text", required: true }] },
    ]);
  });

  it("reads features from a resolvedFeatureMap (the real sanitized shape)", () => {
    const [field] = toFieldSchemas([
      {
        name: "content",
        type: "richText",
        editor: resolvedEditor([
          { key: "bold" },
          { key: "heading", sanitizedServerFeatureProps: { enabledHeadingSizes: ["h2"] } },
          { key: "link", sanitizedServerFeatureProps: { enabledCollections: ["pages"] } },
          { key: "toolbarInline" },
        ]),
      },
    ]);
    expect(field.lexicalFeatures).toEqual({
      textFormats: ["bold"],
      blockNodes: { heading: { sizes: ["h2"] } },
      inlineNodes: { link: { enabledCollections: ["pages"] } },
    });
  });

  it("surfaces a custom feature's node types under customNodes (key ≠ node type)", () => {
    // Mirrors `createServerFeature({ key: "spoiler", feature: { nodes: [...] } })`
    // registering a node whose `getType()` returns "spoilerBlock". The feature
    // key and node type intentionally differ — agents emit the node type, so
    // that is what we surface. Verified end-to-end against a real custom feature
    // sanitized by @payloadcms/richtext-lexical.
    const [field] = toFieldSchemas([
      {
        name: "content",
        type: "richText",
        editor: resolvedEditor([{ key: "bold" }, { key: "spoiler", nodeTypes: ["spoilerBlock"] }]),
      },
    ]);
    expect(field.lexicalFeatures).toEqual({
      textFormats: ["bold"],
      blockNodes: {},
      customNodes: ["spoilerBlock"],
    });
  });

  it("keeps built-in node types out of customNodes when a custom feature replaces one", () => {
    // A custom feature that replaces the paragraph node still reports node type
    // "paragraph"; that's already covered by a projection, so it must not leak
    // into customNodes.
    const [field] = toFieldSchemas([
      {
        name: "content",
        type: "richText",
        editor: resolvedEditor([
          { key: "paragraph", nodeTypes: ["paragraph"] },
          { key: "customParagraph", nodeTypes: ["paragraph"] },
        ]),
      },
    ]);
    expect(field.lexicalFeatures?.customNodes).toBeUndefined();
    expect(field.lexicalFeatures?.blockNodes).toEqual({ paragraph: true });
  });

  it("ignores custom features that register no authorable nodes", () => {
    // A behavior-only custom feature (hooks, toolbar, no nodes) contributes
    // nothing an agent can emit, so it leaves no trace in the summary.
    const [field] = toFieldSchemas([
      {
        name: "content",
        type: "richText",
        editor: resolvedEditor([{ key: "bold" }, { key: "analytics", nodeTypes: [] }]),
      },
    ]);
    expect(field.lexicalFeatures).toEqual({ textFormats: ["bold"], blockNodes: {} });
  });

  it("is available standalone for consumers that build their own field schemas", () => {
    // Consumers with their own field walker need the summary without routing a
    // whole field through toFieldSchemas just to read one key off the result.
    const blocksBySlug: Record<string, any> = {};
    const summary = extractLexicalSummary(
      {
        name: "content",
        type: "richText",
        editor: editor([
          { key: "bold" },
          {
            key: "blocks",
            serverFeatureProps: {
              blocks: [{ slug: "callout", fields: [{ name: "text", type: "text" }] }],
            },
          },
        ]),
      },
      blocksBySlug,
    );
    expect(summary).toEqual({
      textFormats: ["bold"],
      blockNodes: { block: { slugs: ["callout"] } },
    });
    // Inline BlocksFeature definitions land in the shared map, as via toFieldSchemas.
    expect(blocksBySlug.callout?.slug).toBe("callout");
  });

  it("omits the lexicalFeatures key when no recognizable editor is present", () => {
    const [field] = toFieldSchemas([
      { name: "content", type: "richText", editor: { something: "else" } },
    ]);
    expect(field.lexicalFeatures).toBeUndefined();
  });
});
