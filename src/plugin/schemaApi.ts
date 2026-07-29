/**
 * The reusable, non-HTTP schema API for the content-cli plugin.
 *
 * These functions resolve the same field shapes the `/content-cli/schema`
 * endpoint produces, without going through HTTP — the building blocks for
 * custom tools (e.g. a schema MCP server). They share the endpoint's lenient,
 * access-aware `canRead` rule.
 *
 * They differ from the endpoint in one respect: block fields come back as slugs
 * for the caller to resolve via `getBlockSchema`, keeping a schema small enough
 * to hand to an agent. The endpoint keeps inlining (`blocks: "inline"` here),
 * because the CLI resolves blocks offline when stripping virtual fields and
 * writing `_jsonschema.json`.
 *
 * Types are kept inline to avoid a hard dependency on `payload`.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

import { toFieldSchemas } from "./fields.js";
import type { FieldSchema } from "./fields.js";
import { entityToJsonSchema } from "./jsonSchema.js";
import type { JsonSchema } from "./jsonSchema.js";

// Entities whose access.read already produced a warning — one warning per
// entity per process keeps repeated schema requests from flooding the log.
const warnedAccessErrors = new Set<string>();

// Mirrors Payload's read-access evaluation (see auth/getEntityPermissions.ts):
// a function returning true OR a Where clause counts as "has read access";
// falsy counts as "denied". With no `access.read` defined, Payload's default
// is `isLoggedIn`. A throwing access function counts as denied, but is
// surfaced via console.warn so the entity doesn't silently vanish from the
// schema.
export async function canRead(entity: any, req: any): Promise<boolean> {
  const fn = entity?.access?.read;
  if (typeof fn !== "function") return !!req.user;
  try {
    const result = await fn({ req });
    return !!result;
  } catch (error) {
    const slug = String(entity?.slug ?? "<unknown>");
    if (!warnedAccessErrors.has(slug)) {
      warnedAccessErrors.add(slug);
      console.warn(
        `[content-cli] access.read for "${slug}" threw — treating it as denied, ` +
          `so it is omitted from the schema: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
    return false;
  }
}

/** Build the slug → top-level block lookup used to resolve `blockReferences`. */
export function buildBlocksBySlug(payload: any): Record<string, any> {
  const blocksBySlug: Record<string, any> = {};
  for (const block of payload.config.blocks ?? []) {
    blocksBySlug[block.slug] = block;
  }
  return blocksBySlug;
}

// One registry per sanitized config. Payload builds a fresh config object on
// boot (and on dev hot-reload), so keying the cache on it can't go stale.
const blockRegistryCache = new WeakMap<object, Record<string, any>>();

/**
 * Every block the config can reach, by slug: `config.blocks` plus blocks
 * declared inline on a field or a lexical BlocksFeature.
 *
 * `getBlockSchema` resolves against this rather than `config.blocks` alone,
 * because a slug handed out by a referencing entity schema has to resolve
 * however the block was declared — and declaring blocks inline on the field is
 * the common Payload style.
 *
 * Discovery reuses the projection itself: in `reference` mode `toFieldSchemas`
 * registers each block it meets into the map, so walking every collection and
 * global collects the first level. Blocks nested inside those blocks are then
 * collected by re-projecting newly-found definitions until the map stops
 * growing. Definitions on `config.blocks` win a slug collision.
 */
function buildBlockRegistry(payload: any): Record<string, any> {
  const config = payload.config;
  const cached = blockRegistryCache.get(config);
  if (cached) return cached;

  const registry = buildBlocksBySlug(payload);
  const entities = [...(config.collections ?? []), ...(config.globals ?? [])];
  for (const entity of entities) {
    toFieldSchemas(entity.fields ?? [], registry, { blocks: "reference" });
  }

  // Fixpoint: projecting a block's own fields can register further blocks.
  const projected = new Set<string>();
  let pending = Object.keys(registry);
  while (pending.length > 0) {
    for (const slug of pending) {
      projected.add(slug);
      toFieldSchemas(registry[slug].fields ?? [], registry, { blocks: "reference" });
    }
    pending = Object.keys(registry).filter((slug) => !projected.has(slug));
  }

  blockRegistryCache.set(config, registry);
  return registry;
}

/** Project Payload's localization config to its CLI/JSON shape, or null. */
export function buildLocalization(
  payload: any,
): { locales: string[]; defaultLocale: string } | null {
  const localization = payload.config.localization;
  if (!localization) return null;
  return {
    locales: (localization.locales as any[]).map((locale: any) =>
      typeof locale === "string" ? locale : locale.code,
    ),
    defaultLocale: localization.defaultLocale,
  };
}

/** Assemble the per-entity schema shape from an already-resolved entity config. */
export function entityToSchema(
  entity: any,
  blocksBySlug: Record<string, any>,
): { slug: string; fields: FieldSchema[]; jsonSchema: JsonSchema } {
  const fields = toFieldSchemas(entity.fields, blocksBySlug);
  return { slug: entity.slug, fields, jsonSchema: entityToJsonSchema(entity.slug, fields) };
}

