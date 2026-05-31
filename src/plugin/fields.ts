/**
 * Field projection for the content-cli plugin.
 *
 * Turns a Payload collection/global/block field config into `FieldSchema[]` —
 * a flattened, agent-friendly description of each field. Layout-only wrappers
 * (rows, collapsibles, unnamed tabs/groups) are hoisted, UI fields are dropped,
 * and `blockReferences` are resolved against the shared block map. Each
 * `richText` field carries a `lexicalFeatures` summary (see `./lexical.ts`).
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
  blocks?: { slug: string; fields: FieldSchema[] }[];
  options?: { label: string; value: string }[];
  defaultValue?: unknown;
  lexicalFeatures?: LexicalFeatureSummary;
}

// Alternative: import { flattenTopLevelFields } from 'payload/utilities/flattenTopLevelFields'
// with moveSubFieldsToTop: true — but that adds a hard dependency on `payload`.
export function toFieldSchemas(
  fields: any[],
  blocksBySlug: Record<string, any> = {},
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
            fields: toFieldSchemas(tab.fields || [], blocksBySlug),
          });
        } else {
          // Unnamed tab — hoist fields to parent level
          result.push(...toFieldSchemas(tab.fields || [], blocksBySlug));
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
      result.push(...toFieldSchemas(field.fields, blocksBySlug));
      continue;
    }

    if (!field.name) continue;

    const schema: FieldSchema = {
      name: field.name,
      type: field.type,
    };

    if (field.required) schema.required = true;
    if (field.localized) schema.localized = true;
    if (field.virtual) schema.virtual = true;
    if (field.hasMany) schema.hasMany = true;
    if (field.relationTo) schema.relationTo = field.relationTo;
    // Skip function defaults — they need runtime context (req, user, locale) we can't supply.
    if (field.defaultValue !== undefined && typeof field.defaultValue !== "function") {
      schema.defaultValue = field.defaultValue;
    }

    if (field.fields && Array.isArray(field.fields)) {
      schema.fields = toFieldSchemas(field.fields, blocksBySlug);
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
      schema.blocks = allBlocks.map((block: any) => ({
        slug: block.slug,
        fields: toFieldSchemas(block.fields || [], blocksBySlug),
      }));
    }

    if (field.options && Array.isArray(field.options)) {
      schema.options = field.options.map((option: any) =>
        typeof option === "string"
          ? { label: option, value: option }
          : { label: option.label, value: option.value },
      );
    }

    if (field.type === "richText") {
      const lexicalFeatures = extractLexicalSummary(field, blocksBySlug);
      if (lexicalFeatures) schema.lexicalFeatures = lexicalFeatures;
    }

    result.push(schema);
  }

  return result;
}
