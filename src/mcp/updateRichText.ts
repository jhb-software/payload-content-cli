import type { PayloadRequest, SelectType } from "payload";
import { z } from "zod/v3";
import { editAtPath, LexicalError, linkRichText } from "../lexical/index.js";
import { getBlockSchema, getEntitySchema, type FieldSchema } from "../plugin/index.js";
import { pickLocale, toObject, type McpContentToolsOptions } from "./options.js";
import { errorResult, jsonResult, type McpTool } from "./result.js";
import { explainMissingPath } from "./missingPath.js";
import { findAddedProblem, isBlockNode, isRecord } from "./richTextChecks.js";
import { errorMessage, hasDrafts, openTarget } from "./target.js";

const parameters = {
  collection: z
    .string()
    .describe('Collection slug, or "globals/<slug>" for a global (e.g. "globals/footer").'),
  id: z.union([z.string(), z.number()]).optional().describe("Document ID. Omit for globals."),
  path: z
    .string()
    .describe(
      'Dot path from find\'s outline: "content.3" (a node), "content.3.children.1.fields.doc" (a link target), "content.4.fields.body.0" (rich text in a block), "sections.0.body.2" (rich text in an array row), "content.3.children.2" (inline). For link: the rich text or node to search, e.g. "content".',
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

const argsSchema = z.object(parameters);

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
 * The `updateRichText` MCP tool: edit rich text in place, addressed by one dot
 * path from `find`'s outlines, without rewriting the document.
 *
 * Writes go to the draft unless `draft: false`, which publishes and is refused
 * when it would discard newer draft changes. Block slugs and link targets the
 * edit adds are checked first, since draft writes skip Payload's validation.
 */
export function updateRichTextTool(options: McpContentToolsOptions = {}): McpTool {
  return {
    name: "updateRichText",
    description:
      "Edit rich text in place by path: set, insert or delete a node from find's outline, or link text to a document. Insert and delete shift later indexes. Edits the draft unless draft:false.",
    annotations: {
      title: "Edit rich text",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
      openWorldHint: false,
    },
    parameters,
    handler: async (args, req) => {
      let draft = true;
      try {
        const parsed = argsSchema.parse(args);
        const { collection, id, path, operation, overwriteDraft } = parsed;
        draft = parsed.draft ?? true;

        const { target, config } = await openTarget(req, options, collection, id);
        if (target.kind === "collection" && id === undefined) {
          return errorResult("id is required for a collection.");
        }

        // Read and write the same locale: a node read through a fallback and
        // written back would store one language's text as another's.
        const locale = await pickLocale(options, req, { collection, id, locale: parsed.locale });
        if (locale === "all")
          return errorResult('Pick one locale; "all" can\'t be edited by path.');

        const segments = path.split(".");
        const field = segments[0];
        const guardDraft = !draft && hasDrafts(config);
        const select: SelectType = guardDraft
          ? { [field]: true, updatedAt: true }
          : { [field]: true };
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
        const stored = (found as Record<string, unknown>)[field];
        const doc: Record<string, unknown> = { [field]: structuredClone(stored) };
        const { fields } = await getEntitySchema({
          req,
          type: target.kind,
          slug: target.slug,
          blocks: "inline",
        });
        await startEmptyRichText(doc, segments, fields, req);

        let result: Record<string, unknown>;
        let changed: Record<string, unknown>;
        try {
          if (operation === "link") {
            if (!parsed.text) return errorResult("link needs text: the words to wrap.");
            const linkTarget = toObject(parsed.value as never, "value");
            const relationTo = linkTarget?.relationTo;
            const value = linkTarget?.value;
            if (
              typeof relationTo !== "string" ||
              (typeof value !== "string" && typeof value !== "number")
            ) {
              return errorResult('link needs value: {"relationTo":"<collection>","value":"<id>"}.');
            }
            const linked = linkRichText(doc, path, parsed.text, {
              relationTo,
              value,
              ...(linkTarget?.newTab === true ? { newTab: true } : {}),
            });
            result = { linked: linked.path, outline: linked.outline };
            changed = linked.doc;
          } else {
            ({ result, doc: changed } = editAtPath(doc, path, operation, parsed.value));
          }
        } catch (err) {
          // The stored keys alone make a field this locale has no value for read like a typo.
          const missing =
            err instanceof LexicalError && err.code === "PATH_NOT_FOUND"
              ? explainMissingPath(doc, path, fields)
              : undefined;
          // Not a LexicalError: a name the schema lacks isn't in the draft either.
          throw missing && !missing.empty ? new Error(missing.message) : err;
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
          const publishedAt = toTime((found as Record<string, unknown>).updatedAt);
          const draftAt = toTime((latest as Record<string, unknown> | null)?.updatedAt);
          if (publishedAt !== undefined && draftAt !== undefined && draftAt > publishedAt) {
            return errorResult(
              "Refused: this document has unpublished draft changes, which draft:false would discard. Omit draft to edit the draft, or pass overwriteDraft:true to discard them.",
            );
          }
        }

        const problem = await findAddedProblem(doc[field], changed[field], target, field, req);
        if (problem) return errorResult(problem);

        // `_status` is explicit both ways: `draft: false` alone never publishes.
        const data = hasDrafts(config)
          ? { [field]: changed[field], _status: draft ? "draft" : "published" }
          : { [field]: changed[field] };
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
        return jsonResult(result);
      } catch (err) {
        if (err instanceof LexicalError) {
          // Against the published version, a field only the draft has looks missing.
          const hint =
            !draft && err.code === "PATH_NOT_FOUND"
              ? " This read the published version; if the content exists only in the draft, omit draft:false."
              : "";
          return errorResult(`${err.message}${hint}`);
        }
        return errorResult(errorMessage(err));
      }
    },
  };
}
