import type { PayloadRequest, SelectType, Where } from "payload";
import { z } from "zod/v3";
import { restoreOutlines } from "../lexical/view.js";
import { ALLOW_SHARED_ROW_REPLACEMENT, isSharedRowRefusal } from "../plugin/preserveSharedRows.js";
import { jsonObject, pickLocale, toObject, type McpContentToolsOptions } from "./options.js";
import { errorResult, jsonResult, type McpTool } from "./result.js";
import { hydrateRichText, objectsIn, richTextFieldsIn } from "./richTextData.js";
import { findAddedProblem } from "./richTextChecks.js";
import { findLeftOutRows, findRowFields } from "./rows.js";
import { errorMessage, hasDrafts, openTarget, type EntityConfig, type Target } from "./target.js";

const collectionArg = z
  .string()
  .describe('Collection slug, or "globals/<slug>" for a global (e.g. "globals/footer").');

const localeArg = z
  .string()
  .optional()
  .describe("Default: the default locale. Localized fields change only in it.");

const writeAnnotations = {
  readOnlyHint: false,
  destructiveHint: false,
  idempotentHint: false,
  openWorldHint: false,
};

const createParameters = {
  collection: z.string().describe("Collection slug."),
  data: jsonObject.describe(
    "Field values. Read the entity schema first; leave out virtual (read-only) fields. Rich text: a list of nodes, as find shows them or as updateRichText shorthand.",
  ),
  locale: localeArg,
  draft: z
    .boolean()
    .optional()
    .describe(
      "Default true: an unpublished draft, required fields not enforced. false publishes — only if the user asked.",
    ),
};

