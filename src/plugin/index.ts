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
 * This module is the Payload plugin wiring (endpoint capture, response
 * assembly). The reusable schema API lives in `./schemaApi.ts`, field/JSON-schema
 * projection in `./fields.ts`, `./lexical.ts`, and `./jsonSchema.ts`. All Payload
 * types are imported type-only, so the package never pulls Payload in at runtime.
 */

import type { Config, PayloadRequest } from "payload";

import { buildBlocksBySlug, buildLocalization, canRead, entityToSchema } from "./schemaApi.js";
import type { FieldSchema } from "./fields.js";
import type { JsonSchema } from "./jsonSchema.js";

export { toFieldSchemas } from "./fields.js";
export { entityToJsonSchema } from "./jsonSchema.js";
export { getBlockSchema, getEntitySchema, listReadableEntities } from "./schemaApi.js";
export type { FieldSchema } from "./fields.js";
export type { JsonSchema } from "./jsonSchema.js";
export type { LexicalFeatureSummary } from "./lexical.js";

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

/** Extract optional CLI metadata from an endpoint's `custom` property. */
export function extractEndpointMeta(
  custom: unknown,
): Pick<EndpointSchema, "description" | "schema"> {
  if (!custom || typeof custom !== "object") return {};
  const customRecord = custom as Record<string, unknown>;
  const meta: Pick<EndpointSchema, "description" | "schema"> = {};
  if (typeof customRecord.description === "string") meta.description = customRecord.description;
  if (customRecord.schema && typeof customRecord.schema === "object") {
    const schemaRecord = customRecord.schema as Record<string, unknown>;
    const schema: NonNullable<EndpointSchema["schema"]> = {};
    if (schemaRecord.query && typeof schemaRecord.query === "object")
      schema.query = schemaRecord.query as Record<string, unknown>;
    if (schemaRecord.body && typeof schemaRecord.body === "object")
      schema.body = schemaRecord.body as Record<string, unknown>;
    if (schemaRecord.response && typeof schemaRecord.response === "object")
      schema.response = schemaRecord.response as Record<string, unknown>;
    if (Object.keys(schema).length > 0) meta.schema = schema;
  }
  return meta;
}

export interface ContentCliPluginOptions {
  /** Override the default auth check for the /schema endpoint.
   *  Return true to allow access, false to deny. */
  access?: (req: PayloadRequest) => boolean | Promise<boolean>;
}

type ScopedEndpoint = EndpointSchema & {
  _scope?: { type: "collection" | "global"; slug: string };
};

export function contentCliPlugin(options?: ContentCliPluginOptions) {
  return (config: Config): Config => {
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
      for (const endpoint of collection.endpoints || []) {
        customEndpoints.push({
          path: `/api/${collection.slug}${endpoint.path}`,
          method: endpoint.method,
          ...extractEndpointMeta(endpoint.custom),
          _scope: { type: "collection", slug: collection.slug },
        });
      }
    }

    for (const global of config.globals ?? []) {
      for (const endpoint of global.endpoints || []) {
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
          handler: async (req: PayloadRequest) => {
            const allowed = options?.access ? await options.access(req) : !!req.user;
            if (!allowed) {
              return Response.json({ error: "Unauthorized" }, { status: 401 });
            }
            const payload = req.payload;

            // Lookup for top-level block definitions (used by blockReferences).
            const blocksBySlug = buildBlocksBySlug(payload);

            const readableCollections = new Set<string>();
            const collections: Record<
              string,
              { slug: string; fields: FieldSchema[]; jsonSchema: JsonSchema }
            > = {};
            for (const collectionConfig of payload.config.collections) {
              if (!(await canRead(collectionConfig, req))) continue;
              readableCollections.add(collectionConfig.slug);
              collections[collectionConfig.slug] = entityToSchema(collectionConfig, blocksBySlug);
            }

            const readableGlobals = new Set<string>();
            const globals: Record<
              string,
              { slug: string; fields: FieldSchema[]; jsonSchema: JsonSchema }
            > = {};
            for (const globalConfig of payload.config.globals ?? []) {
              if (!(await canRead(globalConfig, req))) continue;
              readableGlobals.add(globalConfig.slug);
              globals[globalConfig.slug] = entityToSchema(globalConfig, blocksBySlug);
            }

            const endpoints: EndpointSchema[] = customEndpoints
              .filter((endpoint) => {
                if (!endpoint._scope) return true;
                if (endpoint._scope.type === "collection") {
                  return readableCollections.has(endpoint._scope.slug);
                }
                return readableGlobals.has(endpoint._scope.slug);
              })
              .map(({ _scope, ...rest }) => rest);

            const localization = buildLocalization(payload);

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
