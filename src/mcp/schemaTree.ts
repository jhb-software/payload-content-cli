/**
 * Field schemas as an indented tree, one line per field: markers in place of
 * repeated JSON keys, which costs an agent roughly half the tokens. The legend
 * is meant to be shown once (in a tool description), not with every tree.
 */

import type { FieldSchema, LexicalFeatureSummary } from "../plugin/index.js";

export const SCHEMA_TREE_LEGEND = [
  "One line per field, nested fields indented:",
  "  name*: type     required (no * = optional)",
  "  name[]: type    a list (array, blocks, hasMany)",
  "  (a | b)         allowed values; on blocks, the blockType slugs",
  "  → a | b         target collections of a relationship or upload",
  "  (localized)     differs per locale",
  "  (virtual)       read-only, never write it",
  "  [when …]        applies only while the rule on sibling fields holds",
  "  filter: {…}     only related documents matching this query",
  "  = value         default",
  "  ✎ …             rich text: the nodes the editor accepts",
].join("\n");

export type SchemaKind = "collection" | "global" | "block";

/** Expects blocks as slugs (`blocks: "reference"`), as the schema tools request them. */
export function renderSchemaTree(slug: string, kind: SchemaKind, fields: FieldSchema[]): string {
  const lines = [`${slug} (${kind})`];
  renderFields(fields, 1, lines);
  return lines.join("\n");
}

function renderFields(fields: FieldSchema[], level: number, lines: string[]): void {
  const indent = "  ".repeat(level);
  for (const field of fields) {
    // Bookkeeping Payload manages itself: timestamps, _status, row ids, blockName.
    if (field.system) continue;
    lines.push(indent + fieldLine(field));
    if (field.lexicalFeatures) {
      for (const line of lexicalLines(field.lexicalFeatures)) lines.push(`${indent}  ✎ ${line}`);
    }
    if (field.fields) renderFields(field.fields, level + 1, lines);
  }
}

function fieldLine(field: FieldSchema): string {
  const list = field.hasMany || field.type === "array" || field.type === "blocks";
  let line = `${field.name}${field.required ? "*" : ""}${list ? "[]" : ""}: ${field.type}`;
  const values = field.blockSlugs ?? field.options?.map((option) => option.value);
  if (values?.length) line += ` (${values.join(" | ")})`;
  if (field.relationTo) line += ` → ${[field.relationTo].flat().join(" | ")}`;
  if (field.filterOptions !== undefined) line += ` filter: ${JSON.stringify(field.filterOptions)}`;
  if (field.localized) line += " (localized)";
  if (field.virtual) line += " (virtual)";
  if (field.hasCondition) {
    line += field.conditions
      ? ` [when ${field.conditions.map((rule) => JSON.stringify(rule)).join(", ")}]`
      : " [when a sibling condition holds]";
  }
  if (field.defaultValue !== undefined) line += ` = ${JSON.stringify(field.defaultValue)}`;
  return line;
}

function targets(options: { enabledCollections?: string[]; disabledCollections?: string[] }) {
  if (options.enabledCollections) return ` → ${options.enabledCollections.join(", ")}`;
  if (options.disabledCollections) return ` → all but ${options.disabledCollections.join(", ")}`;
  return "";
}

function lexicalLines(features: LexicalFeatureSummary): string[] {
  const lines: string[] = [];
  if (features.textFormats.length) lines.push(`text formats: ${features.textFormats.join(", ")}`);

  const nodes = features.blockNodes;
  const blocks: string[] = [];
  if (nodes.paragraph) blocks.push("paragraph");
  if (nodes.heading) blocks.push(`heading (${nodes.heading.sizes.join(", ")})`);
  if (nodes.quote) blocks.push("quote");
  if (nodes.list) blocks.push(`list (${nodes.list.types.join(", ")})`);
  if (nodes.table) blocks.push("table");
  if (nodes.horizontalrule) blocks.push("horizontalrule");
  if (nodes.upload) blocks.push(`upload${targets(nodes.upload)}`);
  if (nodes.relationship) blocks.push(`relationship${targets(nodes.relationship)}`);
  if (nodes.block) blocks.push(`block (${nodes.block.slugs.join(", ")})`);
  if (blocks.length) lines.push(`block nodes: ${blocks.join(", ")}`);

  const inline: string[] = [];
  if (features.inlineNodes?.link) inline.push(`link${targets(features.inlineNodes.link)}`);
  if (features.inlineNodes?.inlineBlock) {
    inline.push(`inlineBlock (${features.inlineNodes.inlineBlock.slugs.join(", ")})`);
  }
  if (inline.length) lines.push(`inline nodes: ${inline.join(", ")}`);

  if (features.layoutProps?.length) lines.push(`layout: ${features.layoutProps.join(", ")}`);
  if (features.customNodes?.length) lines.push(`custom nodes: ${features.customNodes.join(", ")}`);
  return lines;
}
