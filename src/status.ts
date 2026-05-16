import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Config } from "./config.js";
import { contentHash, loadManifest } from "./manifest.js";

export interface StatusResult {
  modified: string[];
  added: string[];
  deleted: string[];
}

export async function status(config: Config): Promise<StatusResult | null> {
  const outputDir = path.resolve(config.outputDir);
  const manifest = await loadManifest(outputDir);

  if (!manifest) {
    return null;
  }

  const result: StatusResult = { modified: [], added: [], deleted: [] };

  // Check tracked documents for modifications and deletions
  for (const [key, entry] of Object.entries(manifest.documents)) {
    const filePath = path.join(outputDir, key);
    try {
      const content = await fs.readFile(filePath, "utf-8");
      const currentHash = contentHash(content);
      if (currentHash !== entry.hash) {
        result.modified.push(key);
      }
    } catch {
      result.deleted.push(key);
    }
  }

  // Scan for new files not in the manifest
  const trackedPaths = new Set(Object.keys(manifest.documents));

  async function scanDir(dir: string) {
    let entries;
    try {
      entries = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory()) {
        await scanDir(fullPath);
      } else if (
        entry.name.endsWith(".json") &&
        !entry.name.startsWith(".") &&
        !entry.name.startsWith("_")
      ) {
        const relPath = path.relative(outputDir, fullPath);
        if (!trackedPaths.has(relPath)) {
          // Derive the key from the path
          result.added.push(relPath);
        }
      }
    }
  }

  await scanDir(path.join(outputDir, "collections"));
  await scanDir(path.join(outputDir, "globals"));

  return result;
}

export function printStatus(result: StatusResult | null): void {
  if (!result) {
    console.warn(
      "No content directory found. Run `payload-content pull` to download content first.",
    );
    return;
  }

  const total = result.modified.length + result.added.length + result.deleted.length;

  if (total === 0) {
    console.log("No local changes.");
    return;
  }

  for (const key of result.modified) {
    console.log(`  M  ${key}`);
  }
  for (const key of result.added) {
    console.log(`  A  ${key}`);
  }
  for (const key of result.deleted) {
    console.log(`  D  ${key}`);
  }

  console.log(
    `\n${result.modified.length} modified, ${result.added.length} added, ${result.deleted.length} deleted`,
  );

  const orphanCount = countLikelyOrphans(result.added);
  if (orphanCount > 0 && orphanCount === result.added.length) {
    console.log(
      `\nNote: all ${orphanCount} added files have Payload-ID-shaped names, which usually means they are leftover from a previous pull (e.g. switching --locale or --draft modes). Run \`payload-content clean\` to start fresh, or push them if they are intentional.`,
    );
  } else if (orphanCount > 0) {
    console.log(
      `\nNote: ${orphanCount} of ${result.added.length} added files have Payload-ID-shaped names — they may be leftovers from a previous pull.`,
    );
  }
}

const OBJECT_ID_PATTERN = /^[0-9a-f]{24}(_[a-z][a-z0-9-]*)?\.json$/i;

function countLikelyOrphans(added: string[]): number {
  let count = 0;
  for (const key of added) {
    const base = key.split(/[/\\]/).pop() ?? "";
    if (OBJECT_ID_PATTERN.test(base)) count++;
  }
  return count;
}
