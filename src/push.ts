import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type Config, requireRemoteConfig } from "./config.js";
import { PayloadClient, PayloadApiError } from "./client.js";
import {
  loadManifest,
  saveManifest,
  contentHash,
  parseLocaleFilename,
  siblingLocaleKeys,
  type Manifest,
} from "./manifest.js";
import { status } from "./status.js";

export interface PushOptions {
  files?: string[];
  dryRun?: boolean;
  force?: boolean;
  draft?: boolean;
  allowUrlChange?: boolean;
}

interface ContentEntry {
  type: "collection" | "global";
  collection: string;
  id?: string;
  locale?: string;
  filePath: string;
}

export function parseContentPath(filePath: string, outputDir: string): ContentEntry | null {
  const rel = path.relative(outputDir, filePath);
  const parts = rel.split(path.sep);

  if (parts[0] === "collections" && parts.length === 3 && !parts[2].startsWith("_")) {
    const collection = parts[1];
    const { base: id, locale } = parseLocaleFilename(parts[2]);
    return { type: "collection", collection, id, locale, filePath };
  }

  // globals/<slug>/<slug>.json or <slug>_<locale>.json (new structure)
  if (parts[0] === "globals" && parts.length === 3) {
    const collection = parts[1];
    const { base, locale } = parseLocaleFilename(parts[2]);
    if (base === collection) {
      return { type: "global", collection, locale, filePath };
    }
  }

  // globals/<slug>.json (legacy flat structure)
  if (parts[0] === "globals" && parts.length === 2 && !parts[1].startsWith("_")) {
    const { base: collection, locale } = parseLocaleFilename(parts[1]);
    return { type: "global", collection, locale, filePath };
  }

  return null;
}

function recordPush(
  manifest: Manifest,
  outputDir: string,
  filePath: string,
  raw: string,
  updatedAt: string | null,
): void {
  const key = path.relative(outputDir, filePath);
  manifest.documents[key] = { hash: contentHash(raw), updatedAt };
  // `updatedAt` is document-level in Payload, so this push also bumped it for
  // every other locale of the same document. Propagate the new value to the
  // sibling locale entries so a later push of those locales doesn't mistake our
  // own bump for a remote modification and skip it as a conflict.
  if (updatedAt) {
    for (const sibling of siblingLocaleKeys(manifest.documents, key)) {
      manifest.documents[sibling].updatedAt = updatedAt;
    }
  }
}

async function checkConflict(
  client: PayloadClient,
  entry: ContentEntry,
  manifest: Manifest | null,
  outputDir: string,
): Promise<string | null> {
  if (!manifest) return null;

  const key = path.relative(outputDir, entry.filePath);
  const manifestEntry = manifest.documents[key];
  if (!manifestEntry?.updatedAt) return null;

  try {
    let remoteDoc: Record<string, unknown>;
    if (entry.type === "global") {
      remoteDoc = await client.getGlobal(entry.collection, {
        locale: entry.locale,
      });
    } else {
      remoteDoc = await client.getDoc(entry.collection, entry.id!, {
        locale: entry.locale,
      });
    }

    const remoteUpdatedAt = remoteDoc.updatedAt as string | undefined;
    if (remoteUpdatedAt && remoteUpdatedAt !== manifestEntry.updatedAt) {
      return `Remote was modified after your last pull (remote: ${remoteUpdatedAt}, pulled: ${manifestEntry.updatedAt})`;
    }
  } catch (err) {
    if (err instanceof PayloadApiError && err.isNotFound) return null;
    // Can't check — skip conflict detection
  }

  return null;
}

