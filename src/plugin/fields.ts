/**
 * Field projection for the content-cli plugin.
 *
 * Turns a Payload collection/global/block field config into `FieldSchema[]` —
 * a flattened, agent-friendly description of each field. Layout-only wrappers
 * (rows, collapsibles, unnamed tabs/groups) are hoisted, UI fields are dropped,
 * and `blockReferences` are resolved against the shared block map. Each
 * `richText` field carries a `lexicalFeatures` summary (see `./lexical.ts`).
 *
 * `blocks` fields project either way: inlined (the default, what the CLI's
 * schema endpoint serves) or as bare slugs the caller resolves on demand via
 * `getBlockSchema` — see `ProjectionOptions`.
 *
 * Types are kept inline to avoid a hard dependency on `payload`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { extractLexicalSummary } from "./lexical.js";
import type { LexicalFeatureSummary } from "./lexical.js";

export interface FieldSchema {
  name: string;
  type: string;
  required?: boolean;
  localized?: boolean;
  virtual?: boolean;
  hasMany?: boolean;
  relationTo?: string | string[];
  fields?: FieldSchema[];
  /** Inline block definitions (`blocks: "inline"`, the default). */
  blocks?: { slug: string; fields: FieldSchema[] }[];
  /**
   * The slugs a `blocks` field accepts, in place of their definitions
   * (`blocks: "reference"`). Resolve them with `getBlockSchema`.
   */
  blockSlugs?: string[];
  options?: { label: string; value: string }[];
  defaultValue?: unknown;
  /**
   * Field Payload injects into the config rather than the author declaring it:
   * `createdAt`, `updatedAt`, `_status`, `blockName`, and generated array/block
   * row `id`s. Not a write ban — `_status` is the publish control and
   * `createdAt` is accepted on create — but these are bookkeeping rather than
   * content, so consumers typically hide them by default.
   */
  system?: boolean;
  /** Field is gated by an `admin.condition`; it only applies for some sibling values. */
  hasCondition?: boolean;
  /** Static `filterOptions` query constraining which related docs can be assigned. */
  filterOptions?: unknown;
  lexicalFeatures?: LexicalFeatureSummary;
}

/**
 * Names Payload injects itself: timestamps (collection sanitize), `_status`
 * (versions/drafts) and `blockName` (baseBlockFields). Flagged rather than
 * dropped so the projection stays lossless — consumers decide whether to hide
 * them. Matched wherever they appear; these names are Payload-reserved, so
 * collision with an author-defined field is negligible.
 */
const SYSTEM_FIELD_NAMES = new Set(["createdAt", "updatedAt", "_status", "blockName"]);

/**
 * `id` is the ambiguous case. Array and block rows carry Payload's
 * `baseIDField` — hidden and self-populating, so it's system. A collection with
 * a custom ID field declares its own `id`, which an agent *must* supply on
 * create; flagging that one would hide the only field a create can't omit.
 * `admin.hidden` is the marker Payload sets on the generated one.
 */
function isSystemField(field: any): boolean {
  if (field.name === "id") return field.admin?.hidden === true;
  return SYSTEM_FIELD_NAMES.has(field.name);
}

export interface ProjectionOptions {
  /**
   * How `blocks` fields are projected.
   *
   * `"inline"` (default) embeds each block's own `FieldSchema[]`, giving one
   * self-contained document — what the `/content-cli/schema` endpoint serves,
   * because the CLI resolves blocks offline.
   *
   * `"reference"` emits `blockSlugs` instead and registers each block
   * definition into the shared `blocksBySlug` map, so a caller can resolve the
   * slugs it actually needs via `getBlockSchema`. Keeps an entity schema small
   * enough to hand to an agent — progressive disclosure.
   */
  blocks?: "inline" | "reference";
}

