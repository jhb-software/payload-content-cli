import * as crypto from "node:crypto";
import * as fs from "node:fs/promises";
import * as path from "node:path";

export interface DocumentEntry {
  hash: string;
  updatedAt: string | null;
}

export interface Manifest {
  payloadUrl: string;
  documents: Record<string, DocumentEntry>;
}

export function contentHash(content: string): string {
  return crypto.createHash("sha256").update(content).digest("hex").slice(0, 16);
}

export function localeFilename(base: string, locale?: string): string {
  return locale ? `${base}_${locale}.json` : `${base}.json`;
}

export function parseLocaleFilename(filename: string): {
  base: string;
  locale?: string;
} {
  const stem = filename.replace(/\.json$/, "");
  const lastUnderscore = stem.lastIndexOf("_");
  if (lastUnderscore === -1) return { base: stem };
  const possibleLocale = stem.slice(lastUnderscore + 1);
  if (/^[a-z]{2,5}(-[a-z]{2,5})?$/.test(possibleLocale)) {
    return { base: stem.slice(0, lastUnderscore), locale: possibleLocale };
  }
  return { base: stem };
}

/**
 * In Payload, `updatedAt` is a document-level field shared across all locales,
 * so pushing one locale bumps it for every locale of the same document. Given a
 * manifest key, these are the keys of the other locale files for the same
 * document (same directory and base id). A push uses them to propagate the new
 * `updatedAt`, so the next locale's push doesn't see a self-inflicted conflict.
 */
export function siblingLocaleKeys(documents: Record<string, DocumentEntry>, key: string): string[] {
  const dir = path.dirname(key);
  const { base, locale } = parseLocaleFilename(path.basename(key));
  if (!locale) return [];
  return Object.keys(documents).filter((k) => {
    if (k === key || path.dirname(k) !== dir) return false;
    const sibling = parseLocaleFilename(path.basename(k));
    return sibling.locale !== undefined && sibling.base === base;
  });
}

export async function loadManifest(outputDir: string): Promise<Manifest | null> {
  try {
    const raw = await fs.readFile(path.join(outputDir, ".manifest.json"), "utf-8");
    return JSON.parse(raw) as Manifest;
  } catch {
    return null;
  }
}

export async function saveManifest(outputDir: string, manifest: Manifest): Promise<void> {
  await fs.writeFile(
    path.join(outputDir, ".manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
  );
}
