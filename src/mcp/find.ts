import type { SelectType, Sort, Where } from "payload";
import { z } from "zod/v3";
import { LexicalError, readAtPath, searchRichText } from "../lexical/index.js";
import { outlineRichText } from "../lexical/view.js";
import { getEntitySchema, type FieldSchema } from "../plugin/index.js";
import { explainMissingPath } from "./missingPath.js";
import { jsonObject, pickLocale, toObject, type McpContentToolsOptions } from "./options.js";
import { errorResult, jsonResult, type McpTool } from "./result.js";
import { errorMessage, openTarget } from "./target.js";

const parameters = {
  collection: z
    .string()
    .describe('Collection slug, or "globals/<slug>" for a global (e.g. "globals/footer").'),
  id: z.union([z.string(), z.number()]).optional().describe("One document by id."),
  path: z
    .union([z.string(), z.array(z.string())])
    .optional()
    .describe(
      'With id or a global: only the value at this dot path from the outline, e.g. "content.3" or "layout.1". A list reads several, keyed by path.',
    ),
  text: z
    .string()
    .optional()
    .describe(
      "With id or a global: the paths where this text occurs in rich text (below path, if given); matches inside a link are marked linked.",
    ),
  where: jsonObject
    .optional()
    .describe('Filter as a Payload query, e.g. {"slug":{"equals":"about"}}.'),
  select: jsonObject.optional().describe('Only these fields, e.g. {"title":true}. Not with path.'),
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
      'Default: the default locale; "all" for every locale. No fallback: an untranslated field is empty.',
    ),
  draft: z.boolean().optional().describe("Default true: the latest draft. false: what is live."),
};

const argsSchema = z.object(parameters);

export function findTool(options: McpContentToolsOptions = {}): McpTool {
  return {
    name: "find",
    description:
      'Read one document by id, a page of a collection (filtered by where), or a global. Rich text shows as an outline, one line per node starting with its path ("content.3 p: …"), links in [ ], bold **…**, italic *…*. Keep answers small with select or path and depth 0.',
    annotations: {
      title: "Find content",
      readOnlyHint: true,
      destructiveHint: false,
      idempotentHint: true,
      openWorldHint: false,
    },
    parameters,
    handler: async (args, req) => {
      try {
        const parsed = argsSchema.parse(args);
        const { collection, id, path, text } = parsed;
        const paths = path === undefined ? [] : Array.isArray(path) ? path : [path];
        const { target } = await openTarget(req, options, collection, id);
        const one = target.kind === "global" || id !== undefined;
        if ((path !== undefined || text !== undefined) && !one) {
          return errorResult("path and text read one document: pass id, or address a global.");
        }

        const select = toObject(parsed.select, "select") as SelectType | undefined;
        const locale = await pickLocale(options, req, { collection, id, locale: parsed.locale });
        if (locale === "all" && (path !== undefined || text !== undefined)) {
          return errorResult('path and text read one locale; pass one instead of "all".');
        }
        const read = {
          depth: parsed.depth ?? 0,
          draft: parsed.draft ?? true,
          // Stored values only: a fallback reads as if the field were translated.
          fallbackLocale: false as const,
          locale,
          // A path needs only its field.
          select: paths.length
            ? (Object.fromEntries(paths.map((p) => [p.split(".")[0], true])) as SelectType)
            : select,
          overrideAccess: false,
          req,
        };

        if (one) {
          const doc =
            target.kind === "global"
              ? await req.payload.findGlobal({ slug: target.slug, ...read })
              : await req.payload.findByID({
                  collection: target.slug,
                  id: id!,
                  disableErrors: true,
                  ...read,
                });
          if (!doc) return errorResult(`No ${target.slug} document with id "${id}".`);

          // A path the stored document lacks: a field with no value in this
          // locale reads as empty, anything else is explained by the schema.
          let fields: FieldSchema[] | undefined;
          const atPath = async <T>(p: string, readPath: () => T, empty: T): Promise<T> => {
            try {
              return readPath();
            } catch (err) {
              if (!(err instanceof LexicalError) || err.code !== "PATH_NOT_FOUND") throw err;
              fields ??= (
                await getEntitySchema({
                  req,
                  type: target.kind,
                  slug: target.slug,
                  blocks: "inline",
                })
              ).fields;
              const missing = explainMissingPath(doc, p, fields);
              if (missing?.empty) return empty;
              throw missing ? new Error(missing.message) : err;
            }
          };

          if (text !== undefined) {
            const matches = [];
            for (const p of paths.length ? paths : [""]) {
              matches.push(...(await atPath(p, () => searchRichText(doc, p, text), [])));
            }
            return jsonResult(matches);
          }
          if (path !== undefined) {
            const values: Record<string, unknown> = {};
            for (const p of paths)
              values[p] = (await atPath(p, () => readAtPath(doc, p), null)) ?? null;
            return jsonResult(Array.isArray(path) ? values : values[path]);
          }
          return jsonResult(outlineRichText(doc, ""));
        }
        const { docs, totalDocs, page, totalPages } = await req.payload.find({
          collection: target.slug,
          where: toObject(parsed.where, "where") as Where | undefined,
          sort: parsed.sort as Sort | undefined,
          limit: parsed.limit ?? 10,
          page: parsed.page ?? 1,
          ...read,
        });
        return jsonResult({
          docs: docs.map((doc) => outlineRichText(doc, "")),
          totalDocs,
          page,
          totalPages,
        });
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  };
}
