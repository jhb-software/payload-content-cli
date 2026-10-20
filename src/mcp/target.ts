/** What the content tools share: addressing a collection or a global, and reading an error. */

import type { PayloadRequest, SanitizedCollectionConfig, SanitizedGlobalConfig } from "payload";
import { listReadableEntities } from "../plugin/index.js";
import type { McpContentToolsOptions } from "./options.js";

export const GLOBAL_PREFIX = "globals/";

export type Target = { kind: "collection" | "global"; slug: string };

export type EntityConfig = SanitizedCollectionConfig | SanitizedGlobalConfig;

/** A collection slug, or a global addressed as `globals/<slug>`. */
export function parseTarget(collection: string): Target {
  return collection.startsWith(GLOBAL_PREFIX)
    ? { kind: "global", slug: collection.slice(GLOBAL_PREFIX.length) }
    : { kind: "collection", slug: collection };
}

/** The target's config, or undefined when no such collection or global exists. */
export function entityConfig(req: PayloadRequest, target: Target): EntityConfig | undefined {
  return target.kind === "global"
    ? req.payload.globals.config.find((global) => global.slug === target.slug)
    : req.payload.collections[target.slug]?.config;
}

/** Payload's own bookkeeping collections; never content. Same list as the CLI's. */
export const INTERNAL_COLLECTIONS = new Set([
  "payload-locked-documents",
  "payload-preferences",
  "payload-migrations",
]);

/**
 * The collection or global a tool call addresses, after the app's `checkId`
 * has accepted the id. Throws what to tell the agent otherwise; for an unknown
 * slug, that names the ones it may use.
 */
export async function openTarget(
  req: PayloadRequest,
  options: McpContentToolsOptions,
  collection: string,
  id?: string | number,
): Promise<{ target: Target; config: EntityConfig }> {
  const target = parseTarget(collection);
  const config = entityConfig(req, target);
  if (!config) {
    const { collections, globals } = await listReadableEntities({ req });
    const names =
      target.kind === "global"
        ? globals.map((slug) => GLOBAL_PREFIX + slug)
        : collections.filter((slug) => !INTERNAL_COLLECTIONS.has(slug));
    const noun = target.kind === "global" ? "Globals" : "Collections";
    throw new Error(`No ${target.kind} "${target.slug}". ${noun}: ${names.join(", ") || "none"}.`);
  }
  if (id !== undefined) {
    const refusal = await options.checkId?.(req, { collection, id });
    if (refusal) throw new Error(refusal);
  }
  return { target, config };
}

export function hasDrafts(config: { versions?: unknown }): boolean {
  return Boolean((config.versions as { drafts?: unknown } | undefined)?.drafts);
}

/**
 * An error's message, with the per-field detail Payload keeps in
 * `data.errors` (its own message only names the fields).
 */
export function errorMessage(err: unknown): string {
  if (!(err instanceof Error)) return String(err);
  const fieldErrors = (err as { data?: { errors?: unknown } }).data?.errors;
  if (!Array.isArray(fieldErrors)) return err.message;
  const details = fieldErrors
    .map((entry: { path?: unknown; message?: unknown }) =>
      typeof entry?.message === "string" && !err.message.includes(entry.message)
        ? `${String(entry.path)}: ${entry.message}`
        : undefined,
    )
    .filter(Boolean);
  return details.length ? `${err.message} (${details.join("; ")})` : err.message;
}
