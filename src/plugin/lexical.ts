/**
 * Lexical richtext feature extraction for the content-cli plugin.
 *
 * Projects a `richText` field's lexical editor config into a
 * `LexicalFeatureSummary` describing the nodes an agent may emit. Detection is
 * structural — it probes the resolved editor config without naming any
 * `@payloadcms/richtext-lexical` type — so the plugin never depends on the
 * lexical package, only on `payload`'s own `Field`/`Block` types.
 */

import type { Block } from "payload";

import { toFieldSchemas } from "./fields.js";
import type { FieldSchema } from "./fields.js";

/** Narrow an unknown to a plain (non-array) object so its keys can be read. */
function isRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

/** Read one property off an unknown value, returning `undefined` for non-objects. */
function getProp(value: unknown, key: string): unknown {
  return isRecord(value) ? value[key] : undefined;
}

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
    /** Relationship nodes. `type: "relationship"`, set `fields.relationTo` and `fields.value`. */
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
function toProps(feature: unknown): Record<string, unknown> {
  const candidate =
    getProp(feature, "sanitizedServerFeatureProps") ??
    getProp(feature, "serverFeatureProps") ??
    getProp(feature, "props");
  return isRecord(candidate) ? candidate : {};
}

/**
 * Read the richtext node `type` strings a feature registers, from its resolved
 * `nodes` array. Mirrors how Payload itself derives the type
 * (`node.replace.getType()` for node replacements, else `node.getType()`).
 * Returns `[]` for features that register no nodes (text-format marks, layout,
 * editor chrome) or shapes without resolved nodes (e.g. unit-test fixtures).
 */
