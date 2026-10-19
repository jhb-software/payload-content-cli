/** What the content tools share: addressing a collection or a global, and reading an error. */

import type { PayloadRequest, SanitizedCollectionConfig, SanitizedGlobalConfig } from "payload";

export const GLOBAL_PREFIX = "globals/";

export type Target = { kind: "collection" | "global"; slug: string };

/** A collection slug, or a global addressed as `globals/<slug>`. */
export function parseTarget(collection: string): Target {
  return collection.startsWith(GLOBAL_PREFIX)
    ? { kind: "global", slug: collection.slice(GLOBAL_PREFIX.length) }
    : { kind: "collection", slug: collection };
}

/** The target's config, or undefined when no such collection or global exists. */
export function entityConfig(
  req: PayloadRequest,
  target: Target,
): SanitizedCollectionConfig | SanitizedGlobalConfig | undefined {
  return target.kind === "global"
    ? req.payload.globals.config.find((global) => global.slug === target.slug)
    : req.payload.collections[target.slug]?.config;
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
