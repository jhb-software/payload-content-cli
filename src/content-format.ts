export interface FieldSchema {
  name: string;
  type: string;
  virtual?: boolean;
  fields?: FieldSchema[];
  blocks?: { slug: string; fields: FieldSchema[] }[];
}

export function stripVirtualFields(doc: Record<string, unknown>, fields: FieldSchema[]): void {
  for (const field of fields) {
    if (field.virtual) {
      delete doc[field.name];
    } else if (field.fields && doc[field.name] != null) {
      if (field.type === "array" && Array.isArray(doc[field.name])) {
        for (const item of doc[field.name] as Record<string, unknown>[]) {
          stripVirtualFields(item, field.fields);
        }
      } else if (field.type === "group" && typeof doc[field.name] === "object") {
        stripVirtualFields(doc[field.name] as Record<string, unknown>, field.fields);
      }
    } else if (field.blocks && doc[field.name] != null) {
      if (Array.isArray(doc[field.name])) {
        for (const item of doc[field.name] as Record<string, unknown>[]) {
          const blockType = item.blockType as string | undefined;
          const blockDef = field.blocks.find((b) => b.slug === blockType);
          if (blockDef) {
            stripVirtualFields(item, blockDef.fields);
          }
        }
      }
    }
  }
}

/**
 * Render a fetched document to the exact on-disk string `pull` writes: virtual
 * fields stripped, an optional `$schema` reference prepended, pretty-printed
 * with a trailing newline. Hashing this output lets `push` and `diff` compare a
 * freshly-fetched remote against the hash stored at pull time. `stripVirtualFields`
 * mutates `doc`, so callers should pass a document they own.
 */
export function formatDocument(
  doc: Record<string, unknown>,
  fields: FieldSchema[] | undefined,
  hasJsonSchema: boolean,
): string {
  if (fields) stripVirtualFields(doc, fields);
  const finalDoc = hasJsonSchema ? { $schema: "./_jsonschema.json", ...doc } : doc;
  return JSON.stringify(finalDoc, null, 2) + "\n";
}
