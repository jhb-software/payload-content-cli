import type { PayloadRequest } from "payload";
import { getBlockSchema, getEntitySchema, type FieldSchema } from "../plugin/index.js";
import { hasDrafts, type Target } from "./target.js";

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

export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isBlockNode(
  value: unknown,
): value is { type: string; fields: Record<string, unknown> } {
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
export async function findAddedProblem(
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
