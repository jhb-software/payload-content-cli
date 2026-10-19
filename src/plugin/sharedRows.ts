/**
 * Finding writes that would silently drop other locales' translations.
 *
 * A non-localized `array`/`blocks` field whose sub-fields are localized stores
 * one set of rows shared by every locale; the localized values live inside the
 * rows, keyed by each row's `id`. Payload matches an incoming row to a stored
 * one by `id` alone, so a row written without one is a new row, and the row it
 * displaces takes every other locale's translation with it. The edited locale
 * comes out exactly as intended, so nothing about the write looks wrong.
 *
 * Fields that are themselves localized are unaffected: Payload stores a
 * separate array per locale, so their row ids are locale-local.
 */

import type { Block, Field } from "payload";
import { fieldAffectsData, tabHasName } from "payload/shared";

export type SharedRowViolation = {
  /** Dotted path to the field, e.g. `extras` or `sections[2].items`. */
  path: string;
  /** Row ids currently stored, in order: what the caller should have sent back. */
  existingIds: (string | number)[];
};

type Data = Record<string, unknown>;

const isObject = (value: unknown): value is Data =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const rowId = (row: Data): string | number | undefined =>
  typeof row.id === "string" || typeof row.id === "number" ? row.id : undefined;

/** The blocks a blocks field accepts, with `blockReferences` resolved against the config. */
function blocksOf(field: Extract<Field, { type: "blocks" }>, configBlocks: Block[]): Block[] {
  return (
    field.blockReferences
      ? field.blockReferences.map((ref) =>
          typeof ref === "string" ? configBlocks.find((block) => block.slug === ref) : ref,
        )
      : field.blocks
  ).filter((block): block is Block => Boolean(block));
}

/** The sub-fields of one row of an array or blocks field. */
function rowFields(
  field: Extract<Field, { type: "array" | "blocks" }>,
  configBlocks: Block[],
  blockType: unknown,
): Field[] {
  if (field.type === "array") return field.fields;
  return blocksOf(field, configBlocks).find((block) => block.slug === blockType)?.fields ?? [];
}

// Memoised per field array, which is the config's own and so stable: block
// definitions are shared across many fields, and may nest themselves.
const localizedBelow = new WeakMap<Field[], boolean>();

function hasLocalizedDescendant(fields: Field[], configBlocks: Block[]): boolean {
  const cached = localizedBelow.get(fields);
  if (cached !== undefined) return cached;
  // Seeded before recursing so a self-referencing block terminates.
  localizedBelow.set(fields, false);
  const result = fields.some((field) => {
    if (fieldAffectsData(field) && field.localized) return true;
    switch (field.type) {
      case "tabs":
        return field.tabs.some((tab) => hasLocalizedDescendant(tab.fields, configBlocks));
      case "array":
        return hasLocalizedDescendant(field.fields, configBlocks);
      case "blocks":
        return blocksOf(field, configBlocks).some((block) =>
          hasLocalizedDescendant(block.fields, configBlocks),
        );
      case "group":
      case "row":
      case "collapsible":
        return hasLocalizedDescendant(field.fields, configBlocks);
      default:
        return false;
    }
  });
  localizedBelow.set(fields, result);
  return result;
}

function walk(
  fields: Field[],
  data: Data,
  existing: Data | undefined,
  path: string,
  localizedAncestor: boolean,
  configBlocks: Block[],
  out: SharedRowViolation[],
): void {
  for (const field of fields) {
    if (field.type === "tabs") {
      for (const tab of field.tabs) {
        if (!tabHasName(tab)) {
          walk(tab.fields, data, existing, path, localizedAncestor, configBlocks, out);
          continue;
        }
        const value = data[tab.name];
        const existingValue = existing?.[tab.name];
        if (!isObject(value)) continue;
        walk(
          tab.fields,
          value,
          isObject(existingValue) ? existingValue : undefined,
          path ? `${path}.${tab.name}` : tab.name,
          localizedAncestor || Boolean(tab.localized),
          configBlocks,
          out,
        );
      }
      continue;
    }

    if (!fieldAffectsData(field)) {
      // Rows and collapsibles hold their sub-fields at the same data level.
      if ("fields" in field) {
        walk(field.fields, data, existing, path, localizedAncestor, configBlocks, out);
      }
      continue;
    }
    if (!(field.name in data)) continue;

    const value = data[field.name];
    const existingValue = existing?.[field.name];
    const childPath = path ? `${path}.${field.name}` : field.name;
    const localized = localizedAncestor || Boolean(field.localized);

    if (field.type === "group") {
      if (isObject(value)) {
        walk(
          field.fields,
          value,
          isObject(existingValue) ? existingValue : undefined,
          childPath,
          localized,
          configBlocks,
          out,
        );
      }
      continue;
    }
    if ((field.type !== "array" && field.type !== "blocks") || !Array.isArray(value)) continue;

    const rows = value.filter(isObject);
    const existingRows = Array.isArray(existingValue) ? existingValue.filter(isObject) : [];
    const shared = !localized && hasLocalizedDescendant([field], configBlocks);

    // Every incoming row is new, yet rows exist: this replaces them all. One
    // row with an id is enough to read the write as an edit plus additions.
    if (
      shared &&
      rows.length > 0 &&
      existingRows.length > 0 &&
      rows.every((row) => rowId(row) === undefined)
    ) {
      out.push({
        path: childPath,
        existingIds: existingRows.map(rowId).filter((id) => id !== undefined),
      });
      continue;
    }

    rows.forEach((row, index) => {
      const id = rowId(row);
      const match = id === undefined ? undefined : existingRows.find((r) => rowId(r) === id);
      walk(
        rowFields(field, configBlocks, row.blockType),
        row,
        match,
        `${childPath}[${id ?? index}]`,
        localized,
        configBlocks,
        out,
      );
    });
  }
}

/**
 * The array and blocks fields in `data` whose rows would all be replaced,
 * discarding the translations other locales hold for them.
 *
 * Keyed on whether a row has an `id`, not on whether it matches a stored one:
 * the admin panel mints an id for every new row, so an editor deleting all rows
 * and adding new ones sends fresh ids, and that replacement is intended.
 */
export function findDroppedSharedRows(
  fields: Field[],
  data: Data,
  existing: Data | undefined,
  configBlocks: Block[] = [],
): SharedRowViolation[] {
  if (!existing) return [];
  const out: SharedRowViolation[] = [];
  walk(fields, data, existing, "", false, configBlocks, out);
  return out;
}

/** Whether `data` holds any array of objects, i.e. whether a check is worth a read. */
export function containsObjectArray(data: unknown): boolean {
  if (Array.isArray(data))
    return data.some((entry) => isObject(entry) || containsObjectArray(entry));
  if (isObject(data)) return Object.values(data).some(containsObjectArray);
  return false;
}
