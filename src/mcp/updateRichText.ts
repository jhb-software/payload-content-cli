import type { PayloadRequest, SelectType } from "payload";
import { z } from "zod/v3";
import { editAtPath, LexicalError } from "../lexical/index.js";
import { getBlockSchema } from "../plugin/index.js";
import { errorResult, jsonResult, type McpTool } from "./result.js";

export interface UpdateRichTextOptions {
  /**
   * Pick the locale to read and write. Receives the `locale` the agent passed,
   * if any. Use it when the right default isn't Payload's default locale, e.g.
   * a multi-tenant site whose tenants each have their own primary locale.
   */
  resolveLocale?: (
    req: PayloadRequest,
    target: { collection: string; id?: string | number; locale?: string },
  ) => string | undefined | Promise<string | undefined>;
  /** Refuse an id before it is looked up, by returning the message to show the agent. */
  checkId?: (collection: string, id: string | number) => string | undefined;
}

const GLOBAL_PREFIX = "globals/";

const parameters = {
  collection: z
    .string()
    .describe('Collection slug, or "globals/<slug>" for a global (e.g. "globals/footer").'),
  id: z.union([z.string(), z.number()]).optional().describe("Document ID. Omit for globals."),
  path: z
    .string()
    .describe(
      'Dot path from a rich-text field, as read shows it: "content" (the field), "content.3" (a node), "content.3.children.1.fields.doc" (a link target), "content.4.fields.body.0" (a node of rich text inside a block), "sections.0.body.2" (a node in an array row).',
    ),
  operation: z
    .enum(["read", "set", "insert", "delete"])
    .describe(
      "read: a field outlines one line per node, a node shows its JSON. set: replace the value at path. insert: add a node before the index path ends in (index = node count appends). delete: remove the node at path.",
    ),
  value: z
    .unknown()
    .optional()
    .describe(
      'For set and insert. A node as read, or shorthand: {"type":"p","text":"…"}, {"type":"h2","text":"…"}, {"type":"ul","items":["…"]}, {"type":"block","fields":{"blockType":"…"}}, {"type":"upload","value":"<media id>"}. For a value inside a node, the new value.',
    ),
  locale: z
    .string()
    .optional()
    .describe("Locale to read and write. Defaults to the default locale."),
  draft: z
    .boolean()
    .optional()
    .describe(
      "Default true: read and write the draft. false writes and publishes the live version — only if the user asked.",
    ),
  overwriteDraft: z
    .boolean()
    .optional()
    .describe("With draft:false, discard newer unpublished draft changes instead of refusing."),
};

const argsSchema = z.object(parameters);

type Target = { kind: "collection" | "global"; slug: string };

function hasDrafts(config: { versions?: unknown }): boolean {
  const versions = config.versions as { drafts?: unknown } | undefined;
  return Boolean(versions?.drafts);
}

function toTime(value: unknown): number | undefined {
  if (typeof value !== "string" && !(value instanceof Date)) return undefined;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : time;
}

/** `{relationTo, value}` pairs anywhere in a value: link targets, upload nodes, polymorphic relationships. */
function collectReferences(value: unknown, found = new Map<string, [string, unknown]>()) {
  if (Array.isArray(value)) {
    for (const item of value) collectReferences(item, found);
  } else if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    const { relationTo, value: id } = record;
    if (typeof relationTo === "string" && (typeof id === "string" || typeof id === "number")) {
      found.set(`${relationTo}:${id}`, [relationTo, id]);
    }
    for (const item of Object.values(record)) collectReferences(item, found);
  }
  return found;
}

/** Every `blockType` slug in a value. */
function collectBlockSlugs(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) collectBlockSlugs(item, found);
  } else if (typeof value === "object" && value !== null) {
    const record = value as Record<string, unknown>;
    if (typeof record.blockType === "string") found.add(record.blockType);
    for (const item of Object.values(record)) collectBlockSlugs(item, found);
  }
  return found;
}

/**
 * What the edit added that Payload won't catch on a draft write: a block slug
 * no config defines, or a reference to a document that doesn't exist.
 * Only additions are checked, so a field that already holds a broken link can
 * still be edited elsewhere.
 */
async function findAddedProblem(
  before: unknown,
  after: unknown,
  req: PayloadRequest,
): Promise<string | undefined> {
  const knownSlugs = collectBlockSlugs(before);
  const newSlugs = [...collectBlockSlugs(after)].filter((slug) => !knownSlugs.has(slug));
  if (newSlugs.length > 0) {
    try {
      await getBlockSchema({ req, slugs: newSlugs });
    } catch (err) {
      return err instanceof Error ? err.message : String(err);
    }
  }

  const knownRefs = collectReferences(before);
  for (const [key, [relationTo, id]] of collectReferences(after)) {
    if (knownRefs.has(key)) continue;
    const collection = req.payload.collections[relationTo];
    if (!collection) {
      return `The value links to "${relationTo}", which is not a collection.`;
    }
    const found = await req.payload.findByID({
      collection: relationTo,
      id: id as string | number,
      depth: 0,
      draft: hasDrafts(collection.config),
      select: {},
      disableErrors: true,
      overrideAccess: false,
      req,
    });
    if (!found) return `The value links to ${relationTo} "${id}", which doesn't exist.`;
  }
  return undefined;
}

