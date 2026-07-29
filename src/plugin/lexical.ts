/**
 * Lexical richtext feature extraction for the content-cli plugin.
 *
 * Projects a `richText` field's lexical editor config into a
 * `LexicalFeatureSummary` describing the nodes an agent may emit. Detection is
 * structural, so there is no hard dependency on `@payloadcms/richtext-lexical`.
 *
 * Types are kept inline to avoid a hard dependency on `payload`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { toFieldSchemas } from "./fields.js";
import type { FieldSchema } from "./fields.js";

/**
 * Per-`richText`-field summary of the lexical editor's enabled nodes.
 *
 * Surfaces what an agent may emit when authoring content for this field. Each
 * key under `blockNodes`/`inlineNodes` is the exact `type` string to use in the
 * richtext JSON, with the node's options (sizes, slugs, target collections, …)
 * co-located. Editor-UI-only features (toolbars, debug views) and unknown
 * feature keys are dropped — the summary only describes nodes an agent can
 * actually author.
 */
export interface LexicalFeatureSummary {
  /**
   * Text format marks that can be applied to TextNodes via the `format` bitmask.
   * Standard Lexical bit values: bold=1, italic=2, strikethrough=4, underline=8,
   * code=16, subscript=32, superscript=64.
   */
  textFormats: string[];
  /**
   * Block-level element nodes. Each key is the exact `type` string to use in
   * richtext JSON. Options (sizes, slugs, …) are co-located with their node.
   */
  blockNodes: {
    paragraph?: true;
    heading?: { sizes: string[] };
    quote?: true;
    /** All enabled list variants. Use `listType` on the node to pick the variant. */
    list?: { types: Array<"bullet" | "check" | "number"> };
    table?: true;
    horizontalrule?: true;
    /**
     * Media/file nodes. `type: "upload"`, set `relationTo` (target collection)
     * and `value` (uploaded doc id). Restrictions, when configured, are surfaced
     * as `enabledCollections`/`disabledCollections` (mirroring `relationship`);
     * an empty `{}` means any upload-enabled collection is allowed.
     */
    upload?: {
      enabledCollections?: string[];
      disabledCollections?: string[];
      /** Custom fields added to the upload node, keyed by target collection slug. */
      fields?: Record<string, FieldSchema[]>;
    };
    /** Relationship nodes. `type: "relationship"`, set `relationTo` and `value` on the node itself. */
    relationship?: { enabledCollections?: string[]; disabledCollections?: string[] };
    /** Payload block decorator nodes. `type: "block"`, set `fields.blockType` to a slug. */
    block?: { slugs: string[] };
  };
  /**
   * Inline nodes that appear inside block children.
   * Each key is the exact `type` string to use.
   */
  inlineNodes?: {
    link?: {
      enabledCollections?: string[];
      disabledCollections?: string[];
      /** Custom fields configured on the link feature, beyond the built-in URL/label. */
      fields?: FieldSchema[];
    };
    /** Payload inline-block decorator nodes. `type: "inlineBlock"`. */
    inlineBlock?: { slugs: string[] };
  };
  /**
   * Layout properties that can be set on block nodes — not node types themselves.
   * `align`: text-align (set `format` on the block). `indent`: nesting level.
   */
  layoutProps?: Array<"align" | "indent">;
  /**
   * Node `type` strings registered by custom features (or any feature without a
   * typed projection above). Emit `{ "type": "<value>", ... }` and consult the
   * feature's own docs for the rest of the node's shape. Sorted and deduped.
   */
  customNodes?: string[];
}

/**
 * Feature keys that drive editor chrome (toolbars, debug panels) and never
 * correspond to a content node an agent can emit. Dropped from the summary.
 */
const UI_FEATURE_KEYS = new Set([
  "toolbarFixed", // FixedToolbarFeature
  "toolbarInline", // InlineToolbarFeature
  "treeView", // TreeViewFeature (debug)
  "testRecorder", // TestRecorderFeature (debug)
]);

// Text format mark feature keys → the Lexical format-bit name used in docs.
const TEXT_FORMAT_FEATURE_KEYS: Record<string, string> = {
  bold: "bold",
  italic: "italic",
  underline: "underline",
  strikethrough: "strikethrough",
  inlineCode: "code",
  subscript: "subscript",
  superscript: "superscript",
};

// List feature keys → the `listType` value an agent sets on a `list` node.
const LIST_TYPE_BY_FEATURE_KEY: Record<string, "bullet" | "check" | "number"> = {
  orderedList: "number",
  unorderedList: "bullet",
  checklist: "check",
};

