import type { PayloadRequest, Where } from "payload";
import { z } from "zod/v3";
import { ALLOW_SHARED_ROW_REPLACEMENT } from "../plugin/preserveSharedRows.js";
import { jsonObject, pickLocale, toObject, type McpContentToolsOptions } from "./options.js";
import { errorResult, jsonResult, type McpTool } from "./result.js";
import { entityConfig, errorMessage, hasDrafts, parseTarget } from "./target.js";

const collectionArg = z
  .string()
  .describe('Collection slug, or "globals/<slug>" for a global (e.g. "globals/footer").');

const localeArg = z
  .string()
  .optional()
  .describe("Locale to write, default the default locale. Localized fields only change in it.");

const writeAnnotations = { readOnlyHint: false, destructiveHint: false, idempotentHint: false };

const createParameters = {
  collection: z.string().describe("Collection slug."),
  data: jsonObject.describe(
    "Field values. Read the entity schema first; leave out virtual (read-only) fields.",
  ),
  locale: localeArg,
  draft: z
    .boolean()
    .optional()
    .describe(
      "Default true: an unpublished draft, required fields not yet enforced. false publishes it — only if the user asked.",
    ),
};

const updateParameters = {
  collection: collectionArg,
  id: z.union([z.string(), z.number()]).optional().describe("The document to update."),
  where: jsonObject
    .optional()
    .describe("Instead of id: update every document this Payload query matches."),
  data: jsonObject.describe(
    "Only the fields to change. Send array and blocks rows back with their id; a row without one is a new row.",
  ),
  locale: localeArg,
  draft: z
    .boolean()
    .optional()
    .describe(
      "Default true: save to the draft. false publishes the latest draft together with these changes — only if the user asked.",
    ),
  overwriteDraft: z
    .boolean()
    .optional()
    .describe("With where and draft:false, discard newer draft changes instead of refusing."),
  replaceRows: z
    .boolean()
    .optional()
    .describe(
      "Replace the rows of a shared array or blocks field, dropping their other-locale translations. Only after a write was refused for it.",
    ),
};

const createSchema = z.object(createParameters);
const updateSchema = z.object(updateParameters);

type Id = string | number;

/** The locale to write: one locale, since `"all"` expects every value keyed by locale. */
async function writeLocale(
  options: McpContentToolsOptions,
  req: PayloadRequest,
  target: { collection: string; id?: Id; locale?: string },
): Promise<string | undefined> {
  const locale = await pickLocale(options, req, target);
  if (locale === "all") throw new Error('Pick one locale to write; "all" can\'t be written.');
  return locale;
}

function requireData(value: Record<string, unknown> | string): Record<string, unknown> {
  const data = toObject(value, "data");
  if (!data) throw new Error("data is required.");
  return data;
}

export function createTool(options: McpContentToolsOptions = {}): McpTool {
  return {
    name: "create",
    description:
      "Create a document in a collection, as an unpublished draft unless draft:false. Answers with its id.",
    annotations: { title: "Create content", ...writeAnnotations },
    parameters: createParameters,
    handler: async (args, req) => {
      try {
        const parsed = createSchema.parse(args);
        const target = parseTarget(parsed.collection);
        if (target.kind === "global") {
          return errorResult("A global always exists; update it instead of creating it.");
        }
        const config = entityConfig(req, target);
        if (!config) return errorResult(`No collection "${target.slug}".`);
        const draft = parsed.draft ?? true;
        const drafts = hasDrafts(config);
        const data = requireData(parsed.data);
        // `draft: false` alone never publishes; `_status` has to say so.
        if (drafts) data._status = draft ? "draft" : "published";

        const doc = await req.payload.create({
          collection: target.slug,
          data,
          draft,
          locale: await writeLocale(options, req, {
            collection: parsed.collection,
            locale: parsed.locale,
          }),
          depth: 0,
          select: {},
          overrideAccess: false,
          req,
        });
        return jsonResult(drafts ? { id: doc.id, status: data._status } : { id: doc.id });
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  };
}

/**
 * Of the documents `where` matches, those whose latest draft is newer than
 * what is live. A bulk publish starts from the live documents, so it would
 * discard those drafts.
 */
async function withNewerDrafts(req: PayloadRequest, collection: string, where: Where) {
  const common = {
    collection,
    depth: 0,
    pagination: false,
    select: { updatedAt: true },
    overrideAccess: false,
    req,
  } as const;
  const live = await req.payload.find({ ...common, where, draft: false });
  const ids = live.docs.map((doc) => doc.id);
  if (ids.length === 0) return [];
  const drafts = await req.payload.find({ ...common, where: { id: { in: ids } }, draft: true });
  const liveAt = new Map(live.docs.map((doc) => [doc.id, Date.parse(String(doc.updatedAt))]));
  return drafts.docs
    .filter((doc) => Date.parse(String(doc.updatedAt)) > (liveAt.get(doc.id) ?? Infinity))
    .map((doc) => doc.id);
}

export function updateTool(options: McpContentToolsOptions = {}): McpTool {
  return {
    name: "update",
    description:
      "Change fields of a document by id, of every document a where clause matches, or of a global. Saves to the draft unless draft:false. Only the fields in data change.",
    annotations: { title: "Update content", ...writeAnnotations },
    parameters: updateParameters,
    handler: async (args, req) => {
      try {
        const parsed = updateSchema.parse(args);
        const { collection, id } = parsed;
        const target = parseTarget(collection);
        const config = entityConfig(req, target);
        if (!config) return errorResult(`No ${target.kind} "${target.slug}".`);
        if (id !== undefined && options.checkId) {
          const refusal = options.checkId(collection, id);
          if (refusal) return errorResult(refusal);
        }
        const where = toObject(parsed.where, "where") as Where | undefined;
        if (target.kind === "collection" && (id === undefined) === (where === undefined)) {
          return errorResult("Pass either id or where.");
        }

        const draft = parsed.draft ?? true;
        const drafts = hasDrafts(config);
        const data = requireData(parsed.data);
        if (drafts) data._status = draft ? "draft" : "published";
        const status = drafts ? { status: data._status } : {};
        const write = {
          data,
          draft,
          locale: await writeLocale(options, req, { collection, id, locale: parsed.locale }),
          depth: 0,
          select: {},
          overrideAccess: false,
          context: parsed.replaceRows ? { [ALLOW_SHARED_ROW_REPLACEMENT]: true } : undefined,
          req,
        };

        if (target.kind === "global") {
          await req.payload.updateGlobal({ slug: target.slug, ...write });
          return jsonResult(status);
        }
        if (id !== undefined) {
          await req.payload.update({ collection: target.slug, id, ...write });
          return jsonResult({ id, ...status });
        }

        if (drafts && !draft && !parsed.overwriteDraft) {
          const newer = await withNewerDrafts(req, target.slug, where!);
          if (newer.length > 0) {
            return errorResult(
              `Refused: ${newer.join(", ")} ${newer.length === 1 ? "has" : "have"} unpublished draft changes, which a bulk publish would discard. Publish those by id, which keeps their drafts, or pass overwriteDraft:true to discard them.`,
            );
          }
        }
        const { docs, errors } = await req.payload.update({
          collection: target.slug,
          where: where!,
          ...write,
        });
        return jsonResult({
          ids: docs.map((doc) => doc.id),
          ...status,
          ...(errors.length ? { errors } : {}),
        });
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  };
}
