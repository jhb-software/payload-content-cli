import type { PayloadRequest, SelectType } from "payload";
import { z } from "zod/v3";
import { orderEdits } from "../lexical/batch.js";
import { editAtPath, LexicalError, linkRichText } from "../lexical/index.js";
import { getBlockSchema, getEntitySchema, type FieldSchema } from "../plugin/index.js";
import { parseJsonArg, pickLocale, toObject, type McpContentToolsOptions } from "./options.js";
import { errorResult, jsonResult, type McpTool } from "./result.js";
import { explainMissingPath } from "./missingPath.js";
import { findAddedProblem, isBlockNode, isRecord } from "./richTextChecks.js";
import { errorMessage, hasDrafts, openTarget } from "./target.js";

const editSchema = z.object({
  path: z
    .string()
    .min(1)
    .describe(
      'Dot path from find\'s outline: "content.3" (a node), "content.3.children.1.fields.doc" (a link target), "content.4.fields.body.0" (rich text in a block), "sections.0.body.2" (rich text in an array row), "content.3.children.2" (inline). For link: where to search, e.g. "content.3".',
    ),
  operation: z
    .enum(["set", "insert", "delete", "link"])
    .describe(
      "set: replace the value at path; to change words, set a text node's text (content.3.children.0.text). insert: add a node before the index path ends in (the node count appends), e.g. a text node into a paragraph's children. delete: remove the node. link: wrap the first unlinked match of text in a link to value.",
    ),
  value: z
    .unknown()
    .optional()
    .describe(
      'For set and insert: a node as find shows it (insert also takes a list of nodes), or shorthand: {"type":"p","text":"…"}, {"type":"h2","text":"…"}, {"type":"ul","items":["…"]}, {"type":"text","text":"…"}, {"type":"block","fields":{"blockType":"…"}}, {"type":"upload","value":"<id>"} (relationTo defaults to media). A link to a URL, in a paragraph\'s children: {"type":"link","fields":{"linkType":"custom","url":"…"},"children":[{"type":"text","text":"…"}]}. Text is stored as given: the [ ], ** and * in outlines only mark links and formatting. For link: {"relationTo":"pages","value":"<id>"}, optionally "newTab":true. For a value inside a node, the new value.',
    ),
  text: z.string().optional().describe("For link: the text to wrap, as it appears."),
});

const parameters = {
  collection: z
    .string()
    .describe('Collection slug, or "globals/<slug>" for a global (e.g. "globals/footer").'),
  id: z.union([z.string(), z.number()]).optional().describe("Document ID. Omit for globals."),
  edits: z
    .union([z.array(editSchema), z.string()])
    .optional()
    .describe(
      "All edits to this document, saved together. Every path is as find showed it: don't adjust indexes for other edits in the list. Edits to a node and to something inside it are refused, as are two inserts at one index (send one with a list of nodes), two links at one text node (use the node holding it) and a link whose search covers another edit.",
    ),
  // One edit, as the tool took it before `edits`: clients that cached the old
  // schema keep sending it, and the SDK drops arguments the schema doesn't name.
  path: z.string().optional().describe("Deprecated: one edit's path. Use edits."),
  operation: z
    .enum(["set", "insert", "delete", "link"])
    .optional()
    .describe("Deprecated: one edit's operation. Use edits."),
  value: z.unknown().optional().describe("Deprecated: one edit's value. Use edits."),
  text: z.string().optional().describe("Deprecated: one edit's text. Use edits."),
  locale: z.string().optional().describe("Default: the default locale."),
  draft: z
    .boolean()
    .optional()
    .describe("Default true: edit the draft. false publishes — only if the user asked."),
  overwriteDraft: z
    .boolean()
    .optional()
    .describe("With draft:false, discard newer unpublished draft changes instead of refusing."),
};

const argsSchema = z
  .object(parameters)
  .omit({ edits: true, path: true, operation: true, value: true, text: true });

type Edit = z.infer<typeof editSchema>;

/**
 * The list of edits, or the one edit of a caller using the deprecated
 * `path`/`operation`/`value`/`text` (`single`). Some MCP clients send a list
 * as a JSON string.
 */
function toEdits(args: Record<string, unknown>): { edits: Edit[]; single: boolean } {
  const { edits, path, operation, value, text } = args;
  if (edits !== undefined && path !== undefined) {
    throw new Error("Pass either edits or path, not both: put every edit in edits.");
  }
  if (edits === undefined && path !== undefined) {
    const parsed = editSchema.safeParse({ path, operation, value, text });
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      throw new Error(`${issue.path.join(".")}: ${issue.message}.`);
    }
    return { edits: [parsed.data], single: true };
  }
  if (edits === undefined) {
    throw new Error(
      'edits is required: a list of {"path","operation","value","text"}, all edits to this document.',
    );
  }
  const list = typeof edits === "string" ? parseJsonArg(edits, "edits") : edits;
  const parsed = z.array(editSchema).min(1, "needs at least one edit").safeParse(list);
  if (!parsed.success) {
    const { path: at, message } = parsed.error.issues[0];
    throw new Error(`edits${at.map((p) => `.${p}`).join("")}: ${message}.`);
  }
  return { edits: parsed.data, single: false };
}