/**
 * Node `type` strings already surfaced by the typed projections above, plus the
 * core Lexical nodes that are always implied. Custom-feature node types matching
 * any of these are dropped from `customNodes` (they're already represented, or
 * are structural nodes an agent never authors directly).
 */
const KNOWN_NODE_TYPES = new Set([
  // core lexical structural nodes
  "root",
  "text",
  "linebreak",
  "tab",
  "paragraph",
  // nodes covered by typed projections
  "heading",
  "quote",
  "list",
  "listitem",
  "horizontalrule",
  "table",
  "tablerow",
  "tablecell",
  "upload",
  "relationship",
  "block",
  "inlineBlock",
  "link",
  "autolink",
]);

/** Pull a feature's resolved props off whichever shape carries them. */
function toProps(feature: any): Record<string, unknown> {
  const candidate =
    feature?.sanitizedServerFeatureProps ?? feature?.serverFeatureProps ?? feature?.props ?? {};
  return candidate && typeof candidate === "object" && !Array.isArray(candidate)
    ? (candidate as Record<string, unknown>)
    : {};
}

/**
 * Read the richtext node `type` strings a feature registers, from its resolved
 * `nodes` array. Mirrors how Payload itself derives the type
 * (`node.replace.getType()` for node replacements, else `node.getType()`).
 * Returns `[]` for features that register no nodes (text-format marks, layout,
 * editor chrome) or shapes without resolved nodes (e.g. unit-test fixtures).
 */
function nodeTypesOf(feature: any): string[] {
  const nodes = feature?.nodes;
  if (!Array.isArray(nodes)) return [];
  const types: string[] = [];
  for (const n of nodes) {
    const entry = n?.node;
    if (!entry) continue;
    const target = typeof entry === "object" && "with" in entry ? entry.replace : entry;
    if (target && typeof target.getType === "function") {
      try {
        const type = target.getType();
        if (typeof type === "string") types.push(type);
      } catch {
        // A node whose getType throws without an instance is not authorable
        // metadata we can surface — skip it rather than fail the whole summary.
      }
    }
  }
  return types;
}

/**
 * Normalize a lexical editor's features into `{ key, props }[]`.
 *
 * Payload's sanitized field exposes the editor two ways:
 *   - `editor.editorConfig.resolvedFeatureMap` — a `Map` of deduped features
 *     carrying each feature's final `sanitizedServerFeatureProps`. Preferred.
 *   - `editor.features` — an array of feature providers `{ key,
 *     serverFeatureProps }`, possibly with duplicate keys. Used as a fallback
 *     and by unit-test fixtures.
 *
 * Detection is structural so the extractor has no hard dependency on
 * `@payloadcms/richtext-lexical`. Returns `undefined` on unrecognised shapes
 * (never throws) so the caller can omit the `lexicalFeatures` key entirely.
 */
type NormalizedFeature = { key: string; props: Record<string, unknown>; nodeTypes: string[] };

function normalizeLexicalFeatures(editor: any): NormalizedFeature[] | undefined {
  if (!editor || typeof editor !== "object") return undefined;

  const resolvedMap = editor.editorConfig?.resolvedFeatureMap ?? editor.resolvedFeatureMap;
  if (resolvedMap instanceof Map) {
    const entries: NormalizedFeature[] = [];
    for (const [key, value] of resolvedMap.entries()) {
      if (typeof key !== "string") continue;
      entries.push({ key, props: toProps(value), nodeTypes: nodeTypesOf(value) });
    }
    return entries;
  }

  if (Array.isArray(editor.features)) {
    return editor.features
      .filter((f: any) => f && typeof f === "object" && typeof f.key === "string")
      .map((f: any) => ({ key: f.key, props: toProps(f), nodeTypes: nodeTypesOf(f) }));
  }

  return undefined;
}

/**
 * Everything a feature projection may write to. Each projection buckets one
 * feature key's config into the summary-in-progress.
 */
type ProjectionContext = {
  props: Record<string, unknown>;
  blocksBySlug: Record<string, any>;
  textFormats: string[];
  blockNodes: LexicalFeatureSummary["blockNodes"];
  inlineNodes: NonNullable<LexicalFeatureSummary["inlineNodes"]>;
  layoutProps: Array<"align" | "indent">;
};

type FeatureProjection = (ctx: ProjectionContext) => void;

