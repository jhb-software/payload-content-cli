/**
 * JSON Schema generation for the content-cli plugin.
 *
 * Turns a `FieldSchema[]` (see `./fields.ts`) into a JSON Schema document for
 * editor validation of pulled content files. The shape matches what the CLI
 * writes to disk.
 *
 * Types are kept inline to avoid a hard dependency on `payload`.
 */

import type { FieldSchema } from "./fields.js";

export type JsonSchema = {
  type?: string | string[];
  format?: string;
  enum?: unknown[];
  const?: unknown;
  properties?: Record<string, JsonSchema>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchema;
  oneOf?: JsonSchema[];
  minItems?: number;
  maxItems?: number;
  $schema?: string;
  title?: string;
};

function idReferenceSchema(relationTo: string | string[] | undefined): JsonSchema {
  if (Array.isArray(relationTo)) {
    return {
      type: "object",
      additionalProperties: true,
      properties: {
        relationTo: { type: "string", enum: relationTo },
        value: { type: ["string", "number"] },
      },
      required: ["relationTo", "value"],
    };
  }
  return { type: ["string", "number"] };
}

function fieldToJsonSchema(field: FieldSchema): JsonSchema | null {
  switch (field.type) {
    case "text":
    case "textarea":
    case "email":
    case "code":
      return { type: "string" };
    case "number":
      return { type: "number" };
    case "checkbox":
      return { type: "boolean" };
    case "date":
      return { type: "string", format: "date-time" };
    case "select": {
      const enumValues = field.options?.map((option) => option.value) ?? [];
      const single: JsonSchema =
        enumValues.length > 0 ? { type: "string", enum: enumValues } : { type: "string" };
      return field.hasMany ? { type: "array", items: single } : single;
    }
    case "radio": {
      const enumValues = field.options?.map((option) => option.value) ?? [];
      return enumValues.length > 0 ? { type: "string", enum: enumValues } : { type: "string" };
    }
    case "relationship":
    case "upload": {
      const idSchema = idReferenceSchema(field.relationTo);
      return field.hasMany ? { type: "array", items: idSchema } : idSchema;
    }
    case "group":
    case "tab": {
      const { properties, required } = fieldsToJsonSchema(field.fields ?? []);
      const schema: JsonSchema = {
        type: "object",
        additionalProperties: true,
        properties,
      };
      if (required.length) schema.required = required;
      return schema;
    }
    case "array": {
      const { properties, required } = fieldsToJsonSchema(field.fields ?? []);
      const item: JsonSchema = {
        type: "object",
        additionalProperties: true,
        properties: { ...properties, id: { type: "string" } },
      };
      if (required.length) item.required = required;
      return { type: "array", items: item };
    }
    case "blocks": {
      const blockSchemas: JsonSchema[] = (field.blocks ?? []).map((block) => {
        const { properties, required } = fieldsToJsonSchema(block.fields ?? []);
        return {
          type: "object",
          additionalProperties: true,
          properties: {
            ...properties,
            blockType: { type: "string", const: block.slug },
            id: { type: "string" },
          },
          required: ["blockType", ...required],
        };
      });
      const items: JsonSchema =
        blockSchemas.length === 1 ? blockSchemas[0] : { oneOf: blockSchemas };
      return { type: "array", items };
    }
    case "richText":
      return { type: "object" };
    case "json":
      return {};
    case "point":
      return {
        type: "array",
        items: { type: "number" },
        minItems: 2,
        maxItems: 2,
      };
    default:
      return {};
  }
}

function makeNullable(schema: JsonSchema): JsonSchema {
  const nullableEnum = schema.enum
    ? {
        enum: schema.enum.includes(null) ? schema.enum : [...schema.enum, null],
      }
    : {};
  if (typeof schema.type === "string") {
    return { ...schema, ...nullableEnum, type: [schema.type, "null"] };
  }
  if (Array.isArray(schema.type)) {
    return schema.type.includes("null")
      ? { ...schema, ...nullableEnum }
      : { ...schema, ...nullableEnum, type: [...schema.type, "null"] };
  }
  if (schema.oneOf) {
    return { oneOf: [...schema.oneOf, { type: "null" }] };
  }
  return schema;
}

// Mirrors Payload's `fieldIsRequired` (configToJSONSchema.ts): a group/tab
// is required if it's marked required OR any descendant field is required.
// `array` is excluded — an empty array satisfies the parent regardless of
// what its items require.
function fieldIsRequired(field: FieldSchema): boolean {
  if (field.virtual) return false;
  if (field.required) return true;
  if (field.type !== "array" && Array.isArray(field.fields)) {
    return field.fields.some(fieldIsRequired);
  }
  return false;
}

function fieldsToJsonSchema(fields: FieldSchema[]): {
  properties: Record<string, JsonSchema>;
  required: string[];
} {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const field of fields) {
    if (field.virtual) continue;
    if (field.type === "ui") continue;
    const schema = fieldToJsonSchema(field);
    if (!schema) continue;
    const isRequired = fieldIsRequired(field);
    properties[field.name] = isRequired ? schema : makeNullable(schema);
    if (isRequired) required.push(field.name);
  }
  return { properties, required };
}

/**
 * Builds a JSON Schema document for a collection or global, suitable for
 * editor validation of pulled content files. The shape matches what the
 * CLI writes to disk: virtual fields stripped, `$schema` allowed at the
 * top level, system fields (`id`, timestamps, `_status`, `globalType`)
 * allowed but not required.
 */
export function entityToJsonSchema(slug: string, fields: FieldSchema[]): JsonSchema {
  const { properties, required } = fieldsToJsonSchema(fields);
  const schema: JsonSchema = {
    $schema: "http://json-schema.org/draft-07/schema#",
    title: slug,
    type: "object",
    additionalProperties: true,
    properties: {
      $schema: { type: "string" },
      id: { type: ["string", "number"] },
      createdAt: { type: "string", format: "date-time" },
      updatedAt: { type: "string", format: "date-time" },
      _status: { type: "string", enum: ["draft", "published"] },
      globalType: { type: "string" },
      ...properties,
    },
  };
  if (required.length) schema.required = required;
  return schema;
}
