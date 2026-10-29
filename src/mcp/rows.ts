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

export function rowFields(
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

type Rows = Extract<Field, { type: "array" | "blocks" }>;

/**
 * Calls `visit` for each array or blocks field `data` sets, with the rows
 * `stored` holds for it, then goes on into the rows matched by id. `stored`
 * undefined: a bulk update, where there's nothing to match and no going on.
 */
function eachRows(
  fields: Field[],
  data: Data,
  stored: Data | undefined,
  path: string,
  configBlocks: Block[],
  visit: (field: Rows, rows: unknown[], storedRows: unknown[] | undefined, path: string) => void,
): void {
  const into = (fields: Field[], data: Data, stored: Data | undefined, path: string) =>
    eachRows(fields, data, stored, path, configBlocks, visit);
  for (const field of fields) {
    if (field.type === "tabs") {
      for (const tab of field.tabs) {
        if (!tabHasName(tab)) {
          into(tab.fields, data, stored, path);
        } else if (isObject(data[tab.name])) {
          const inner = stored?.[tab.name];
          into(
            tab.fields,
            data[tab.name] as Data,
            stored && (isObject(inner) ? inner : {}),
            `${path}${tab.name}.`,
          );
        }
      }
      continue;
    }
    if (!fieldAffectsData(field)) {
      if ("fields" in field) into(field.fields, data, stored, path);
      continue;
    }
    if (!(field.name in data)) continue;
    const value = data[field.name];
    const storedValue = stored?.[field.name];

    if (field.type === "group" && isObject(value)) {
      into(
        field.fields,
        value,
        stored && (isObject(storedValue) ? storedValue : {}),
        `${path}${field.name}.`,
      );
      continue;
    }
    if ((field.type !== "array" && field.type !== "blocks") || !Array.isArray(value)) continue;

    const storedRows = stored && (Array.isArray(storedValue) ? storedValue : []);
    visit(field, value, storedRows, path + field.name);
    if (!storedRows) continue;
    value.forEach((row, index) => {
      const id = rowId(row);
      const match = storedRows.find((storedRow) => id !== undefined && rowId(storedRow) === id);
      if (!isObject(row) || !isObject(match)) return;
      into(
        rowFields(field, configBlocks, row.blockType),
        row,
        match,
        `${path}${field.name}.${index}.`,
      );
    });
  }
}

/**
 * Gives each block row `data` sends with an id but no `blockType` the stored
 * row's, in place, as Payload does when it writes: the checks that walk `data`
 * by schema can then see the row's fields.
 */
export function restoreBlockTypes(
  fields: Field[],
  data: Data,
  stored: Data,
  configBlocks: Block[] = [],
): void {
  eachRows(fields, data, stored, "", configBlocks, (field, rows, storedRows) => {
    if (field.type !== "blocks") return;
    for (const row of rows) {
      const id = rowId(row);
      if (!isObject(row) || row.blockType || id === undefined) continue;
      const match = storedRows!.find((storedRow) => rowId(storedRow) === id);
      if (isObject(match)) row.blockType = match.blockType;
    }
  });
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
  eachRows(fields, data, stored, "", configBlocks, (_, rows, storedRows, path) => {
    const sent = new Set(rows.map(rowId));
    const ids = storedRows!.map(rowId).filter((id) => id !== undefined && !sent.has(id));
    if (ids.length) out.push({ path, ids: ids as (string | number)[] });
  });
  return out;
}

/**
 * The array and blocks fields in `data`, which a bulk update writes to every
 * matched document; rows can't carry ids that hold across documents.
 */
export function findRowFields(fields: Field[], data: Data, configBlocks: Block[] = []): string[] {
  const out: string[] = [];
  eachRows(fields, data, undefined, "", configBlocks, (_, __, ___, path) => out.push(path));
  return out;
}