/**
 * Feature key → projection into the summary. Adding support for a new lexical
 * feature key is one entry here. Keys absent from this table (and from
 * `UI_FEATURE_KEYS`) fall through to the `customNodes` handling.
 */
const FEATURE_PROJECTIONS: Record<string, FeatureProjection> = {
  // Text format marks (bold, italic, …) → `textFormats`.
  ...Object.fromEntries(
    Object.entries(TEXT_FORMAT_FEATURE_KEYS).map(([key, format]): [string, FeatureProjection] => [
      key,
      (ctx) => {
        ctx.textFormats.push(format);
      },
    ]),
  ),
  // List variants → a single `list` node listing the enabled `listType`s.
  ...Object.fromEntries(
    Object.entries(LIST_TYPE_BY_FEATURE_KEY).map(([key, listType]): [string, FeatureProjection] => [
      key,
      (ctx) => {
        if (!ctx.blockNodes.list) ctx.blockNodes.list = { types: [] };
        ctx.blockNodes.list.types.push(listType);
      },
    ]),
  ),
  align: (ctx) => {
    ctx.layoutProps.push("align");
  },
  indent: (ctx) => {
    ctx.layoutProps.push("indent");
  },
  paragraph: (ctx) => {
    ctx.blockNodes.paragraph = true;
  },
  blockquote: (ctx) => {
    ctx.blockNodes.quote = true;
  },
  horizontalRule: (ctx) => {
    ctx.blockNodes.horizontalrule = true;
  },
  experimental_table: (ctx) => {
    ctx.blockNodes.table = true;
  },
  heading: (ctx) => {
    const sizes = ctx.props.enabledHeadingSizes;
    ctx.blockNodes.heading = {
      sizes:
        Array.isArray(sizes) && sizes.every((s) => typeof s === "string")
          ? (sizes as string[])
          : ["h1", "h2", "h3", "h4", "h5", "h6"],
    };
  },
  blocks: (ctx) => {
    const slugs = extractBlockSlugs(ctx.props, ctx.blocksBySlug);
    if (slugs) ctx.blockNodes.block = { slugs };
  },
  inlineBlocks: (ctx) => {
    const slugs = extractBlockSlugs(ctx.props, ctx.blocksBySlug);
    if (slugs) ctx.inlineNodes.inlineBlock = { slugs };
  },
  link: (ctx) => {
    const linkOpts: NonNullable<LexicalFeatureSummary["inlineNodes"]>["link"] = {};
    const enabled = toStringArray(ctx.props.enabledCollections);
    if (enabled) linkOpts.enabledCollections = enabled;
    const disabled = toStringArray(ctx.props.disabledCollections);
    if (disabled) linkOpts.disabledCollections = disabled;
    // Custom link fields are only an array once sanitized; a callback shape is skipped.
    if (Array.isArray(ctx.props.fields)) {
      linkOpts.fields = toFieldSchemas(ctx.props.fields, ctx.blocksBySlug);
    }
    ctx.inlineNodes.link = linkOpts;
  },
  upload: (ctx) => {
    const uploadOpts: NonNullable<LexicalFeatureSummary["blockNodes"]>["upload"] = {};
    // Allow-list lives in enabled/disabledCollections — same as relationship.
    // (The `collections` prop is a per-collection custom-fields map, NOT the
    // allow-list; reading its keys would mislabel "collections with extra
    // fields" as "collections you may upload to".)
    const enabled = toStringArray(ctx.props.enabledCollections);
    if (enabled) uploadOpts.enabledCollections = enabled;
    const disabled = toStringArray(ctx.props.disabledCollections);
    if (disabled) uploadOpts.disabledCollections = disabled;
    // `collections: { [slug]: { fields } }` adds custom fields to the upload
    // node when it targets that collection — surface them keyed by slug.
    const collections = ctx.props.collections;
    if (collections && typeof collections === "object" && !Array.isArray(collections)) {
      const fieldsByCollection: Record<string, FieldSchema[]> = {};
      for (const [slug, cfg] of Object.entries(collections as Record<string, any>)) {
        if (cfg && typeof cfg === "object" && Array.isArray(cfg.fields) && cfg.fields.length > 0) {
          fieldsByCollection[slug] = toFieldSchemas(cfg.fields, ctx.blocksBySlug);
        }
      }
      if (Object.keys(fieldsByCollection).length > 0) uploadOpts.fields = fieldsByCollection;
    }
    ctx.blockNodes.upload = uploadOpts;
  },
  relationship: (ctx) => {
    const relOpts: NonNullable<LexicalFeatureSummary["blockNodes"]>["relationship"] = {};
    const enabled = toStringArray(ctx.props.enabledCollections);
    if (enabled) relOpts.enabledCollections = enabled;
    const disabled = toStringArray(ctx.props.disabledCollections);
    if (disabled) relOpts.disabledCollections = disabled;
    ctx.blockNodes.relationship = relOpts;
  },
};

