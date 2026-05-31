/**
 * The reusable, non-HTTP schema API for the content-cli plugin.
 *
 * These functions resolve the same `{ slug, fields, jsonSchema }` shapes the
 * `/content-cli/schema` endpoint produces, without going through HTTP — the
 * building blocks for custom tools (e.g. a schema MCP server). They share the
 * endpoint's lenient, access-aware `canRead` rule.
 *
 * Uses type-only imports from `payload`, so the package never pulls Payload in
 * at runtime.
 */

import type {
  Block,
  Payload,
  PayloadRequest,
  SanitizedCollectionConfig,
  SanitizedGlobalConfig,
} from "payload";

import { toFieldSchemas } from "./fields.js";
import type { FieldSchema } from "./fields.js";
import { entityToJsonSchema } from "./jsonSchema.js";
import type { JsonSchema } from "./jsonSchema.js";

/** A collection or global config, the two access-controlled entity kinds. */
type EntityConfig = SanitizedCollectionConfig | SanitizedGlobalConfig;

// Mirrors Payload's read-access evaluation (see auth/getEntityPermissions.ts):
// a function returning true OR a Where clause counts as "has read access";
// falsy counts as "denied". With no `access.read` defined, Payload's default
// is `isLoggedIn`.
export async function canRead(entity: EntityConfig, req: PayloadRequest): Promise<boolean> {
  const readAccess = entity?.access?.read;
  if (typeof readAccess !== "function") return !!req.user;
  try {
    const result = await readAccess({ req });
    return !!result;
  } catch {
    return false;
  }
}

/** Build the slug → top-level block lookup used to resolve `blockReferences`. */
export function buildBlocksBySlug(payload: Payload): Record<string, Block> {
  const blocksBySlug: Record<string, Block> = {};
  for (const block of payload.config.blocks ?? []) {
    blocksBySlug[block.slug] = block;
  }
  return blocksBySlug;
}

/** Project Payload's localization config to its CLI/JSON shape, or null. */
export function buildLocalization(
  payload: Payload,
): { locales: string[]; defaultLocale: string } | null {
  const localization = payload.config.localization;
  if (!localization) return null;
  return {
    locales: localization.locales.map((locale) =>
      typeof locale === "string" ? locale : locale.code,
    ),
    defaultLocale: localization.defaultLocale,
  };
}

/** Assemble the per-entity schema shape from an already-resolved entity config. */
export function entityToSchema(
  entity: EntityConfig,
  blocksBySlug: Record<string, Block>,
): { slug: string; fields: FieldSchema[]; jsonSchema: JsonSchema } {
  const fields = toFieldSchemas(entity.fields, blocksBySlug);
  return { slug: entity.slug, fields, jsonSchema: entityToJsonSchema(entity.slug, fields) };
}

/**
 * Resolve a single collection's or global's schema for the given request.
 *
 * Building block for custom tools (e.g. a schema MCP tool) that need the exact
 * `{ slug, fields, jsonSchema }` the `/content-cli/schema` endpoint produces,
 * without going through HTTP. The same access check the endpoint applies runs
 * here: a denied `req.user` throws, mirroring (and reusing) `canRead`'s lenient
 * rule where an `access.read` Where-clause still counts as readable.
 *
 * Collections and globals are looked up in separate namespaces — pass `type` to
 * pick which (a slug may exist in both). Throws on an unknown slug or denied
 * access, with a distinct message per case.
 */
export async function getEntitySchema({
  req,
  type,
  slug,
}: {
  req: PayloadRequest;
  type: "collection" | "global";
  slug: string;
}): Promise<{ slug: string; fields: FieldSchema[]; jsonSchema: JsonSchema }> {
  const payload = req.payload;
  const list: EntityConfig[] =
    type === "collection" ? payload.config.collections : payload.config.globals;
  const entity = (list ?? []).find((candidate) => candidate.slug === slug);
  if (!entity) {
    throw new Error(`No ${type} with slug "${slug}"`);
  }
  if (!(await canRead(entity, req))) {
    throw new Error(`Access denied to ${type} "${slug}"`);
  }
  return entityToSchema(entity, buildBlocksBySlug(payload));
}

/**
 * Resolve the field schema of one or more top-level (richText-referenced) blocks
 * by slug.
 *
 * The third building block of the schema API, for a `getBlockSchema` MCP tool:
 * `getEntitySchema` surfaces a richText field's available block slugs (under
 * `lexicalFeatures.blockNodes.block.slugs`) without their fields; this resolves
 * those slugs to `{ slug, fields }`. Not needed for `blocks`-type fields — those
 * already carry their block schemas inline.
 *
 * Blocks are config fragments, not access-controlled entities, so there is no
 * read check (unlike `getEntitySchema`). Only slugs registered on
 * `config.blocks` resolve. Throws if any requested slug is unknown, naming all
 * the missing ones. An empty `slugs` list returns `[]`.
 *
 * Blocks must be defined globally on `config.blocks` — blocks declared inline in
 * a lexical editor config are not supported (Payload v4 drops inline blocks, and
 * defining blocks globally is more performant regardless). A globally-defined
 * block referenced from a richText field therefore always resolves here.
 */
export async function getBlockSchema({
  req,
  slugs,
}: {
  req: PayloadRequest;
  slugs: string[];
}): Promise<{ slug: string; fields: FieldSchema[] }[]> {
  const blocksBySlug = buildBlocksBySlug(req.payload);
  const unknown = slugs.filter((slug) => !(slug in blocksBySlug));
  if (unknown.length > 0) {
    const quoted = unknown.map((slug) => `"${slug}"`).join(", ");
    const named =
      unknown.length === 1 ? `No block with slug ${quoted}` : `No blocks with slugs ${quoted}`;
    // Point the caller at where valid slugs come from: the block slugs a richText
    // field exposes in `getEntitySchema` output. Same hint for inline blocks.
    throw new Error(
      `${named}. Valid slugs are listed under lexicalFeatures.blockNodes.block.slugs` +
        ` (and inlineNodes.inlineBlock.slugs) in the entity schema.`,
    );
  }
  return slugs.map((slug) => ({
    slug,
    fields: toFieldSchemas(blocksBySlug[slug].fields ?? [], blocksBySlug),
  }));
}

/**
 * List the collection and global slugs the given request may read, plus the
 * configured localization.
 *
 * The discovery half of the schema API: pair it with `getEntitySchema` to build
 * custom tools (e.g. `listEntities` + `getEntitySchema` MCP tools) without going
 * through HTTP. Uses the same lenient `canRead` check as `getEntitySchema` and
 * the `/content-cli/schema` endpoint, so everything listed here is resolvable by
 * `getEntitySchema` (an `access.read` Where-clause still counts as readable).
 *
 * Slugs are returned bare — apply any addressing convention (e.g. a `globals/`
 * prefix) or "internal collection" filtering in the caller; this helper mirrors
 * the endpoint and filters by access alone.
 */
export async function listReadableEntities({ req }: { req: PayloadRequest }): Promise<{
  collections: string[];
  globals: string[];
  localization: { locales: string[]; defaultLocale: string } | null;
}> {
  const payload = req.payload;

  const collections: string[] = [];
  for (const collection of payload.config.collections ?? []) {
    if (await canRead(collection, req)) collections.push(collection.slug);
  }

  const globals: string[] = [];
  for (const global of payload.config.globals ?? []) {
    if (await canRead(global, req)) globals.push(global.slug);
  }

  return { collections, globals, localization: buildLocalization(payload) };
}