/**
 * Resolve a single collection's or global's schema for the given request.
 *
 * Building block for custom tools (e.g. a schema MCP tool) that need one
 * entity's field schema without going through HTTP. The same access check the
 * endpoint applies runs here: a denied `req.user` throws, mirroring (and
 * reusing) `canRead`'s lenient rule where an `access.read` Where-clause still
 * counts as readable.
 *
 * Collections and globals are looked up in separate namespaces — pass `type` to
 * pick which (a slug may exist in both). Throws on an unknown slug or denied
 * access, with a distinct message per case.
 *
 * `blocks` picks how much of the schema comes back at once:
 *
 * - `"reference"` (default) — a `blocks` field lists its `blockSlugs`, which
 *   `getBlockSchema` resolves on demand. The result is `{ slug, fields }`: no
 *   `jsonSchema`, since that document inlines every block and would undo the
 *   saving. Build one yourself with `entityToJsonSchema` if you need it.
 * - `"inline"` — the endpoint's self-contained shape,
 *   `{ slug, fields, jsonSchema }`, with each block's fields embedded.
 */
export async function getEntitySchema(args: {
  req: any;
  type: "collection" | "global";
  slug: string;
  blocks: "inline";
}): Promise<{ slug: string; fields: FieldSchema[]; jsonSchema: JsonSchema }>;
export async function getEntitySchema(args: {
  req: any;
  type: "collection" | "global";
  slug: string;
  blocks?: "reference";
}): Promise<{ slug: string; fields: FieldSchema[] }>;
export async function getEntitySchema({
  req,
  type,
  slug,
  blocks = "reference",
}: {
  req: any;
  type: "collection" | "global";
  slug: string;
  blocks?: "inline" | "reference";
}): Promise<{ slug: string; fields: FieldSchema[]; jsonSchema?: JsonSchema }> {
  const payload = req.payload;
  const list = type === "collection" ? payload.config.collections : payload.config.globals;
  const entity = (list ?? []).find((e: any) => e.slug === slug);
  if (!entity) {
    throw new Error(`No ${type} with slug "${slug}"`);
  }
  if (!(await canRead(entity, req))) {
    throw new Error(`Access denied to ${type} "${slug}"`);
  }
  if (blocks === "inline") {
    return entityToSchema(entity, buildBlocksBySlug(payload));
  }
  return {
    slug: entity.slug,
    fields: toFieldSchemas(entity.fields, buildBlocksBySlug(payload), { blocks: "reference" }),
  };
}

/**
 * Resolve the field schema of one or more top-level (richText-referenced) blocks
 * by slug.
 *
 * The third building block of the schema API, and the other half of
 * `getEntitySchema`'s progressive disclosure: entity schemas name the blocks
 * they accept — a `blocks` field's `blockSlugs`, a richText field's
 * `lexicalFeatures.blockNodes.block.slugs` — and this resolves the ones the
 * caller actually cares about to `{ slug, fields }`.
 *
 * `blocks` works as it does on `getEntitySchema`: `"reference"` (default) keeps
 * a block's own nested blocks as slugs, so detail unfolds one call at a time;
 * `"inline"` returns the whole subtree at once.
 *
 * Blocks are config fragments, not access-controlled entities, so there is no
 * read check (unlike `getEntitySchema`). Any block the config can reach resolves
 * — `config.blocks`, blocks declared inline on a field, and lexical
 * BlocksFeature blocks alike (see `buildBlockRegistry`). Throws if a requested
 * slug is unknown, naming all the missing ones. An empty `slugs` list returns
 * `[]`.
 *
 * Defining blocks globally on `config.blocks` is still the better default —
 * Payload v4 drops inline blocks, and shared definitions are more performant.
 */
export async function getBlockSchema({
  req,
  slugs,
  blocks = "reference",
}: {
  req: any;
  slugs: string[];
  blocks?: "inline" | "reference";
}): Promise<{ slug: string; fields: FieldSchema[] }[]> {
  const blocksBySlug = buildBlockRegistry(req.payload);
  const unknown = slugs.filter((slug) => !(slug in blocksBySlug));
  if (unknown.length > 0) {
    const quoted = unknown.map((slug) => `"${slug}"`).join(", ");
    const named =
      unknown.length === 1 ? `No block with slug ${quoted}` : `No blocks with slugs ${quoted}`;
    // Point the caller at where valid slugs come from: a blocks field's
    // blockSlugs, or the block slugs a richText field exposes.
    throw new Error(
      `${named}. Valid slugs are listed under a blocks field's blockSlugs, or under` +
        ` lexicalFeatures.blockNodes.block.slugs (and inlineNodes.inlineBlock.slugs)` +
        ` in the entity schema.`,
    );
  }
  return slugs.map((slug) => ({
    slug,
    fields: toFieldSchemas(blocksBySlug[slug].fields ?? [], blocksBySlug, { blocks }),
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
export async function listReadableEntities({ req }: { req: any }): Promise<{
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