export async function push(config: Config, options: PushOptions = {}): Promise<void> {
  requireRemoteConfig(config);
  const client = new PayloadClient(config);
  const outputDir = path.resolve(config.outputDir);

  const manifest = await loadManifest(outputDir);

  // Block push to a different URL than the manifest was pulled from —
  // pushing to the wrong server is hard to recover from.
  if (manifest && manifest.payloadUrl !== config.payloadUrl) {
    console.warn(
      `Refusing to push: content was pulled from ${manifest.payloadUrl}, but you are now connected to ${config.payloadUrl}.`,
    );
    if (!options.allowUrlChange) {
      console.warn(
        `Re-pull from the correct server, or re-run with --allow-url-change if you intentionally want to push this content to a different server.`,
      );
      process.exit(1);
    }
    console.warn(`Proceeding because --allow-url-change was passed.`);
  }

  // Determine which files to push
  let filePaths: string[];
  if (options.files?.length) {
    filePaths = options.files.map((f) => path.resolve(f));
  } else {
    // Default: push only modified + added files (via status)
    const localStatus = await status(config);
    if (!localStatus) {
      console.warn(
        "No content directory found. Run `payload-content pull` to download content first.",
      );
      return;
    }
    const allRelPaths = [...localStatus.modified, ...localStatus.added];
    filePaths = allRelPaths.map((relPath) => path.join(outputDir, relPath));
  }

  const entries = filePaths
    .map((f) => parseContentPath(f, outputDir))
    .filter((e): e is ContentEntry => e !== null);

  if (entries.length === 0) {
    console.log("No changes to push.");
    return;
  }

  console.log(`Pushing ${entries.length} documents to ${config.payloadUrl}...`);

  let pushed = 0;
  let created = 0;
  let skipped = 0;
  let errors = 0;

  for (const entry of entries) {
    const raw = await fs.readFile(entry.filePath, "utf-8");
    const doc = JSON.parse(raw) as Record<string, unknown>;
    delete doc.$schema;

    if (entry.type === "global") {
      // Conflict check
      if (!options.force && !options.dryRun) {
        const conflict = await checkConflict(client, entry, manifest, outputDir);
        if (conflict) {
          const relPath = path.relative(process.cwd(), entry.filePath);
          console.warn(`  CONFLICT globals/${entry.collection}: ${conflict}`);
          console.warn(`    Local file: ${relPath}`);
          console.warn(
            `    Run 'pull --globals ${entry.collection}' to inspect remote, or 'push --force' to overwrite.`,
          );
          skipped++;
          continue;
        }
      }

      if (options.dryRun) {
        console.log(`  [dry-run] Would update global: ${entry.collection}`);
        continue;
      }

      try {
        const result = await client.updateGlobal(entry.collection, doc, {
          locale: entry.locale,
          draft: options.draft,
        });
        console.log(`  Updated global: ${entry.collection}`);
        pushed++;
        if (manifest) {
          recordPush(
            manifest,
            outputDir,
            entry.filePath,
            raw,
            (result.updatedAt as string) ?? null,
          );
        }
      } catch (err) {
        console.error(`  Failed to update global ${entry.collection}: ${(err as Error).message}`);
        errors++;
      }
    } else {
      const id = entry.id!;

      // Conflict check (only for existing docs)
      if (!options.force && !options.dryRun && doc.id) {
        const conflict = await checkConflict(client, entry, manifest, outputDir);
        if (conflict) {
          const relPath = path.relative(process.cwd(), entry.filePath);
          console.warn(`  CONFLICT ${entry.collection}/${id}: ${conflict}`);
          console.warn(`    Local file: ${relPath}`);
          console.warn(
            `    Run 'pull --collections ${entry.collection}' to inspect remote, or 'push --force' to overwrite.`,
          );
          skipped++;
          continue;
        }
      }

      if (options.dryRun) {
        const isNew = !doc.id && !doc.createdAt;
        console.log(`  [dry-run] Would ${isNew ? "create" : "update"} ${entry.collection}/${id}`);
        continue;
      }

      try {
        try {
          const result = await client.updateDoc(entry.collection, id, doc, {
            locale: entry.locale,
            draft: options.draft,
          });
          console.log(`  Updated ${entry.collection}/${id}`);
          pushed++;
          if (manifest) {
            recordPush(
              manifest,
              outputDir,
              entry.filePath,
              raw,
              (result.updatedAt as string) ?? null,
            );
          }
        } catch (err) {
          if (err instanceof PayloadApiError && err.isNotFound) {
            const createdDoc = await client.createDoc(entry.collection, doc, {
              locale: entry.locale,
              draft: options.draft,
            });
            console.log(`  Created ${entry.collection}/${createdDoc.id} (from ${id})`);
            created++;
          } else {
            throw err;
          }
        }
      } catch (err) {
        console.error(`  Failed ${entry.collection}/${id}: ${(err as Error).message}`);
        errors++;
      }
    }
  }

  // Save updated manifest
  if (manifest && !options.dryRun && (pushed > 0 || created > 0)) {
    await saveManifest(outputDir, manifest);
  }

  const parts = [`${pushed} updated`, `${created} created`];
  if (skipped > 0) parts.push(`${skipped} conflicts`);
  if (errors > 0) parts.push(`${errors} errors`);
  console.log(`\nDone. ${parts.join(", ")}.`);

  if (skipped > 0) {
    process.exit(2);
  }
  if (errors > 0) {
    process.exit(1);
  }
}
