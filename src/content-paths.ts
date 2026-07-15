import * as path from "node:path";
import { parseLocaleFilename } from "./manifest.js";

/**
 * Manifest keys are always POSIX-style relative paths ("collections/posts/x.json"),
 * regardless of platform — they are written to .manifest.json, which may be
 * shared between macOS/Linux and Windows machines.
 */
export function toManifestKey(outputDir: string, filePath: string): string {
  return path.relative(outputDir, filePath).split(path.sep).join("/");
}

export interface ParsedContentKey {
  type: "collection" | "global";
  collection: string;
  id?: string;
  locale?: string;
}

/**
 * Parse a manifest key (POSIX-style relative path) into its content identity.
 * Returns null for schema/metadata files and paths outside the known layout.
 */
export function parseContentKey(key: string): ParsedContentKey | null {
  const parts = key.split("/");

  if (parts[0] === "collections" && parts.length === 3 && !parts[2].startsWith("_")) {
    const collection = parts[1];
    const { base: id, locale } = parseLocaleFilename(parts[2]);
    return { type: "collection", collection, id, locale };
  }

  // globals/<slug>/<slug>.json or <slug>_<locale>.json (new structure)
  if (parts[0] === "globals" && parts.length === 3) {
    const collection = parts[1];
    const { base, locale } = parseLocaleFilename(parts[2]);
    if (base === collection) {
      return { type: "global", collection, locale };
    }
  }

  // globals/<slug>.json (legacy flat structure)
  if (parts[0] === "globals" && parts.length === 2 && !parts[1].startsWith("_")) {
    const { base: collection, locale } = parseLocaleFilename(parts[1]);
    return { type: "global", collection, locale };
  }

  return null;
}

export interface ContentEntry extends ParsedContentKey {
  filePath: string;
}

/** Parse an absolute or cwd-relative content file path into its content identity. */
export function parseContentPath(filePath: string, outputDir: string): ContentEntry | null {
  const parsed = parseContentKey(toManifestKey(outputDir, filePath));
  if (!parsed) return null;
  return { ...parsed, filePath };
}
