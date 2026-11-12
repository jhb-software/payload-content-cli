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
  "  read-only: a, b fields reads return but nothing writes, named on the last line",
  "  [when a = x, b ≠ y] applies only while every rule holds; also in (x | y), is set, is not set, has x, has any of (x | y) (a list holds one)",
  "                  rules read sibling fields (a.b inside sibling group a, ^a the enclosing block's a, /a the document's a); a quoted value is text",
  "  [required when …] required only while the rule holds, written like [when …]",
  "  filter: {…}     only related documents matching this query",
  "  = value         default",
  "  ✎ …             rich text: the nodes the editor accepts",
].join("\n");

export type SchemaKind = "collection" | "global" | "block";

/** Payload's own bookkeeping, which an agent neither reads nor writes. */
const BOOKKEEPING = new Set(["id", "createdAt", "updatedAt", "_status", "blockName"]);

/** The fields every link has; the tree lists only those an app adds. */
const BUILT_IN_LINK_FIELDS = new Set(["text", "linkType", "url", "doc", "newTab"]);

/** A blocks field shows its slugs, whichever way the fields were projected. */
export function renderSchemaTree(slug: string, kind: SchemaKind, fields: FieldSchema[]): string {
  const lines = [`${slug} (${kind})`];
  const maintained: string[] = [];
  renderFields(fields, 1, "", lines, maintained, kind !== "block");
  // Fields the app maintains itself: never written, but find returns them.
  if (maintained.length) lines.push(`  read-only: ${maintained.join(", ")}`);
  return lines.join("\n");
}

function renderFields(
  fields: FieldSchema[],
  level: number,
  path: string,
  lines: string[],
  maintained: string[],
  /** Mark `sharedRows`: false in a block, which may sit inside a localized field. */
  markShared: boolean,
): void {
  const indent = "  ".repeat(level);
  for (const field of fields) {
    if (field.system) {
      if (!BOOKKEEPING.has(field.name)) maintained.push(path + field.name);
      continue;
    }
    lines.push(
      indent +
        fieldLine(field) +
        (markShared && field.sharedRows ? " (rows shared by all locales)" : ""),
    );
    if (field.lexicalFeatures) {
      const linkFields: string[] = [];
      const custom = field.lexicalFeatures.inlineNodes?.link?.fields?.filter(
        (linkField) => !BUILT_IN_LINK_FIELDS.has(linkField.name),
      );
      if (custom) renderFields(custom, level + 3, "", linkFields, maintained, false);
      for (const line of lexicalLines(field.lexicalFeatures)) {
        lines.push(`${indent}  ✎ ${line}`);
        if (line.startsWith("inline nodes:")) lines.push(...linkFields);
      }
    }
    if (field.fields)
      renderFields(field.fields, level + 1, `${path}${field.name}.`, lines, maintained, markShared);
  }
}

function fieldLine(field: FieldSchema): string {
  const list = field.hasMany || field.type === "array" || field.type === "blocks";
  let line = `${field.name}${field.required ? "*" : ""}${list ? "[]" : ""}: ${field.type}`;
  const values =
    field.blockSlugs ??
    field.blocks?.map((block) => block.slug) ??
    field.options?.map((option) => option.value);
  if (values?.length) line += ` (${values.join(" | ")})`;
  if (field.relationTo) line += ` → ${[field.relationTo].flat().join(" | ")}`;
  if (field.filterOptions !== undefined) line += ` filter: ${JSON.stringify(field.filterOptions)}`;
  if (field.localized) line += " (localized)";
  if (field.virtual) line += " (virtual)";
  if (field.hasCondition) {
    line += field.conditions
      ? ` [when ${field.conditions.flatMap(describeRule).join(", ")}]`
      : " [when a sibling condition holds]";
  }
  if (field.requiredWhen !== undefined) {
    line += ` [required when ${describeRule(field.requiredWhen).join(", ")}]`;
  }
  if (field.defaultValue !== undefined) line += ` = ${JSON.stringify(field.defaultValue)}`;
  return line;
}

/**
 * A published rule (`admin.custom.condition` or `requiredWhen`) as the clauses that must all hold:
 * a sentence as written, the documented vocabulary spelled out, any other shape
 * as JSON, so an app's own rule is never lost.
 */
function describeRule(rule: unknown): string[] {
  if (typeof rule === "string" && rule) return [rule];
  if (typeof rule === "object" && rule !== null) {
    const record = rule as Record<string, unknown>;
    const { all, any, hidden } = record;
    const keys = Object.keys(record).length;
    if (keys === 1 && hidden === true) return ["never"];
    if (keys === 1 && Array.isArray(all) && all.length) return all.flatMap(describeRule);
    if (keys === 1 && Array.isArray(any) && any.length) {
      const alternatives = any.map((alternative) => {
        const clauses = describeRule(alternative);
        return clauses.length > 1 ? `(${clauses.join(", ")})` : clauses.join("");
      });
      return [`(${alternatives.join(" or ")})`];
    }
    const clause = describeLeaf(record);
    if (clause) return [clause];
  }
  return [JSON.stringify(rule)];
}

function describeLeaf({ field, scope, ...test }: Record<string, unknown>): string | undefined {
  const prefix = scope === undefined ? "" : scopePrefixes.get(scope);
  if (typeof field !== "string" || prefix === undefined) return undefined;
  const [operator, ...others] = Object.entries(test);
  if (!operator || others.length) return undefined;
  const name = `${prefix}${field}`;
  const [key, value] = operator;
  if (key === "isSet" && typeof value === "boolean") {
    return `${name} ${value ? "is set" : "is not set"}`;
  }
  if (key === "notEquals" && isRuleValue(value)) return `${name} ≠ ${ruleValue(value)}`;
  if (key !== "equals" && key !== "includes") return undefined;
  const values = [value].flat();
  if (!values.length || !values.every(isRuleValue)) return undefined;
  const shown = values.map(ruleValue);
  if (key === "includes") {
    return shown.length === 1
      ? `${name} has ${shown[0]}`
      : `${name} has any of (${shown.join(" | ")})`;
  }
  return shown.length === 1 ? `${name} = ${shown[0]}` : `${name} in (${shown.join(" | ")})`;
}

/** Where a rule's `field` is read from: siblings (no scope), the enclosing block, the document root. */
const scopePrefixes = new Map<unknown, string>([
  ["block", "^"],
  ["document", "/"],
]);

type RuleValue = string | number | boolean;

function isRuleValue(value: unknown): value is RuleValue {
  return ["string", "number", "boolean"].includes(typeof value);
}

/** A plain word as it is; other text quoted, so it can't read as a number or more clauses. */
function ruleValue(value: RuleValue): string {
  const plain = typeof value === "string" && /^[A-Za-z_][\w./-]*$/.test(value);
  return plain && value !== "true" && value !== "false" ? value : JSON.stringify(value);
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