function nodeTypesOf(feature: unknown): string[] {
  const nodes = getProp(feature, "nodes");
  if (!Array.isArray(nodes)) return [];
  const types: string[] = [];
  for (const node of nodes) {
    const entry = getProp(node, "node");
    if (!entry) continue;
    const target = isRecord(entry) && "with" in entry ? getProp(entry, "replace") : entry;
    const getType = getProp(target, "getType");
    if (typeof getType === "function") {
      try {
        const type = (getType as () => unknown).call(target);
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

function normalizeLexicalFeatures(editor: unknown): NormalizedFeature[] | undefined {
  if (!isRecord(editor)) return undefined;

  const resolvedMap =
    getProp(getProp(editor, "editorConfig"), "resolvedFeatureMap") ??
    getProp(editor, "resolvedFeatureMap");
  if (resolvedMap instanceof Map) {
    const entries: NormalizedFeature[] = [];
    for (const [key, value] of resolvedMap.entries()) {
      if (typeof key !== "string") continue;
      entries.push({ key, props: toProps(value), nodeTypes: nodeTypesOf(value) });
    }
    return entries;
  }

  const features = editor.features;
  if (Array.isArray(features)) {
    const result: NormalizedFeature[] = [];
    for (const feature of features) {
      const key = getProp(feature, "key");
      if (typeof key !== "string") continue;
      result.push({ key, props: toProps(feature), nodeTypes: nodeTypesOf(feature) });
    }
    return result;
  }

  return undefined;
}

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
  field: { editor?: unknown },
  blocksBySlug: Record<string, Block>,
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

    if (key in TEXT_FORMAT_FEATURE_KEYS) {
      textFormats.push(TEXT_FORMAT_FEATURE_KEYS[key]);
      continue;
    }

    if (key === "align") {
      layoutProps.push("align");
      continue;
    }
    if (key === "indent") {
      layoutProps.push("indent");
      continue;
    }

    if (key === "paragraph") {
      blockNodes.paragraph = true;
      continue;
    }
    if (key === "blockquote") {
      blockNodes.quote = true;
      continue;
    }
    if (key === "horizontalRule") {
      blockNodes.horizontalrule = true;
      continue;
    }
    if (key === "experimental_table") {
      blockNodes.table = true;
      continue;
    }

    if (key === "heading") {
      const sizes = props.enabledHeadingSizes;
      blockNodes.heading = {
        sizes:
          Array.isArray(sizes) && sizes.every((size) => typeof size === "string")
            ? (sizes as string[])
            : ["h1", "h2", "h3", "h4", "h5", "h6"],
      };
      continue;
    }

    if (key in LIST_TYPE_BY_FEATURE_KEY) {
      if (!blockNodes.list) blockNodes.list = { types: [] };
      blockNodes.list.types.push(LIST_TYPE_BY_FEATURE_KEY[key]);
      continue;
    }

    if (key === "blocks") {
      const slugs = extractBlockSlugs(props, blocksBySlug);
      if (slugs) blockNodes.block = { slugs };
      continue;
    }

    if (key === "link") {
      const linkOpts: NonNullable<LexicalFeatureSummary["inlineNodes"]>["link"] = {};
      const enabled = toStringArray(props.enabledCollections);
      if (enabled) linkOpts.enabledCollections = enabled;
      const disabled = toStringArray(props.disabledCollections);
      if (disabled) linkOpts.disabledCollections = disabled;
      // Custom link fields are only an array once sanitized; a callback shape is skipped.
      if (Array.isArray(props.fields)) linkOpts.fields = toFieldSchemas(props.fields, blocksBySlug);
      inlineNodes.link = linkOpts;
      continue;
    }

    if (key === "upload") {
      const uploadOpts: NonNullable<LexicalFeatureSummary["blockNodes"]>["upload"] = {};
      // Allow-list lives in enabled/disabledCollections — same as relationship.
      // (The `collections` prop is a per-collection custom-fields map, NOT the
      // allow-list; reading its keys would mislabel "collections with extra
      // fields" as "collections you may upload to".)
      const enabled = toStringArray(props.enabledCollections);
      if (enabled) uploadOpts.enabledCollections = enabled;
      const disabled = toStringArray(props.disabledCollections);
      if (disabled) uploadOpts.disabledCollections = disabled;
      // `collections: { [slug]: { fields } }` adds custom fields to the upload
      // node when it targets that collection — surface them keyed by slug.
      const collections = props.collections;
      if (isRecord(collections)) {
        const fieldsByCollection: Record<string, FieldSchema[]> = {};
        for (const [slug, cfg] of Object.entries(collections)) {
          const cfgFields = getProp(cfg, "fields");
          if (Array.isArray(cfgFields) && cfgFields.length > 0) {
            fieldsByCollection[slug] = toFieldSchemas(cfgFields, blocksBySlug);
          }
        }
        if (Object.keys(fieldsByCollection).length > 0) uploadOpts.fields = fieldsByCollection;
      }
      blockNodes.upload = uploadOpts;
      continue;
    }

    if (key === "relationship") {
      const relOpts: NonNullable<LexicalFeatureSummary["blockNodes"]>["relationship"] = {};
      const enabled = toStringArray(props.enabledCollections);
      if (enabled) relOpts.enabledCollections = enabled;
      const disabled = toStringArray(props.disabledCollections);
      if (disabled) relOpts.disabledCollections = disabled;
      blockNodes.relationship = relOpts;
      continue;
    }

    if (key === "inlineBlocks") {
      const slugs = extractBlockSlugs(props, blocksBySlug);
      if (slugs) inlineNodes.inlineBlock = { slugs };
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
  blocksBySlug: Record<string, Block>,
): string[] | undefined {
  const raw = props.blocks;
  if (!Array.isArray(raw)) return undefined;
  const slugs: string[] = [];
  for (const entry of raw) {
    if (typeof entry === "string") {
      slugs.push(entry);
    } else if (isRecord(entry) && typeof entry.slug === "string") {
      slugs.push(entry.slug);
      // Inline `Block` objects declared on the feature are registered so later
      // `blockReferences` to them resolve; they're structurally Block configs.
      if (!(entry.slug in blocksBySlug)) blocksBySlug[entry.slug] = entry as unknown as Block;
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
  if (value.every((item) => typeof item === "string")) return value;
  return undefined;
}
