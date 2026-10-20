import { z } from "zod/v3";
import { getBlockSchema, getEntitySchema, listReadableEntities } from "../plugin/index.js";
import { errorResult, jsonResult, textResult, type McpTool } from "./result.js";
import { renderSchemaTree, SCHEMA_TREE_LEGEND } from "./schemaTree.js";
import { GLOBAL_PREFIX, INTERNAL_COLLECTIONS, errorMessage, parseTarget } from "./target.js";

const readOnly = {
  readOnlyHint: true,
  destructiveHint: false,
  idempotentHint: true,
  openWorldHint: false,
};

export function listEntitiesTool(): McpTool {
  return {
    name: "listEntities",
    description:
      "List the collections and globals you may read, and the site's locales. Start here to discover what content exists.",
    annotations: { title: "List entities", ...readOnly },
    parameters: {},
    handler: async (_args, req) => {
      try {
        const { collections, globals, localization } = await listReadableEntities({ req });
        return jsonResult({
          collections: collections.filter((slug) => !INTERNAL_COLLECTIONS.has(slug)),
          ...(globals.length ? { globals: globals.map((slug) => GLOBAL_PREFIX + slug) } : {}),
          ...(localization
            ? { locales: localization.locales, defaultLocale: localization.defaultLocale }
            : {}),
        });
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  };
}

const entityArgs = z.object({
  collection: z
    .string()
    .describe('Collection slug, or "globals/<slug>" for a global (e.g. "globals/footer").'),
});

export function getEntitySchemaTool(): McpTool {
  return {
    name: "getEntitySchema",
    description: `Get the fields of a collection or global, as a tree. Read it before creating or updating content. Blocks are listed by slug; resolve the ones you need with the block schema tool. Payload's bookkeeping (timestamps, _status, row ids) is left out.\n\n${SCHEMA_TREE_LEGEND}`,
    annotations: { title: "Get entity schema", ...readOnly },
    parameters: entityArgs.shape,
    handler: async (args, req) => {
      try {
        const target = parseTarget(entityArgs.parse(args).collection);
        const { slug, fields } = await getEntitySchema({
          req,
          type: target.kind,
          slug: target.slug,
          blocks: "reference",
        });
        return textResult(renderSchemaTree(slug, target.kind, fields));
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  };
}

const blockArgs = z.object({
  slugs: z
    .array(z.string())
    .min(1)
    .describe("Block slugs, as an entity schema lists them. Pass all you need in one call."),
});

export function getBlockSchemaTool(): McpTool {
  return {
    name: "getBlockSchema",
    description:
      "Get the fields of blocks by slug, in the same tree format as entity schemas, for blocks fields and rich-text blocks alike. Blocks nested inside are listed by slug again.",
    annotations: { title: "Get block schema", ...readOnly },
    parameters: blockArgs.shape,
    handler: async (args, req) => {
      try {
        const blocks = await getBlockSchema({ req, slugs: blockArgs.parse(args).slugs });
        return textResult(
          blocks.map((block) => renderSchemaTree(block.slug, "block", block.fields)).join("\n\n"),
        );
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  };
}
