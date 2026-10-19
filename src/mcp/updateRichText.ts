import type { PayloadRequest, SelectType } from "payload";
import { z } from "zod/v3";
import { editAtPath, LexicalError, linkRichText } from "../lexical/index.js";
import { getBlockSchema, getEntitySchema, type FieldSchema } from "../plugin/index.js";
import { pickLocale, toObject, type McpContentToolsOptions } from "./options.js";
import { errorResult, jsonResult, type McpTool } from "./result.js";
import { errorMessage, hasDrafts, openTarget, type Target } from "./target.js";

const parameters = {
  collection: z
    .string()
    .describe('Collection slug, or "globals/<slug>" for a global (e.g. "globals/footer").'),
  id: z.union([z.string(), z.number()]).optional().describe("Document ID. Omit for globals."),
  path: z
    .string()
    .describe(
      'Dot path as find\'s outlines show it: "content.3" (a node), "content.3.children.1.fields.doc" (a link target), "content.4.fields.body.0" (a node of rich text inside a block), "sections.0.body.2" (a node in an array row). For link, the rich text to search, e.g. "content".',
    ),
  operation: z
    .enum(["set", "insert", "delete", "link"])
    .describe(
      "set: replace the value at path. insert: add a node before the index path ends in (index = node count appends). delete: remove the node at path. link: wrap the first unlinked match of text at or below path in an internal link to value.",
    ),
  value: z
    .unknown()
    .optional()
    .describe(
      'For set and insert: a node as find shows it, or shorthand: {"type":"p","text":"…"}, {"type":"h2","text":"…"}, {"type":"ul","items":["…"]}, {"type":"block","fields":{"blockType":"…"}}, {"type":"upload","value":"<id>","relationTo":"media"} (relationTo defaults to media). For a value inside a node, the new value. For link: {"relationTo":"pages","value":"<id>"}, optionally "newTab":true.',
    ),
  text: z.string().optional().describe("For link: the text to wrap, as it appears."),
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
 * null. Follows the path along the schema — through groups, array and blocks
 * rows, and the fields of blocks inside rich text — so rich text at any depth
 * can be started.
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
    value = value[field.name];
    if (field.type === "array" || field.type === "blocks") {
      const row = Array.isArray(value) ? value[Number(segments[++i])] : undefined;
      value = row;
      schema =
        field.type === "array"
          ? field.fields
          : field.blocks?.find((block) => isRecord(row) && block.slug === row.blockType)?.fields;
    } else {
      schema = field.fields;
    }
  }
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isBlockNode(value: unknown): value is { type: string; fields: Record<string, unknown> } {
  return (
    isRecord(value) &&
    (value.type === "block" || value.type === "inlineBlock") &&
    isRecord(value.fields)
  );
}

/** A block as it was: its id and its type, since an edit can keep one and change the other. */
function blockKey(node: { type: string; fields: Record<string, unknown> }): string | undefined {
  const { id, blockType } = node.fields;
  return typeof id === "string" ? `${node.type}:${id}:${String(blockType)}` : undefined;
}

/** Every block in a value, nested rich text included. */
function blockKeysIn(value: unknown, found = new Set<string>()): Set<string> {
  if (Array.isArray(value)) {
    for (const item of value) blockKeysIn(item, found);
  } else if (isRecord(value)) {
    const key = isBlockNode(value) ? blockKey(value) : undefined;
    if (key) found.add(key);
    for (const item of Object.values(value)) blockKeysIn(item, found);
  }
  return found;
}

function hasRoot(value: unknown): value is { root: { children: unknown[] } } {
  return isRecord(value) && isRecord(value.root) && Array.isArray(value.root.children);
}

/**
 * The first block the edit added where the rich text holding it doesn't allow
 * it. Walks the written value along the field's schema, through blocks into the
 * rich text inside them, since each rich-text field has its own block list.
 * Blocks that were there before the edit are left alone.
 */