/**
 * The `updateRichText` MCP tool: read and edit rich text in place, addressed by
 * one dot path, without rewriting the document. Register it with
 * `@payloadcms/plugin-mcp`'s `mcp.tools`.
 *
 * Reads are compact — a field outlines one line per node, a node shows its JSON
 * without Lexical's defaults — so an agent reads only what it is about to
 * change. Writes go to the draft unless `draft: false`, which publishes and is
 * refused when it would discard newer draft changes. Block slugs and link
 * targets the edit adds are checked first, since draft writes skip Payload's
 * validation.
 */
export function updateRichTextTool(options: UpdateRichTextOptions = {}): McpTool {
  return {
    name: "updateRichText",
    description:
      'Read or edit rich text in place, by path, without rewriting the document. Start with read on the field (path "content") for one outline line per node, read a node ("content.3") to see its JSON, then set, insert or delete at a path from the read. Insert and delete shift the indexes after them. Edits the draft unless draft:false.',
    parameters,
    handler: async (args, req) => {
      let draft = true;
      try {
        const parsed = argsSchema.parse(args);
        const { collection, id, path, operation, value, overwriteDraft } = parsed;
        draft = parsed.draft ?? true;

        const target: Target = collection.startsWith(GLOBAL_PREFIX)
          ? { kind: "global", slug: collection.slice(GLOBAL_PREFIX.length) }
          : { kind: "collection", slug: collection };
        const config =
          target.kind === "global"
            ? req.payload.globals.config.find((global) => global.slug === target.slug)
            : req.payload.collections[target.slug]?.config;
        if (!config) return errorResult(`No ${target.kind} "${target.slug}".`);
        if (target.kind === "collection" && id === undefined) {
          return errorResult("id is required for a collection.");
        }
        if (id !== undefined && options.checkId) {
          const refusal = options.checkId(collection, id);
          if (refusal) return errorResult(refusal);
        }

        // Read and write the same locale: a node read through a fallback and
        // written back would store one language's text as another's.
        const locale = options.resolveLocale
          ? await options.resolveLocale(req, { collection, id, locale: parsed.locale })
          : parsed.locale;
        if (locale === "all")
          return errorResult('Pick one locale; "all" can\'t be edited by path.');

        const field = path.split(".")[0];
        const guardDraft = !draft && operation !== "read" && hasDrafts(config);
        const select: SelectType = guardDraft
          ? { [field]: true, updatedAt: true }
          : { [field]: true };
        const common = { depth: 0, draft, locale, select, overrideAccess: false, req } as const;
        const found =
          target.kind === "global"
            ? await req.payload.findGlobal({ slug: target.slug, ...common })
            : await req.payload.findByID({
                collection: target.slug,
                id: id!,
                disableErrors: true,
                ...common,
              });
        if (!found) return errorResult(`No ${target.slug} document with id "${id}".`);
        const doc = { [field]: (found as Record<string, unknown>)[field] };

        const { result, doc: changed } = editAtPath(doc, path, operation, value);
        if (!changed) return jsonResult(result);

        // A publishing write starts from the published version, so it would
        // revert any newer draft. A draft version newer than it is exactly that.
        if (guardDraft && !overwriteDraft) {
          const latest =
            target.kind === "global"
              ? await req.payload.findGlobal({ ...common, slug: target.slug, draft: true })
              : await req.payload.findByID({
                  ...common,
                  collection: target.slug,
                  id: id!,
                  draft: true,
                  disableErrors: true,
                });
          const publishedAt = toTime((found as Record<string, unknown>).updatedAt);
          const draftAt = toTime((latest as Record<string, unknown> | null)?.updatedAt);
          if (publishedAt !== undefined && draftAt !== undefined && draftAt > publishedAt) {
            return errorResult(
              "Refused: this document has unpublished draft changes, which draft:false would discard. Omit draft to edit the draft, or pass overwriteDraft:true to discard them.",
            );
          }
        }

        const problem = await findAddedProblem(doc[field], changed[field], req);
        if (problem) return errorResult(problem);

        // `_status` is explicit both ways: `draft: false` alone never publishes.
        const data = { [field]: changed[field], _status: draft ? "draft" : "published" };
        const write = { data, depth: 0, draft, locale, overrideAccess: false, req } as const;
        if (target.kind === "global") {
          await req.payload.updateGlobal({ slug: target.slug, select: {}, ...write });
        } else {
          await req.payload.update({ collection: target.slug, id: id!, select: {}, ...write });
        }
        return jsonResult(result);
      } catch (err) {
        if (err instanceof LexicalError) {
          // Against the published version, a field only the draft has looks missing.
          const hint =
            !draft && err.code === "PATH_NOT_FOUND"
              ? " This read the published version; if the content exists only in the draft, omit draft:false."
              : "";
          return errorResult(`${err.message} (${err.code})${hint}`);
        }
        return errorResult(err instanceof Error ? err.message : String(err));
      }
    },
  };
}
