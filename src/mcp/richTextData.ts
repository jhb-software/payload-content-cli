/**
 * Rich text in `create` and `update` data, as an agent writes it: a list of
 * nodes or `{root: {children}}`, with shorthand nodes. Payload stores a draft
 * without validating it, so anything that isn't Lexical would be saved as is.
 */

import type { Block, Field } from "payload";
import { fieldAffectsData, tabHasName } from "payload/shared";
import { toRichText } from "../lexical/view.js";
import { rowFields } from "./rows.js";

type Data = Record<string, unknown>;

type Walk = {
  configBlocks: Block[];
  /** Top-level fields holding rich text. */
  found: Set<string>;
  /** Turn rich text into Lexical, or only find it. */
  convert: boolean;
  /** Values to leave as they are. */
  kept: Set<unknown>;
};

const isObject = (value: unknown): value is Data =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function walk(fields: Field[], data: Data, path: string, top: string | undefined, ctx: Walk) {
  for (const field of fields) {
    if (field.type === "tabs") {
      for (const tab of field.tabs) {
        if (!tabHasName(tab)) walk(tab.fields, data, path, top, ctx);
        else if (isObject(data[tab.name])) {
          walk(tab.fields, data[tab.name] as Data, `${path}${tab.name}.`, top ?? tab.name, ctx);
        }
      }
      continue;
    }
    if (!fieldAffectsData(field)) {
      if ("fields" in field) walk(field.fields, data, path, top, ctx);
      continue;
    }
    if (!(field.name in data)) continue;
    const value = data[field.name];
    const here = `${path}${field.name}`;
    const key = top ?? field.name;

    if (field.type === "richText") {
      if (ctx.convert && !ctx.kept.has(value)) data[field.name] = toRichText(value, here);
      ctx.found.add(key);
    } else if (field.type === "group" && isObject(value)) {
      walk(field.fields, value, `${here}.`, key, ctx);
    } else if ((field.type === "array" || field.type === "blocks") && Array.isArray(value)) {
      value.forEach((row, index) => {
        if (!isObject(row)) return;
        walk(rowFields(field, ctx.configBlocks, row.blockType), row, `${here}.${index}.`, key, ctx);
      });
    }
  }
}

/**
 * Turn every rich-text value `data` sets into Lexical, in place, refusing one
 * that isn't. Values in `kept` (stored rich text an unchanged outline was
 * restored to) stay as they are. Answers the top-level fields that hold rich text.
 */
export function hydrateRichText(
  fields: Field[],
  data: Data,
  configBlocks: Block[] = [],
  kept: Set<unknown> = new Set(),
): string[] {
  const found = new Set<string>();
  walk(fields, data, "", undefined, { configBlocks, found, convert: true, kept });
  return [...found];
}

/** The top-level fields of `data` that hold rich text, leaving it as it is. */
export function richTextFieldsIn(
  fields: Field[],
  data: Data,
  configBlocks: Block[] = [],
): string[] {
  const found = new Set<string>();
  walk(fields, data, "", undefined, { configBlocks, found, convert: false, kept: new Set() });
  return [...found];
}

/** Every object in a value, so stored rich text restored into data can be told apart. */
export function objectsIn(value: unknown, found = new Set<unknown>()): Set<unknown> {
  if (typeof value !== "object" || value === null) return found;
  found.add(value);
  for (const item of Object.values(value)) objectsIn(item, found);
  return found;
}
