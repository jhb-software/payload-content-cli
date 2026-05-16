/**
 * Payload plugin that exposes a `/api/content-cli/schema` endpoint for the CLI.
 * Provides field schemas and localization config as metadata.
 *
 * The schema response is access-aware: each collection and global is included
 * only if the requester passes its `access.read` (matching `/api/access`).
 * Use Payload's access control to hide entities from the CLI rather than
 * plugin options.
 *
 * Usage in payload.config.ts:
 *   import { contentCliPlugin, type EndpointCustom } from 'payload-content-cli/plugin'
 *   export default buildConfig({ plugins: [contentCliPlugin()] })
 *
 * Types are kept inline to avoid a hard dependency on `payload`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

/** Type for the `custom` property on Payload endpoints, used by the CLI plugin. */
export interface EndpointCustom {
  /** Human-readable description of what the endpoint does */
  description?: string;
  /** Describes the endpoint's request/response contract */
  schema?: {
    /** Query string parameters */
    query?: Record<string, unknown>;
    /** Request body shape */
    body?: Record<string, unknown>;
    /** Response shape */
    response?: Record<string, unknown>;
  };
}

interface EndpointSchema {
  /** Resolved API path, e.g. "/api/posts/publish" */
  path: string;
  method: string;
  /** Human-readable description of what the endpoint does */
  description?: string;
  /** Describes the endpoint's request/response contract */
  schema?: {
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
    response?: Record<string, unknown>;
  };
}

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
}

// Alternative: import { flattenTopLevelFields } from 'payload/utilities/flattenTopLevelFields'
// with moveSubFieldsToTop: true — but that adds a hard dependency on `payload`.
export function extractFields(
  fields: any[],
  blocksBySlug: Record<string, any> = {},
): FieldSchema[] {
  const result: FieldSchema[] = [];

  for (const field of fields) {
    // UI fields are admin-only React widgets — no data, irrelevant to agents.
    if (field.type === "ui") continue;

    // Tabs field: hoist unnamed tab fields, keep named tabs as nested
    if (field.type === "tabs" && Array.isArray(field.tabs)) {
      for (const tab of field.tabs) {
        if (tab.name) {
          // Named tab — behaves like a group
          result.push({
            name: tab.name,
            type: "tab",
            fields: extractFields(tab.fields || [], blocksBySlug),
          });
        } else {
          // Unnamed tab — hoist fields to parent level
          result.push(...extractFields(tab.fields || [], blocksBySlug));
        }
      }
      continue;
    }

    // Row / collapsible: unnamed layout wrappers — hoist their fields
    if (
      (field.type === "row" || field.type === "collapsible") &&
      !field.name &&
      Array.isArray(field.fields)
    ) {
      result.push(...extractFields(field.fields, blocksBySlug));
      continue;
    }

    if (!field.name) continue;

    const schema: FieldSchema = {
      name: field.name,
      type: field.type,
    };

    if (field.required) schema.required = true;
    if (field.localized) schema.localized = true;
    if (field.virtual) schema.virtual = true;
    if (field.hasMany) schema.hasMany = true;
    if (field.relationTo) schema.relationTo = field.relationTo;

    if (field.fields && Array.isArray(field.fields)) {
      schema.fields = extractFields(field.fields, blocksBySlug);
    }

    // Resolve inline blocks + blockReferences (slugs pointing to config.blocks)
    const inlineBlocks: any[] =
      field.blocks && Array.isArray(field.blocks) ? field.blocks : [];
    const refBlocks: any[] = Array.isArray(field.blockReferences)
      ? field.blockReferences
          .map((blockRef: any) => {
            const slug =
              typeof blockRef === "string" ? blockRef : blockRef.slug;
            return blocksBySlug[slug];
          })
          .filter(Boolean)
      : [];
    const allBlocks = [...inlineBlocks, ...refBlocks];

    if (allBlocks.length > 0) {
      schema.blocks = allBlocks.map((block: any) => ({
        slug: block.slug,
        fields: extractFields(block.fields || [], blocksBySlug),
      }));
    }

    if (field.options && Array.isArray(field.options)) {
      schema.options = field.options.map((option: any) =>
        typeof option === "string"
          ? { label: option, value: option }
          : { label: option.label, value: option.value },
      );
    }

    result.push(schema);
  }

  return result;
}