const updateParameters = {
  collection: collectionArg,
  id: z.union([z.string(), z.number()]).optional().describe("The document to update."),
  where: jsonObject
    .optional()
    .describe("Instead of id: update every document this Payload query matches."),
  data: jsonObject.describe(
    "Only the fields to change. For an array or blocks field, send every row you keep, with its id (an id alone keeps the row as stored); a row without one is new. Rich text: a list of nodes, as for create.",
  ),
  locale: localeArg,
  draft: z
    .boolean()
    .optional()
    .describe(
      "Default true: save to the draft. false publishes the latest draft with these changes — only if the user asked.",
    ),
  overwriteDraft: z
    .boolean()
    .optional()
    .describe("With where and draft:false, discard newer draft changes instead of refusing."),
  replaceRows: z
    .boolean()
    .optional()
    .describe(
      "Delete the stored rows data leaves out, or replace shared rows and their translations. Only after a write was refused for it.",
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

/** A non-empty list of strings somewhere in a value: what an outline looks like. */
function holdsStringList(value: unknown): boolean {
  if (Array.isArray(value)) {
    return (
      (value.length > 0 && value.every((item) => typeof item === "string")) ||
      value.some(holdsStringList)
    );
  }
  if (typeof value === "object" && value !== null) {
    return Object.values(value).some(holdsStringList);
  }
  return false;
}

/**
 * `data` with rich text sent back as find showed it — an outline — swapped for
 * the stored rich text. Only an unchanged outline is restored; an edited one is
 * refused, as is one where nothing is stored to restore it from.
 */
function withOutlinesRestored(
  data: Record<string, unknown>,
  stored: Record<string, unknown> | undefined,
): Record<string, unknown> {
  if (!holdsStringList(data)) return data;
  return restoreOutlines(data, stored, "") as Record<string, unknown>;
}

/** The stored fields `data` writes to, from the latest draft, without locale fallback. */
async function readStored(
  req: PayloadRequest,
  target: Target,
  id: Id | undefined,
  locale: string | undefined,
  data: Record<string, unknown>,
): Promise<Record<string, unknown> | undefined> {
  const read = {
    depth: 0,
    draft: true,
    locale,
    fallbackLocale: false,
    select: Object.fromEntries(Object.keys(data).map((key) => [key, true])) as SelectType,
    overrideAccess: false,
    req,
  } as const;
  if (target.kind === "global") return req.payload.findGlobal({ slug: target.slug, ...read });
  if (id === undefined) return undefined;
  const doc = await req.payload.findByID({
    collection: target.slug,
    id,
    disableErrors: true,
    ...read,
  });
  return doc ?? undefined;
}

/**
 * Why `data` may not be written as sent: it leaves out stored rows, which
 * Payload would delete, or (in a bulk update) replaces every document's rows.
 */
function rowsRefusal(
  req: PayloadRequest,
  config: EntityConfig,
  data: Record<string, unknown>,
  stored: Record<string, unknown> | undefined,
  bulk: boolean,
): string | undefined {
  const blocks = req.payload.config.blocks ?? [];
  if (bulk) {
    const fields = findRowFields(config.fields, data, blocks);
    if (fields.length === 0) return undefined;
    return `Refused: a bulk update replaces the rows of ${fields.join(", ")} in every matched document. Update each document by id, sending every row you keep with its id, or pass replaceRows: true to replace them.`;
  }
  const leftOut = findLeftOutRows(config.fields, data, stored, blocks);
  if (leftOut.length === 0) return undefined;
  const list = leftOut.map((rows) => `${rows.path} (${rows.ids.join(", ")})`).join("; ");
  return `Refused: this would delete the stored rows it leaves out: ${list}. An array or blocks field takes its complete list of rows: send every row you keep, with its id. To delete these rows, pass replaceRows: true.`;
}

/**
 * Turn the rich text in `data` into Lexical, in place, and say what it adds
 * that a draft write wouldn't catch: a block its field doesn't allow, or a
 * link to a document that doesn't exist.
 */
async function prepareRichText(
  req: PayloadRequest,
  target: Target,
  config: EntityConfig,
  data: Record<string, unknown>,
  stored: Record<string, unknown> | undefined,
): Promise<string | undefined> {
  const blocks = req.payload.config.blocks ?? [];
  const fields = hydrateRichText(config.fields, data, blocks, objectsIn(stored));
  for (const field of fields) {
    const problem = await findAddedProblem(stored?.[field], data[field], target, field, req);
    if (problem) return problem;
  }
  return undefined;
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
        const { target, config } = await openTarget(req, options, parsed.collection);
        if (target.kind === "global") {
          return errorResult("A global always exists; update it instead of creating it.");
        }
        const draft = parsed.draft ?? true;
        const drafts = hasDrafts(config);
        const locale = await writeLocale(options, req, {
          collection: parsed.collection,
          locale: parsed.locale,
        });
        const data = withOutlinesRestored(requireData(parsed.data), undefined);
        const problem = await prepareRichText(req, target, config, data, undefined);
        if (problem) return errorResult(problem);
        // `draft: false` alone never publishes; `_status` has to say so.
        if (drafts) data._status = draft ? "draft" : "published";

        const doc = await req.payload.create({
          collection: target.slug,
          data,
          draft,
          locale,
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
      "Change fields of a document by id, of every document where matches, or of a global. Only the fields in data change; an array or blocks field takes its full list of rows. Saves to the draft unless draft:false.",
    annotations: { title: "Update content", ...writeAnnotations },
    parameters: updateParameters,
    handler: async (args, req) => {
      try {
        const parsed = updateSchema.parse(args);
        const { collection, id } = parsed;
        const { target, config } = await openTarget(req, options, collection, id);
        const where = toObject(parsed.where, "where") as Where | undefined;
        if (target.kind === "collection" && (id === undefined) === (where === undefined)) {
          return errorResult("Pass either id or where.");
        }

        const draft = parsed.draft ?? true;
        const drafts = hasDrafts(config);
        const locale = await writeLocale(options, req, { collection, id, locale: parsed.locale });
        const sent = requireData(parsed.data);
        const bulk = target.kind === "collection" && id === undefined;
        const blocks = req.payload.config.blocks ?? [];
        const stored =
          !bulk &&
          (holdsStringList(sent) ||
            findRowFields(config.fields, sent, blocks).length > 0 ||
            richTextFieldsIn(config.fields, sent, blocks).length > 0)
            ? await readStored(req, target, id, locale, sent)
            : undefined;
        const refusal = parsed.replaceRows
          ? undefined
          : rowsRefusal(req, config, sent, stored, bulk);
        if (refusal) return errorResult(refusal);
        const data = withOutlinesRestored(sent, stored);
        const problem = await prepareRichText(req, target, config, data, stored);
        if (problem) return errorResult(problem);
        if (drafts) data._status = draft ? "draft" : "published";
        const status = drafts ? { status: data._status } : {};
        const write = {
          data,
          draft,
          locale,
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
        if (isSharedRowRefusal(err)) {
          return errorResult(
            `${err.message} To replace the rows and drop those translations on purpose, pass replaceRows: true.`,
          );
        }
        return errorResult(errorMessage(err));
      }
    },
  };
}
