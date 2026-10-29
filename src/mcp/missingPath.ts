import type { FieldSchema } from "../plugin/index.js";
import { isRecord } from "./richTextChecks.js";

/**
 * Why the stored document has nothing at a path, by the schema: the path names
 * a field this locale has no value for (`empty`), or something that isn't
 * there (`message`): a name the schema doesn't have where it says so, or a row
 * of a list this locale has no value for. Undefined when the schema can't say
 * more than the path error already does, e.g. inside rich text or past the end
 * of a list.
 *
 * A stored document only holds the fields that have values (in this locale),
 * so its keys alone make an empty field read like a typo.
 */
export type MissingPath = { empty: true } | { empty: false; message: string };

/** Enough to spot the field meant, without listing a whole wide schema. */
const LISTED_FIELDS = 30;

export function explainMissingPath(
  doc: unknown,
  path: string,
  fields: FieldSchema[],
): MissingPath | undefined {
  const segments = path.split(".");
  // Undefined once inside a named tab this locale has no value for: the schema
  // still says which names exist below it.
  let value = doc;
  let schema = fields;
  for (let i = 0; i < segments.length; i++) {
    const field = schema.find((f) => f.name === segments[i]);
    const next = isRecord(value) ? value[segments[i]] : undefined;
    if (!field) {
      // A key the data has but the schema doesn't name (an `id`, a `blockType`).
      if (next !== undefined) return undefined;
      const at = segments.slice(0, i).join(".") || "the document";
      const names = schema.filter((f) => !f.system).map((f) => f.name);
      const more =
        names.length > LISTED_FIELDS
          ? ` and ${names.length - LISTED_FIELDS} more (see getEntitySchema)`
          : "";
      return {
        empty: false,
        message: `No "${segments[i]}" in ${at}. Its fields: ${names.slice(0, LISTED_FIELDS).join(", ")}${more}.`,
      };
    }
    const last = i === segments.length - 1;
    const rows = field.type === "array" || field.type === "blocks";
    if (next == null && (last || field.type === "richText")) return { empty: true };
    if (rows) {
      // Without a value in this locale, a list has no rows, as an empty one (the
      // path error past the end of one names the rows there are).
      if (next == null) {
        const at = segments.slice(0, i + 1).join(".");
        return { empty: false, message: `No "${segments[i + 1]}" at ${at}: it has no items.` };
      }
      const row: unknown = Array.isArray(next) ? next[Number(segments[++i])] : undefined;
      if (!isRecord(row)) return undefined;
      const rowFields =
        field.type === "array"
          ? field.fields
          : field.blocks?.find((block) => block.slug === row.blockType)?.fields;
      if (!rowFields) return undefined;
      value = row;
      schema = rowFields;
    } else if (field.fields) {
      value = next;
      schema = field.fields;
    } else {
      return undefined;
    }
  }
  return undefined;
}