type JsonSchema = {
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

function idReferenceSchema(
  relationTo: string | string[] | undefined,
): JsonSchema {
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
      const enumValues = field.options?.map((o) => o.value) ?? [];
      const single: JsonSchema =
        enumValues.length > 0
          ? { type: "string", enum: enumValues }
          : { type: "string" };
      return field.hasMany ? { type: "array", items: single } : single;
    }
    case "radio": {
      const enumValues = field.options?.map((o) => o.value) ?? [];
      return enumValues.length > 0
        ? { type: "string", enum: enumValues }
        : { type: "string" };
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
export function entityToJsonSchema(
  slug: string,
  fields: FieldSchema[],
): JsonSchema {
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

/** Extract optional CLI metadata from an endpoint's `custom` property. */
export function extractEndpointMeta(
  custom: any,
): Pick<EndpointSchema, "description" | "schema"> {
  if (!custom || typeof custom !== "object") return {};
  const meta: Pick<EndpointSchema, "description" | "schema"> = {};
  if (typeof custom.description === "string")
    meta.description = custom.description;
  if (custom.schema && typeof custom.schema === "object") {
    const schema: NonNullable<EndpointSchema["schema"]> = {};
    if (custom.schema.query && typeof custom.schema.query === "object")
      schema.query = custom.schema.query;
    if (custom.schema.body && typeof custom.schema.body === "object")
      schema.body = custom.schema.body;
    if (custom.schema.response && typeof custom.schema.response === "object")
      schema.response = custom.schema.response;
    if (Object.keys(schema).length > 0) meta.schema = schema;
  }
  return meta;
}

export interface ContentCliPluginOptions {
  /** Override the default auth check for the /schema endpoint.
   *  Return true to allow access, false to deny. */
  access?: (req: any) => boolean | Promise<boolean>;
}

type ScopedEndpoint = EndpointSchema & {
  _scope?: { type: "collection" | "global"; slug: string };
};

// Mirrors Payload's read-access evaluation (see auth/getEntityPermissions.ts):
// a function returning true OR a Where clause counts as "has read access";
// falsy counts as "denied". With no `access.read` defined, Payload's default
// is `isLoggedIn`.
async function canRead(entity: any, req: any): Promise<boolean> {
  const fn = entity?.access?.read;
  if (typeof fn !== "function") return !!req.user;
  try {
    const result = await fn({ req });
    return !!result;
  } catch {
    return false;
  }
}

export function contentCliPlugin(options?: ContentCliPluginOptions) {
  return (config: any): any => {
    // Capture custom endpoints from the raw user config before Payload
    // merges its built-in CRUD/auth routes into the runtime config.
    const customEndpoints: ScopedEndpoint[] = [];

    for (const endpoint of config.endpoints ?? []) {
      if (endpoint.path === "/content-cli/schema") continue;
      customEndpoints.push({
        path: `/api${endpoint.path}`,
        method: endpoint.method,
        ...extractEndpointMeta(endpoint.custom),
      });
    }

    for (const collection of config.collections ?? []) {
      for (const endpoint of collection.endpoints ?? []) {
        customEndpoints.push({
          path: `/api/${collection.slug}${endpoint.path}`,
          method: endpoint.method,
          ...extractEndpointMeta(endpoint.custom),
          _scope: { type: "collection", slug: collection.slug },
        });
      }
    }

    for (const global of config.globals ?? []) {
      for (const endpoint of global.endpoints ?? []) {
        customEndpoints.push({
          path: `/api/globals/${global.slug}${endpoint.path}`,
          method: endpoint.method,
          ...extractEndpointMeta(endpoint.custom),
          _scope: { type: "global", slug: global.slug },
        });
      }
    }

    return {
      ...config,
      endpoints: [
        ...(config.endpoints ?? []),
        {
          path: "/content-cli/schema",
          method: "get",
          handler: async (req: any) => {
            const allowed = options?.access
              ? await options.access(req)
              : !!req.user;
            if (!allowed) {
              return Response.json({ error: "Unauthorized" }, { status: 401 });
            }
            const payload = req.payload;

            // Build lookup for top-level block definitions (used by blockReferences)
            const blocksBySlug: Record<string, any> = {};
            for (const block of payload.config.blocks ?? []) {
              blocksBySlug[block.slug] = block;
            }

            const readableCollections = new Set<string>();
            const collections: Record<
              string,
              { slug: string; fields: FieldSchema[]; jsonSchema: JsonSchema }
            > = {};
            for (const collectionConfig of payload.config.collections) {
              if (!(await canRead(collectionConfig, req))) continue;
              readableCollections.add(collectionConfig.slug);
              const fields = extractFields(
                collectionConfig.fields,
                blocksBySlug,
              );
              collections[collectionConfig.slug] = {
                slug: collectionConfig.slug,
                fields,
                jsonSchema: entityToJsonSchema(collectionConfig.slug, fields),
              };
            }

            const readableGlobals = new Set<string>();
            const globals: Record<
              string,
              { slug: string; fields: FieldSchema[]; jsonSchema: JsonSchema }
            > = {};
            for (const globalConfig of payload.config.globals ?? []) {
              if (!(await canRead(globalConfig, req))) continue;
              readableGlobals.add(globalConfig.slug);
              const fields = extractFields(globalConfig.fields, blocksBySlug);
              globals[globalConfig.slug] = {
                slug: globalConfig.slug,
                fields,
                jsonSchema: entityToJsonSchema(globalConfig.slug, fields),
              };
            }

            const endpoints: EndpointSchema[] = customEndpoints
              .filter((ep) => {
                if (!ep._scope) return true;
                if (ep._scope.type === "collection") {
                  return readableCollections.has(ep._scope.slug);
                }
                return readableGlobals.has(ep._scope.slug);
              })
              .map(({ _scope, ...rest }) => rest);

            const localization = payload.config.localization
              ? {
                  locales: (payload.config.localization.locales as any[]).map(
                    (locale: any) =>
                      typeof locale === "string" ? locale : locale.code,
                  ),
                  defaultLocale: payload.config.localization.defaultLocale,
                }
              : null;

            return Response.json({
              collections,
              globals,
              localization,
              endpoints,
            });
          },
        },
      ],
    };
  };
}