async function findDisallowedBlock(
  value: unknown,
  field: FieldSchema,
  existing: Set<string>,
  req: PayloadRequest,
): Promise<string | undefined> {
  const blockFields = new Map<string, FieldSchema[] | undefined>();
  const fieldsOfBlock = async (slug: string) => {
    if (!blockFields.has(slug)) {
      const schema = await getBlockSchema({ req, slugs: [slug], blocks: "inline" }).catch(
        () => undefined,
      );
      blockFields.set(slug, schema?.[0]?.fields);
    }
    return blockFields.get(slug);
  };

  const inNodes = async (
    nodes: unknown[],
    field: FieldSchema,
    path: string,
  ): Promise<string | undefined> => {
    for (const node of nodes) {
      if (isBlockNode(node)) {
        const slug = String(node.fields.blockType);
        const kind = node.type === "block" ? "block" : "inlineBlock";
        const features = field.lexicalFeatures;
        const allowed =
          kind === "block"
            ? features?.blockNodes.block?.slugs
            : features?.inlineNodes?.inlineBlock?.slugs;
        const key = blockKey(node);
        const isNew = !(key && existing.has(key));
        const schema = await fieldsOfBlock(slug);
        if (isNew && features && !allowed?.includes(slug)) {
          return `${kind === "block" ? "Block" : "Inline block"} "${slug}" isn't allowed in ${path}. Allowed: ${allowed?.join(", ") || "none"}.`;
        }
        if (isNew && !schema) return `No block with slug "${slug}".`;
        const problem = schema && (await inFields(node.fields, schema, path));
        if (problem) return problem;
      }
      if (isRecord(node) && Array.isArray(node.children)) {
        const problem = await inNodes(node.children, field, path);
        if (problem) return problem;
      }
    }
    return undefined;
  };

  const inFields = async (
    data: unknown,
    fields: FieldSchema[],
    path: string,
  ): Promise<string | undefined> => {
    if (!isRecord(data)) return undefined;
    for (const field of fields) {
      const value = data[field.name];
      const here = path ? `${path}.${field.name}` : field.name;
      const rows = Array.isArray(value) ? value : [value];
      let problem: string | undefined;
      if (field.type === "richText" && hasRoot(value)) {
        problem = await inNodes(value.root.children, field, here);
      } else if (field.blocks) {
        for (const row of rows) {
          const block = field.blocks.find((b) => isRecord(row) && b.slug === row.blockType);
          problem ??= block && (await inFields(row, block.fields, here));
        }
      } else if (field.fields) {
        for (const row of rows) problem ??= await inFields(row, field.fields, here);
      }
      if (problem) return problem;
    }
    return undefined;
  };

  return inFields({ [field.name]: value }, [field], "");
}

/**
 * What the edit added that Payload won't catch on a draft write: a block the
 * rich text holding it doesn't allow, or a reference to a document that
 * doesn't exist. Only additions are checked, so a field that already holds a
 * broken link can still be edited elsewhere.
 */
async function findAddedProblem(
  before: unknown,
  after: unknown,
  target: Target,
  fieldName: string,
  req: PayloadRequest,
): Promise<string | undefined> {
  const existing = blockKeysIn(before);
  if ([...blockKeysIn(after)].some((key) => !existing.has(key))) {
    const { fields } = await getEntitySchema({
      req,
      type: target.kind,
      slug: target.slug,
      blocks: "inline",
    });
    const field = fields.find((f) => f.name === fieldName);
    const problem = field && (await findDisallowedBlock(after, field, existing, req));
    if (problem) return problem;
  }

  const knownRefs = collectReferences(before);
  for (const [key, [relationTo, id]] of collectReferences(after)) {
    if (knownRefs.has(key)) continue;
    const collection = req.payload.collections[relationTo];
    if (!collection) {
      return `The value links to "${relationTo}", which is not a collection. Set relationTo to the collection's slug.`;
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
      "Edit rich text in place, by path, without rewriting the document: set, insert or delete a node at a path from find's outline, or link text to a document. Insert and delete shift the indexes after them. Edits the draft unless draft:false.",
    annotations: {
      title: "Edit rich text",
      readOnlyHint: false,
      destructiveHint: false,
      idempotentHint: false,
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
          result = { linked: linked.path };
          changed = linked.doc;
        } else {
          ({ result, doc: changed } = editAtPath(doc, path, operation, parsed.value));
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
          return errorResult(`${err.message}${hint}`);
        }
        return errorResult(errorMessage(err));
      }
    },
  };
}
