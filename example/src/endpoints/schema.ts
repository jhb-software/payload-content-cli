import type { Endpoint } from "payload";

interface FieldSchema {
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
}

function extractFields(fields: any[]): FieldSchema[] {
  return fields
    .filter((f: any) => f.name) // skip unnamed fields (like row/collapsible wrappers)
    .map((field: any) => {
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

      // Nested fields (group, array)
      if (field.fields && Array.isArray(field.fields)) {
        schema.fields = extractFields(field.fields);
      }

      // Blocks
      if (field.blocks && Array.isArray(field.blocks)) {
        schema.blocks = field.blocks.map((block: any) => ({
          slug: block.slug,
          fields: extractFields(block.fields || []),
        }));
      }

      // Select options
      if (field.options && Array.isArray(field.options)) {
        schema.options = field.options.map((opt: any) =>
          typeof opt === "string"
            ? { label: opt, value: opt }
            : { label: opt.label, value: opt.value },
        );
      }

      return schema;
    });
}

export const schemaEndpoint: Endpoint = {
  path: "/schema",
  method: "get",
  handler: async (req) => {
    const payload = req.payload;

    const collections: Record<string, { slug: string; fields: FieldSchema[] }> =
      {};
    for (const collectionConfig of payload.config.collections) {
      collections[collectionConfig.slug] = {
        slug: collectionConfig.slug,
        fields: extractFields(collectionConfig.fields),
      };
    }

    const globals: Record<string, { slug: string; fields: FieldSchema[] }> = {};
    for (const globalConfig of payload.config.globals ?? []) {
      globals[globalConfig.slug] = {
        slug: globalConfig.slug,
        fields: extractFields(globalConfig.fields),
      };
    }

    const localization = payload.config.localization
      ? {
          locales: (payload.config.localization.locales as any[]).map(
            (l: any) => (typeof l === "string" ? l : l.code),
          ),
          defaultLocale: payload.config.localization.defaultLocale,
        }
      : null;

    return Response.json({ collections, globals, localization });
  },
};
