import type { SelectType, Sort, Where } from "payload";
import { z } from "zod/v3";
import { jsonObject, pickLocale, toObject, type McpContentToolsOptions } from "./options.js";
import { errorResult, jsonResult, type McpTool } from "./result.js";
import { entityConfig, errorMessage, parseTarget } from "./target.js";

const parameters = {
  collection: z
    .string()
    .describe('Collection slug, or "globals/<slug>" for a global (e.g. "globals/footer").'),
  id: z.union([z.string(), z.number()]).optional().describe("One document by id."),
  where: jsonObject
    .optional()
    .describe('Filter as a Payload query, e.g. {"slug":{"equals":"about"}}.'),
  select: jsonObject
    .optional()
    .describe('Only these fields, e.g. {"title":true}. Keeps the answer small.'),
  sort: z.string().optional().describe('Field to sort by; "-" for descending, e.g. "-createdAt".'),
  limit: z.number().int().min(1).max(100).optional().describe("Documents per page, default 10."),
  page: z.number().int().min(1).optional().describe("Page, default 1."),
  depth: z
    .number()
    .int()
    .min(0)
    .max(10)
    .optional()
    .describe("Levels of related documents to populate, default 0 (ids only)."),
  locale: z
    .string()
    .optional()
    .describe(
      'Locale to read, default the default locale; "all" for every locale. Values are as stored: an untranslated field is empty.',
    ),
  draft: z
    .boolean()
    .optional()
    .describe(
      "Default true: the latest draft, including unpublished changes. false: what is live.",
    ),
};

const argsSchema = z.object(parameters);

export function findTool(options: McpContentToolsOptions = {}): McpTool {
  return {
    name: "find",
    description:
      "Read documents: one by id, a page of a collection filtered by where, or a global. Use select and keep depth at 0 to keep answers small.",
    annotations: {
      title: "Find content",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
    },
    parameters,
    handler: async (args, req) => {
      try {
        const parsed = argsSchema.parse(args);
        const { collection, id } = parsed;
        const target = parseTarget(collection);
        if (!entityConfig(req, target)) return errorResult(`No ${target.kind} "${target.slug}".`);
        if (id !== undefined && options.checkId) {
          const refusal = options.checkId(collection, id);
          if (refusal) return errorResult(refusal);
        }

        const read = {
          depth: parsed.depth ?? 0,
          draft: parsed.draft ?? true,
          // Stored values only: a fallback reads as if the field were translated.
          fallbackLocale: false as const,
          locale: await pickLocale(options, req, { collection, id, locale: parsed.locale }),
          select: toObject(parsed.select, "select") as SelectType | undefined,
          overrideAccess: false,
          req,
        };

        if (target.kind === "global") {
          return jsonResult(await req.payload.findGlobal({ slug: target.slug, ...read }));
        }
        if (id !== undefined) {
          const doc = await req.payload.findByID({
            collection: target.slug,
            id,
            disableErrors: true,
            ...read,
          });
          return doc ? jsonResult(doc) : errorResult(`No ${target.slug} document with id "${id}".`);
        }
        const { docs, totalDocs, page, totalPages } = await req.payload.find({
          collection: target.slug,
          where: toObject(parsed.where, "where") as Where | undefined,
          sort: parsed.sort as Sort | undefined,
          limit: parsed.limit ?? 10,
          page: parsed.page ?? 1,
          ...read,
        });
        return jsonResult({ docs, totalDocs, page, totalPages });
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  };
}