/**
 * Build a `LexicalFeatureSummary` for a richText field.
 *
 * Walks the editor's features and buckets each enabled node into `textFormats`,
 * `blockNodes`, `inlineNodes`, or `layoutProps` — keyed by the exact richtext
 * `type` string an agent emits. Editor-chrome and unknown feature keys are
 * dropped. Inline `Block` objects declared on BlocksFeature / InlineBlocksFeature
 * are registered into the shared `blocksBySlug` so `blockReferences` to them
 * resolve — mirroring how `toFieldSchemas` folds `blockReferences` into the same
 * map. Returns `undefined` when no recognizable features are present.
 */
export function extractLexicalSummary(
  field: any,
  blocksBySlug: Record<string, any> = {},
): LexicalFeatureSummary | undefined {
  const normalized = normalizeLexicalFeatures(field.editor);
  if (!normalized || normalized.length === 0) return undefined;

  // Dedupe by key, keeping the first-seen feature.
  const keys = new Map<string, NormalizedFeature>();
  for (const feature of normalized) {
    if (!keys.has(feature.key)) keys.set(feature.key, feature);
  }

  const textFormats: string[] = [];
  const blockNodes: LexicalFeatureSummary["blockNodes"] = {};
  const inlineNodes: NonNullable<LexicalFeatureSummary["inlineNodes"]> = {};
  const layoutProps: Array<"align" | "indent"> = [];
  const customNodes = new Set<string>();

  for (const [key, { props, nodeTypes }] of keys) {
    if (UI_FEATURE_KEYS.has(key)) continue;

    // hasOwn guard: a hostile/odd feature key like "toString" must not hit
    // inherited Object.prototype members.
    const project = Object.hasOwn(FEATURE_PROJECTIONS, key) ? FEATURE_PROJECTIONS[key] : undefined;
    if (project) {
      project({ props, blocksBySlug, textFormats, blockNodes, inlineNodes, layoutProps });
      continue;
    }

    // Unrecognized (custom) feature: surface the node `type` strings it
    // registers so agents know they exist, even without a typed projection.
    // Node types already covered by a projection above (or core lexical nodes)
    // are filtered out — they're not "custom".
    for (const type of nodeTypes) {
      if (!KNOWN_NODE_TYPES.has(type)) customNodes.add(type);
    }
  }

  if (blockNodes.list) blockNodes.list.types.sort();

  const summary: LexicalFeatureSummary = {
    textFormats: textFormats.sort(),
    blockNodes,
  };
  if (Object.keys(inlineNodes).length > 0) summary.inlineNodes = inlineNodes;
  if (layoutProps.length > 0) summary.layoutProps = layoutProps.sort() as typeof layoutProps;
  if (customNodes.size > 0) summary.customNodes = [...customNodes].sort();
  return summary;
}

/**
 * Collect block slugs from a BlocksFeature / InlineBlocksFeature's `blocks`
 * prop, registering any inline `Block` objects into the shared `blocksBySlug`
 * map so `blockReferences` to them resolve. Returns `undefined` when no slugs
 * are present.
 */
function extractBlockSlugs(
  props: Record<string, unknown>,
  blocksBySlug: Record<string, any>,
): string[] | undefined {
  const raw = props.blocks;
  if (!Array.isArray(raw)) return undefined;
  const slugs: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      slugs.push(entry);
    } else if (entry && typeof entry === "object" && typeof entry.slug === "string") {
      slugs.push(entry.slug);
      if (!(entry.slug in blocksBySlug)) blocksBySlug[entry.slug] = entry;
    }
  }
  return slugs.length > 0 ? slugs : undefined;
}

/**
 * Return the input when it is a `string[]`, otherwise `undefined`. Preserves
 * empty arrays — an empty `enabledCollections` is meaningful ("disables every
 * collection") and should surface as-is.
 */
function toStringArray(value: unknown): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  if (value.every((v) => typeof v === "string")) return value;
  return undefined;
}
