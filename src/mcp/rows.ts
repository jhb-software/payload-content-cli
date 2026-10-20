/**
 * Payload takes an array or blocks field in `data` as its complete new list of
 * rows: a stored row left out is deleted. An agent told that only the fields it
 * sends change will send just the row it edits, so these find what a write
 * would delete before it runs.
 */

import type { Block, Field } from "payload";
import { fieldAffectsData, tabHasName } from "payload/shared";

export type LeftOutRows = {
  /** Dotted path to the field, e.g. `facts` or `sections.0.items`. */
  path: string;
  /** Stored row ids the write would delete. */
  ids: (string | number)[];
};

type Data = Record<string, unknown>;

const isObject = (value: unknown): value is Data =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const rowId = (row: unknown): string | number | undefined =>
  isObject(row) && (typeof row.id === "string" || typeof row.id === "number") ? row.id : undefined;

function rowFields(
  field: Extract<Field, { type: "array" | "blocks" }>,
  configBlocks: Block[],
  blockType: unknown,
): Field[] {
  if (field.type === "array") return field.fields;
  const slug = (block: Block | string) => (typeof block === "string" ? block : block.slug);
  const ref = [...(field.blockReferences ?? []), ...field.blocks].find(
    (block) => slug(block) === blockType,
  );
  const block = typeof ref === "string" ? configBlocks.find((b) => b.slug === ref) : ref;
  return block?.fields ?? [];
}

/** `stored` undefined: a bulk update, where every rows field counts. */
function walk(
  fields: Field[],
  data: Data,
  stored: Data | undefined,
  path: string,
  configBlocks: Block[],
  out: LeftOutRows[],
): void {
  for (const field of fields) {
    if (field.type === "tabs") {
      for (const tab of field.tabs) {
        if (!tabHasName(tab)) {
          walk(tab.fields, data, stored, path, configBlocks, out);
        } else if (isObject(data[tab.name])) {
          const inner = stored?.[tab.name];
          walk(
            tab.fields,
            data[tab.name] as Data,
            stored && (isObject(inner) ? inner : {}),
            `${path}${tab.name}.`,
            configBlocks,
            out,
          );
        }
      }
      continue;
    }
    if (!fieldAffectsData(field)) {
      if ("fields" in field) walk(field.fields, data, stored, path, configBlocks, out);
      continue;
    }
    if (!(field.name in data)) continue;
    const value = data[field.name];
    const storedValue = stored?.[field.name];

    if (field.type === "group" && isObject(value)) {
      walk(
        field.fields,
        value,
        stored && (isObject(storedValue) ? storedValue : {}),
        `${path}${field.name}.`,
        configBlocks,
        out,
      );
      continue;
    }
    if ((field.type !== "array" && field.type !== "blocks") || !Array.isArray(value)) continue;

    if (stored === undefined) {
      out.push({ path: path + field.name, ids: [] });
      continue;
    }
    const storedRows = Array.isArray(storedValue) ? storedValue : [];
    const sent = new Set(value.map(rowId));
    const ids = storedRows.map(rowId).filter((id) => id !== undefined && !sent.has(id));
    if (ids.length) out.push({ path: path + field.name, ids: ids as (string | number)[] });

    value.forEach((row, index) => {
      const id = rowId(row);
      const match = storedRows.find((storedRow) => id !== undefined && rowId(storedRow) === id);
      if (!isObject(row) || !isObject(match)) return;
      walk(
        rowFields(field, configBlocks, row.blockType),
        row,
        match,
        `${path}${field.name}.${index}.`,
        configBlocks,
        out,
      );
    });
  }
}

/** The array and blocks fields in `data` that leave out rows `stored` holds. */
export function findLeftOutRows(
  fields: Field[],
  data: Data,
  stored: Data | undefined,
  configBlocks: Block[] = [],
): LeftOutRows[] {
  if (!stored) return [];
  const out: LeftOutRows[] = [];
  walk(fields, data, stored, "", configBlocks, out);
  return out;
}

/**
 * The array and blocks fields in `data`, which a bulk update writes to every
 * matched document; rows can't carry ids that hold across documents.
 */
export function findRowFields(fields: Field[], data: Data, configBlocks: Block[] = []): string[] {
  const out: LeftOutRows[] = [];
  walk(fields, data, undefined, "", configBlocks, out);
  return out.map((rows) => rows.path);
}
