import * as path from "node:path";
import { type Config, requireRemoteConfig } from "./config.js";
import { PayloadClient } from "./client.js";
import { loadManifest, parseLocaleFilename } from "./manifest.js";

export interface DiffResult {
  localOnly: string[];
  remoteOnly: string[];
  remoteModified: string[];
  localModified: string[];
  bothModified: string[];
  unchanged: string[];
}

export async function diff(config: Config): Promise<DiffResult> {
  requireRemoteConfig(config);
  const client = new PayloadClient(config);
  const outputDir = path.resolve(config.outputDir);
  const manifest = await loadManifest(outputDir);

  if (!manifest) {
    throw new Error("No manifest found. Run `pull` first.");
  }

  const result: DiffResult = {
    localOnly: [],
    remoteOnly: [],
    remoteModified: [],
    localModified: [],
    bothModified: [],
    unchanged: [],
  };

  // Import status to get local changes
  const { status } = await import("./status.js");
  const localStatus = await status(config);
  const localModifiedSet = new Set(localStatus?.modified ?? []);

  // Check each tracked document against remote
  for (const [key, entry] of Object.entries(manifest.documents)) {
    const parts = key.split(path.sep);
    let type: "collection" | "global";
    let collection: string;
    let id: string | undefined;
    let locale: string | undefined;

    if (parts[0] === "collections" && parts.length === 3) {
      type = "collection";
      collection = parts[1];
      const parsed = parseLocaleFilename(parts[2]);
      id = parsed.base;
      locale = parsed.locale;
    } else if (parts[0] === "globals" && parts.length === 3) {
      type = "global";
      collection = parts[1];
      locale = parseLocaleFilename(parts[2]).locale;
    } else {
      continue;
    }

    try {
      let remoteDoc: Record<string, unknown>;
      if (type === "global") {
        remoteDoc = await client.getGlobal(collection, { locale });
      } else {
        remoteDoc = await client.getDoc(collection, id!, { locale });
      }

      const remoteUpdatedAt = remoteDoc.updatedAt as string | undefined;
      const remoteChanged =
        remoteUpdatedAt && remoteUpdatedAt !== entry.updatedAt;
      const localChanged = localModifiedSet.has(key);

      if (remoteChanged && localChanged) {
        result.bothModified.push(key);
      } else if (remoteChanged) {
        result.remoteModified.push(key);
      } else if (localChanged) {
        result.localModified.push(key);
      } else {
        result.unchanged.push(key);
      }
    } catch {
      // Doc was deleted remotely
      result.localOnly.push(key);
    }
  }

  // New local files
  result.localOnly.push(...(localStatus?.added ?? []));

  // TODO: detect remotely added docs (would require re-fetching all collections)

  return result;
}

export function printDiff(result: DiffResult): void {
  const hasChanges =
    result.localOnly.length +
    result.remoteOnly.length +
    result.remoteModified.length +
    result.localModified.length +
    result.bothModified.length;

  if (hasChanges === 0) {
    console.log("Everything is in sync.");
    return;
  }

  console.log(
    "Legend: L> push, <R pull, !! conflict, +L local-only, +R remote-only",
  );
  console.log("");

  for (const key of result.bothModified) {
    console.log(`  !! ${key}  (both local and remote modified — conflict)`);
  }
  for (const key of result.localModified) {
    console.log(`  L> ${key}  (local changes to push)`);
  }
  for (const key of result.remoteModified) {
    console.log(`  <R ${key}  (remote changes to pull)`);
  }
  for (const key of result.localOnly) {
    console.log(`  +L ${key}  (local only)`);
  }
  for (const key of result.remoteOnly) {
    console.log(`  +R ${key}  (remote only)`);
  }

  console.log(
    `\n${result.localModified.length} local, ${result.remoteModified.length} remote, ${result.bothModified.length} conflicts, ${result.localOnly.length} local-only, ${result.remoteOnly.length} remote-only`,
  );
}
