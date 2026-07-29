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
 *   import { contentCliPlugin, type EndpointCustom } from '@jhb.software/payload-content-cli/plugin'
 *   export default buildConfig({ plugins: [contentCliPlugin()] })
 *
 * This module is the Payload plugin wiring (endpoint capture, response
 * assembly). The reusable schema API lives in `./schemaApi.ts`, field/JSON-schema
 * projection in `./fields.ts`, `./lexical.ts`, and `./jsonSchema.ts`. Types are
 * kept inline to avoid a hard dependency on `payload`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { extractEndpointMeta } from "./endpoints.js";
import { buildBlocksBySlug, buildLocalization, canRead, entityToSchema } from "./schemaApi.js";
import { SCHEMA_CONTRACT_VERSION } from "../schema-contract.js";
import type { EndpointSchema, EntitySchema, SchemaResponse } from "../schema-contract.js";

export { toFieldSchemas } from "./fields.js";
export { extractLexicalSummary } from "./lexical.js";
export { entityToJsonSchema } from "./jsonSchema.js";
export { getBlockSchema, getEntitySchema, listReadableEntities } from "./schemaApi.js";
export type { FieldSchema, ProjectionOptions } from "./fields.js";
export type { JsonSchema } from "./jsonSchema.js";
export type { LexicalFeatureSummary } from "./lexical.js";
export { SCHEMA_CONTRACT_VERSION } from "../schema-contract.js";
export type {
  EndpointSchema,
  EntitySchema,
  LocalizationSchema,
  SchemaResponse,
} from "../schema-contract.js";

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

export interface ContentCliPluginOptions {
  /** Override the default auth check for the /schema endpoint.
   *  Return true to allow access, false to deny. */
  access?: (req: any) => boolean | Promise<boolean>;
}

type ScopedEndpoint = EndpointSchema & {
  _scope?: { type: "collection" | "global"; slug: string };
};

export function contentCliPlugin(options?: ContentCliPluginOptions) {
  return (config: any): any => {
    // Applying the plugin twice would register the schema endpoint twice.
    const alreadyRegistered = (config.endpoints ?? []).some(
      (ep: any) => ep.path === "/content-cli/schema",
    );
    if (alreadyRegistered) return config;

    // Payload's API prefix is configurable; default matches Payload's default.
    const apiPrefix: string = config.routes?.api ?? "/api";

    // Capture custom endpoints from the raw user config before Payload
    // merges its built-in CRUD/auth routes into the runtime config.
    const customEndpoints: ScopedEndpoint[] = [];

    for (const endpoint of config.endpoints ?? []) {
      customEndpoints.push({
        path: `${apiPrefix}${endpoint.path}`,
        method: endpoint.method,
        ...extractEndpointMeta(endpoint.custom),
      });
    }

    for (const collection of config.collections ?? []) {
      for (const endpoint of collection.endpoints ?? []) {
        customEndpoints.push({
          path: `${apiPrefix}/${collection.slug}${endpoint.path}`,
          method: endpoint.method,
          ...extractEndpointMeta(endpoint.custom),
          _scope: { type: "collection", slug: collection.slug },
        });
      }
    }

    for (const global of config.globals ?? []) {
      for (const endpoint of global.endpoints ?? []) {
        customEndpoints.push({
          path: `${apiPrefix}/globals/${global.slug}${endpoint.path}`,
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
            const allowed = options?.access ? await options.access(req) : !!req.user;
            if (!allowed) {
              return Response.json({ error: "Unauthorized" }, { status: 401 });
            }
            const payload = req.payload;

            // Lookup for top-level block definitions (used by blockReferences).
            const blocksBySlug = buildBlocksBySlug(payload);

            const readableCollections = new Set<string>();
            const collections: Record<string, EntitySchema> = {};
            for (const collectionConfig of payload.config.collections) {
              if (!(await canRead(collectionConfig, req))) continue;
              readableCollections.add(collectionConfig.slug);
              collections[collectionConfig.slug] = entityToSchema(collectionConfig, blocksBySlug);
            }

            const readableGlobals = new Set<string>();
            const globals: Record<string, EntitySchema> = {};
            for (const globalConfig of payload.config.globals ?? []) {
              if (!(await canRead(globalConfig, req))) continue;
              readableGlobals.add(globalConfig.slug);
              globals[globalConfig.slug] = entityToSchema(globalConfig, blocksBySlug);
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

            const localization = buildLocalization(payload);

            const body: SchemaResponse = {
              version: SCHEMA_CONTRACT_VERSION,
              collections,
              globals,
              localization,
              endpoints,
            };
            return Response.json(body);
          },
        },
      ],
    };
  };
}
