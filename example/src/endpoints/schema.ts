import type { Endpoint } from "payload";

import { toFieldSchemas } from "../../../src/plugin/index";
import type { FieldSchema } from "../../../src/plugin/index";

/**
 * Minimal example of a custom schema endpoint built on the plugin's field
 * walker. The plugin's own `/api/content-cli/schema` endpoint supersedes this
 * (access-aware, JSON schemas, endpoint metadata) — this only shows how to
 * reuse `toFieldSchemas` in your own endpoint.
 */
export const schemaEndpoint: Endpoint = {
  path: "/schema",
  method: "get",
  handler: async (req) => {
    const payload = req.payload;

    // Top-level block definitions, so `blockReferences` resolve.
    const blocksBySlug: Record<string, unknown> = {};
    for (const block of payload.config.blocks ?? []) {
      blocksBySlug[block.slug] = block;
    }

    const collections: Record<string, { slug: string; fields: FieldSchema[] }> = {};
    for (const collectionConfig of payload.config.collections) {
      collections[collectionConfig.slug] = {
        slug: collectionConfig.slug,
        fields: toFieldSchemas(collectionConfig.fields, blocksBySlug),
      };
    }

    const globals: Record<string, { slug: string; fields: FieldSchema[] }> = {};
    for (const globalConfig of payload.config.globals ?? []) {
      globals[globalConfig.slug] = {
        slug: globalConfig.slug,
        fields: toFieldSchemas(globalConfig.fields, blocksBySlug),
      };
    }

    const localization = payload.config.localization
      ? {
          locales: (payload.config.localization.locales as unknown[]).map((l) =>
            typeof l === "string" ? l : (l as { code: string }).code,
          ),
          defaultLocale: payload.config.localization.defaultLocale,
        }
      : null;

    return Response.json({ collections, globals, localization });
  },
};