const EMPTY_ROOT = {
  root: { type: "root", direction: null, format: "", indent: 0, version: 1, children: [] },
};

/** Where a path enters a block node's fields inside rich text: `….<index>.fields`. */
async function blockFieldsAt(
  node: unknown,
  req: PayloadRequest,
): Promise<FieldSchema[] | undefined> {
  if (!isBlockNode(node)) return undefined;
  const schema = await getBlockSchema({
    req,
    slugs: [String(node.fields.blockType)],
    blocks: "inline",
  }).catch(() => undefined);
  return schema?.[0]?.fields;
}

/**
 * Start the rich text a path leads into when nobody has written it yet (in
 * this locale): Payload stores it as null, and the path can't continue through
 * null. Follows the path along the schema — through groups, named tabs
 * (started too when missing), array and blocks rows, and the fields of blocks
 * inside rich text — so rich text at any depth can be started.
 */
async function startEmptyRichText(
  doc: Record<string, unknown>,
  segments: string[],
  fields: FieldSchema[],
  req: PayloadRequest,
): Promise<void> {
  let value: unknown = doc;
  let schema: FieldSchema[] | undefined = fields;
  for (let i = 0; i < segments.length && schema; i++) {
    if (!isRecord(value)) return;
    const field: FieldSchema | undefined = schema.find((f) => f.name === segments[i]);
    if (!field) return;
    if (field.type === "richText") {
      if (value[field.name] == null) {
        value[field.name] = structuredClone(EMPTY_ROOT);
        return;
      }
      // Follow the node JSON to the next block's fields, then carry on by its schema.
      value = (value[field.name] as { root?: { children?: unknown } }).root?.children;
      schema = undefined;
      for (i++; i < segments.length && value !== undefined; i++) {
        if (segments[i] === "fields" && isBlockNode(value)) {
          schema = await blockFieldsAt(value, req);
          value = value.fields;
          break;
        }
        value = (value as Record<string, unknown> | undefined)?.[segments[i]];
      }
      continue;
    }
    const record = value;
    value = record[field.name];
    if (field.type === "array" || field.type === "blocks") {
      const row = Array.isArray(value) ? value[Number(segments[++i])] : undefined;
      value = row;
      schema =
        field.type === "array"
          ? field.fields
          : field.blocks?.find((block) => isRecord(row) && block.slug === row.blockType)?.fields;
    } else {
      // Payload reads a localized named tab without a value in this locale back
      // as undefined, and the groups inside it too: start them, so the rich
      // text inside can be started.
      if (value == null && (field.type === "tab" || field.type === "group")) {
        value = record[field.name] = {};
      }
      schema = field.fields;
    }
  }
}

function toTime(value: unknown): number | undefined {
  if (typeof value !== "string" && !(value instanceof Date)) return undefined;
  const time = new Date(value).getTime();
  return Number.isNaN(time) ? undefined : time;
}

/**
 * One edit applied to a copy of the document. In a batch, its counts and notes
 * on moved nodes would describe a moment halfway through, so `result` drops
 * them for `shifted`; `single` keeps them, as the one-edit answer always had. A
 * link usually splits a text node, moving what follows it, so any link counts.
 */
function applyEdit(
  doc: Record<string, unknown>,
  edit: Edit,
): {
  doc: Record<string, unknown>;
  result: Record<string, unknown>;
  single: Record<string, unknown>;
  shifted: boolean;
} {
  if (edit.operation === "link") {
    if (!edit.text) throw new Error("link needs text: the words to wrap.");
    const linkTarget = toObject(edit.value as never, "value");
    const relationTo = linkTarget?.relationTo;
    const value = linkTarget?.value;
    if (
      typeof relationTo !== "string" ||
      (typeof value !== "string" && typeof value !== "number")
    ) {
      throw new Error('link needs value: {"relationTo":"<collection>","value":"<id>"}.');
    }
    const linked = linkRichText(doc, edit.path, edit.text, {
      relationTo,
      value,
      ...(linkTarget?.newTab === true ? { newTab: true } : {}),
    });
    const result = { linked: linked.path, outline: linked.outline };
    return { doc: linked.doc, result, single: result, shifted: true };
  }
  const applied = editAtPath(doc, edit.path, edit.operation, edit.value);
  const { count: _count, note, ...result } = applied.result;
  return { doc: applied.doc, result, single: applied.result, shifted: note !== undefined };
}

/** What to tell the agent about an edit that failed, from the document as read. */
function explainEditError(
  err: unknown,
  doc: Record<string, unknown>,
  path: string,
  fields: FieldSchema[],
  draft: boolean,
): string {
  if (!(err instanceof LexicalError)) return errorMessage(err);
  if (err.code !== "PATH_NOT_FOUND") return err.message;
  // The stored keys alone make a field this locale has no value for read like a typo.
  const missing = explainMissingPath(doc, path, fields);
  // Not a LexicalError: a name the schema lacks isn't in the draft either.
  if (missing && !missing.empty) return missing.message;
  // Against the published version, a field only the draft has looks missing.
  return draft
    ? err.message
    : `${err.message} This read the published version; if the content exists only in the draft, omit draft:false.`;
}

