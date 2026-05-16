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