// Alternative: import { flattenTopLevelFields } from 'payload/utilities/flattenTopLevelFields'
// with moveSubFieldsToTop: true — but that adds a hard dependency on `payload`.
export function toFieldSchemas(
  fields: any[],
  blocksBySlug: Record<string, any> = {},
  options: ProjectionOptions = {},
): FieldSchema[] {
  const result: FieldSchema[] = [];

  for (const field of fields) {
    // UI fields are admin-only React widgets — no data, irrelevant to agents.
    if (field.type === "ui") continue;

    // Tabs field: hoist unnamed tab fields, keep named tabs as nested
    if (field.type === "tabs" && Array.isArray(field.tabs)) {
      for (const tab of field.tabs) {
        if (tab.name) {
          // Named tab — behaves like a group
          result.push({
            name: tab.name,
            type: "tab",
            fields: toFieldSchemas(tab.fields || [], blocksBySlug, options),
          });
        } else {
          // Unnamed tab — hoist fields to parent level
          result.push(...toFieldSchemas(tab.fields || [], blocksBySlug, options));
        }
      }
      continue;
    }

    // Row / collapsible / unnamed group: pure UI wrappers — hoist their fields.
    // Payload stores unnamed-group fields at the parent level, just like row/collapsible.
    if (
      (field.type === "row" || field.type === "collapsible" || field.type === "group") &&
      !field.name &&
      Array.isArray(field.fields)
    ) {
      result.push(...toFieldSchemas(field.fields, blocksBySlug, options));
      continue;
    }

    if (!field.name) continue;

    const schema: FieldSchema = {
      name: field.name,
      type: field.type,
    };

    if (field.required) schema.required = true;
    if (field.localized) schema.localized = true;
    // Join fields are computed from the other side of a relationship —
    // read-only, so mark them virtual so pulls strip them (pushing pulled
    // join data back would be invalid).
    if (field.virtual || field.type === "join") schema.virtual = true;
    if (field.hasMany) schema.hasMany = true;
    if (field.relationTo) schema.relationTo = field.relationTo;
    if (isSystemField(field)) schema.system = true;
    // admin.condition is a function (can't be serialized) — flag that the field
    // is gated so agents know it only applies for certain sibling values.
    if (typeof field.admin?.condition === "function") schema.hasCondition = true;
    // filterOptions constrains which related docs may be assigned (e.g. a favicon
    // that accepts only `image/svg+xml` media). Skip function forms — like function
    // defaults below, they need runtime context (siblingData, user) we can't supply.
    if (
      field.filterOptions &&
      typeof field.filterOptions === "object" &&
      !Array.isArray(field.filterOptions)
    ) {
      schema.filterOptions = field.filterOptions;
    }
    // Skip function defaults — they need runtime context (req, user, locale) we can't supply.
    if (field.defaultValue !== undefined && typeof field.defaultValue !== "function") {
      schema.defaultValue = field.defaultValue;
    }

    if (field.fields && Array.isArray(field.fields)) {
      schema.fields = toFieldSchemas(field.fields, blocksBySlug, options);
    }

    // Resolve inline blocks + blockReferences (slugs pointing to config.blocks)
    const inlineBlocks: any[] = field.blocks && Array.isArray(field.blocks) ? field.blocks : [];
    const refBlocks: any[] = Array.isArray(field.blockReferences)
      ? field.blockReferences
          .map((blockRef: any) => {
            const slug = typeof blockRef === "string" ? blockRef : blockRef.slug;
            return blocksBySlug[slug];
          })
          .filter(Boolean)
      : [];
    const allBlocks = [...inlineBlocks, ...refBlocks];

    if (allBlocks.length > 0) {
      if (options.blocks === "reference") {
        // Register before referencing: a block declared inline on this field
        // exists nowhere else, so the slug would be unresolvable otherwise.
        // First definition wins, matching how `blockReferences` resolve.
        for (const block of allBlocks) {
          if (!(block.slug in blocksBySlug)) blocksBySlug[block.slug] = block;
        }
        schema.blockSlugs = allBlocks.map((block: any) => block.slug);
      } else {
        schema.blocks = allBlocks.map((block: any) => ({
          slug: block.slug,
          fields: toFieldSchemas(block.fields || [], blocksBySlug, options),
        }));
      }
    }

    if (field.options && Array.isArray(field.options)) {
      schema.options = field.options.map((option: any) =>
        typeof option === "string"
          ? { label: option, value: option }
          : { label: option.label, value: option.value },
      );
    }

    if (field.type === "richText") {
      const lexicalFeatures = extractLexicalSummary(field, blocksBySlug, options);
      if (lexicalFeatures) schema.lexicalFeatures = lexicalFeatures;
    }

    result.push(schema);
  }

  return result;
}