/**
 * The `updateRichText` MCP tool: edit rich text in place, addressed by the dot
 * paths from `find`'s outlines, without rewriting the document. All edits in a
 * call are saved at once, as one version, or not at all.
 *
 * Writes go to the draft unless `draft: false`, which publishes and is refused
 * when it would discard newer draft changes. Block slugs and link targets the
 * edits add are checked first, since draft writes skip Payload's validation.
 */
export function updateRichTextTool(options: McpContentToolsOptions = {}): McpTool {
  return {
    name: "updateRichText",
    description:
      "Edit rich text in place by path: set, insert or delete nodes from find's outline, or link text to a document. Send all edits to a document in one call: each call saves one new version in its history, and if any edit fails nothing is saved. Edits the draft unless draft:false. Answers with one result per edit; shifted:true means indexes may have moved, so call find before editing further.",
    annotations: {
      title: "Edit rich text",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    parameters,
    handler: async (args, req) => {
      try {
        const { edits, single } = toEdits(args as Record<string, unknown>);
        const parsed = argsSchema.parse(args);
        const { collection, id, overwriteDraft } = parsed;
        const draft = parsed.draft ?? true;

        const { target, config } = await openTarget(req, options, collection, id);
        if (target.kind === "collection" && id === undefined) {
          return errorResult("id is required for a collection.");
        }

        // Read and write the same locale: a node read through a fallback and
        // written back would store one language's text as another's.
        const locale = await pickLocale(options, req, { collection, id, locale: parsed.locale });
        if (locale === "all")
          return errorResult('Pick one locale; "all" can\'t be edited by path.');

        const touched = [...new Set(edits.map((edit) => edit.path.split(".")[0]))];
        const guardDraft = !draft && hasDrafts(config);
        const select: SelectType = Object.fromEntries(
          [...touched, ...(guardDraft ? ["updatedAt"] : [])].map((name) => [name, true]),
        );
        // No fallback: content shown from another locale would be written back as this one's.
        const common = {
          depth: 0,
          draft,
          locale,
          fallbackLocale: false,
          select,
          overrideAccess: false,
          req,
        } as const;
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
        const stored = found as Record<string, unknown>;
        const doc: Record<string, unknown> = Object.fromEntries(
          touched.map((name) => [name, structuredClone(stored[name])]),
        );
        const { fields } = await getEntitySchema({
          req,
          type: target.kind,
          slug: target.slug,
          blocks: "inline",
        });
        for (const edit of edits) {
          await startEmptyRichText(doc, edit.path.split("."), fields, req);
        }

        let order: number[];
        try {
          order = orderEdits(doc, edits);
        } catch (err) {
          return errorResult(`${errorMessage(err)} Nothing was saved.`);
        }
        const results: Record<string, unknown>[] = [];
        let singleResult: Record<string, unknown> | undefined;
        let changed = doc;
        let shifted = false;
        for (const index of order) {
          const edit = edits[index];
          try {
            const applied = applyEdit(changed, edit);
            changed = applied.doc;
            results[index] = applied.result;
            singleResult = applied.single;
            shifted ||= applied.shifted;
          } catch (err) {
            const message = explainEditError(err, doc, edit.path, fields, draft);
            if (single) return errorResult(message);
            return errorResult(
              `Edit ${index + 1} of ${edits.length} (${edit.path}): ${message} Nothing was saved.`,
            );
          }
        }

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
          const publishedAt = toTime(stored.updatedAt);
          const draftAt = toTime((latest as Record<string, unknown> | null)?.updatedAt);
          if (publishedAt !== undefined && draftAt !== undefined && draftAt > publishedAt) {
            return errorResult(
              "Refused: this document has unpublished draft changes, which draft:false would discard. Omit draft to edit the draft, or pass overwriteDraft:true to discard them.",
            );
          }
        }

        for (const name of touched) {
          const problem = await findAddedProblem(doc[name], changed[name], target, name, req);
          if (problem) return errorResult(`${problem} Nothing was saved.`);
        }

        // `_status` is explicit both ways: `draft: false` alone never publishes.
        const values = Object.fromEntries(touched.map((name) => [name, changed[name]]));
        const data = hasDrafts(config)
          ? { ...values, _status: draft ? "draft" : "published" }
          : values;
        // Payload reads a global's stored values with fallback, and would write
        // the fallback back into this locale's untranslated fields.
        const write = {
          data,
          depth: 0,
          draft,
          locale,
          fallbackLocale: false,
          overrideAccess: false,
          req,
        } as const;
        if (target.kind === "global") {
          await req.payload.updateGlobal({ slug: target.slug, select: {}, ...write });
        } else {
          await req.payload.update({ collection: target.slug, id: id!, select: {}, ...write });
        }
        if (single) return jsonResult(singleResult);
        return jsonResult({ results, ...(shifted ? { shifted: true } : {}) });
      } catch (err) {
        return errorResult(errorMessage(err));
      }
    },
  };
}
