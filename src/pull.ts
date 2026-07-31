import * as fs from "node:fs/promises";
import * as path from "node:path";
import { type Config, requireRemoteConfig } from "./config.js";
import { PayloadClient } from "./client.js";
import { progress } from "./output.js";
import {
  contentHash,
  localeFilename,
  loadManifest,
  saveManifest,
  type Manifest,
  type DocumentEntry,
} from "./manifest.js";
import { safeJoinPath } from "./path-safety.js";
import { toManifestKey } from "./content-paths.js";
import { pooled } from "./pooled.js";
import { CliError } from "./errors.js";
import type { FieldSchema } from "./plugin/fields.js";

function stripVirtualFields(doc: Record<string, unknown>, fields: FieldSchema[]): void {
  for (const field of fields) {
    if (field.virtual) {
      delete doc[field.name];
    } else if (field.fields && doc[field.name] != null) {
      if (field.type === "array" && Array.isArray(doc[field.name])) {
        for (const item of doc[field.name] as Record<string, unknown>[]) {
          stripVirtualFields(item, field.fields);
        }
      } else if (field.type === "group" && typeof doc[field.name] === "object") {
        stripVirtualFields(doc[field.name] as Record<string, unknown>, field.fields);
      }
    } else if (field.blocks && doc[field.name] != null) {
      if (Array.isArray(doc[field.name])) {
        for (const item of doc[field.name] as Record<string, unknown>[]) {
          const blockType = item.blockType as string | undefined;
          const blockDef = field.blocks.find((b) => b.slug === blockType);
          if (blockDef) {
            stripVirtualFields(item, blockDef.fields);
          }
        }
      }
    }
  }
}

export interface PullOptions {
  locales?: string[];
  draft?: boolean;
  collections?: string[];
  globals?: string[];
  where?: Record<string, unknown>;
  allowUrlChange?: boolean;
}

async function pullCollection(
  client: PayloadClient,
  slug: string,
  outputDir: string,
  collectionsDir: string,
  options: PullOptions,
  fields?: FieldSchema[],
  hasJsonSchema = false,
): Promise<Record<string, DocumentEntry>> {
  const collectionDir = safeJoinPath(collectionsDir, slug);
  await fs.mkdir(collectionDir, { recursive: true });

  const locales: Array<string | undefined> = options.locales?.length
    ? options.locales
    : [undefined];

  const entries: Record<string, DocumentEntry> = {};

  for (const locale of locales) {
    const docs = await client.getAllCollectionDocs(slug, {
      depth: 0,
      locale,
      draft: options.draft,
      where: options.where,
    });
    progress(`  ${slug}: ${docs.length} documents${locale ? ` (${locale})` : ""}`);

    for (const doc of docs) {
      const id = doc.id as string;
      if (!id) continue;
      if (fields) stripVirtualFields(doc, fields);
      const filename = localeFilename(id, locale);
      const filePath = safeJoinPath(collectionDir, filename);
      const finalDoc = hasJsonSchema ? { $schema: "./_jsonschema.json", ...doc } : doc;
      const content = JSON.stringify(finalDoc, null, 2) + "\n";
      await fs.writeFile(filePath, content);

      entries[toManifestKey(outputDir, filePath)] = {
        hash: contentHash(content),
        updatedAt: (doc.updatedAt as string) ?? null,
      };
    }
  }

  return entries;
}

async function pullGlobal(
  client: PayloadClient,
  slug: string,
  outputDir: string,
  globalsDir: string,
  options: PullOptions,
  fields?: FieldSchema[],
  hasJsonSchema = false,
): Promise<Record<string, DocumentEntry>> {
  const globalDir = safeJoinPath(globalsDir, slug);
  await fs.mkdir(globalDir, { recursive: true });

  const locales: Array<string | undefined> = options.locales?.length
    ? options.locales
    : [undefined];

  const entries: Record<string, DocumentEntry> = {};

  for (const locale of locales) {
    const doc = await client.getGlobal(slug, {
      depth: 0,
      locale,
      draft: options.draft,
    });
    if (fields) stripVirtualFields(doc, fields);
    const filename = localeFilename(slug, locale);
    const filePath = safeJoinPath(globalDir, filename);
    const finalDoc = hasJsonSchema ? { $schema: "./_jsonschema.json", ...doc } : doc;
    const content = JSON.stringify(finalDoc, null, 2) + "\n";
    await fs.writeFile(filePath, content);

    progress(`  ${slug}: global${locale ? ` (${locale})` : ""}`);

    entries[toManifestKey(outputDir, filePath)] = {
      hash: contentHash(content),
      updatedAt: (doc.updatedAt as string) ?? null,
    };
  }

  return entries;
}

export interface PullResult {
  /** Absolute path content was written to. */
  outputDir: string;
  /** Number of documents written across all collections and globals. */
  documents: number;
  collections: string[];
  globals: string[];
  /** Orphan files from a previous pull that were deleted (content unchanged). */
  pruned: number;
  /** Orphan files kept because they carry local edits — surface as Added in `status`. */
  preserved: number;
}

export async function pull(config: Config, options: PullOptions = {}): Promise<PullResult> {
  requireRemoteConfig(config);
  const client = new PayloadClient(config);
  const outputDir = path.resolve(config.outputDir);

  // Refuse if the existing manifest was pulled from a different server
  const existingManifest = await loadManifest(outputDir);
  if (existingManifest && existingManifest.payloadUrl !== config.payloadUrl) {
    if (!options.allowUrlChange) {
      throw new CliError(
        `existing content was pulled from ${existingManifest.payloadUrl}, but you are now pulling from ${config.payloadUrl}.\n` +
          `Re-run with --allow-url-change to repoint the manifest at the new server, or 'payload-content clean' to start fresh.`,
      );
    }
    console.warn(
      `Warning: existing content was pulled from ${existingManifest.payloadUrl}, but you are now pulling from ${config.payloadUrl}.`,
    );
    console.warn(`Proceeding because --allow-url-change was passed.`);
  }

  progress(`Connecting to ${config.payloadUrl}...`);

  // Use access endpoint for discovery (built into Payload, no plugin needed)
  const access = await client.getAccess();

  // Schema is optional — provides field metadata for virtual field stripping and _schema.json
  const schema = await client.getSchema();
  const schemaCollections = schema?.collections ?? {};
  const schemaGlobals = schema?.globals ?? {};

  if (!schema) {
    progress(
      "Plugin not installed — pulling without schema metadata (no virtual field stripping).",
    );
  }

  let targetCollections: string[];
  let targetGlobals: string[];

  if (options.collections?.length || options.globals?.length) {
    targetCollections = options.collections ?? [];
    targetGlobals = options.globals ?? [];
  } else {
    targetCollections = access.collections;
    targetGlobals = access.globals;

    progress(`Found ${targetCollections.length} collections, ${targetGlobals.length} globals`);
  }

  if (options.draft) {
    progress("Mode: drafts");
  }
  if (options.where) {
    progress(`Filter: ${JSON.stringify(options.where)}`);
  }
  if (options.locales?.length) {
    progress(`Locales: ${options.locales.join(", ")}`);
  }

  const collectionsDir = path.join(outputDir, "collections");
  const globalsDir = path.join(outputDir, "globals");

  // Pull collections and globals with configurable concurrency
  const concurrency = 4;
  const tasks = [
    ...targetCollections.map(
      (slug) => () =>
        pullCollection(
          client,
          slug,
          outputDir,
          collectionsDir,
          options,
          schemaCollections[slug]?.fields,
          Boolean(schemaCollections[slug]?.jsonSchema),
        ),
    ),
    ...targetGlobals.map(
      (slug) => () =>
        pullGlobal(
          client,
          slug,
          outputDir,
          globalsDir,
          options,
          schemaGlobals[slug]?.fields,
          Boolean(schemaGlobals[slug]?.jsonSchema),
        ),
    ),
  ];

  const results = await pooled(tasks, concurrency);

  // Snapshot the previous manifest so we can detect and prune orphan files
  // (files this pull no longer writes but a previous pull did).
  const previousDocuments: Record<string, DocumentEntry> = existingManifest
    ? { ...existingManifest.documents }
    : {};

  // Clear-then-upsert: remove entries matching the pulled scope, then add new ones
  const manifest: Manifest = existingManifest ?? {
    payloadUrl: config.payloadUrl,
    documents: {},
  };
  manifest.payloadUrl = config.payloadUrl;

  // Clear entries matching the pulled scope (only when pulling full collections)
  if (!options.where) {
    const pulledPrefixes = [
      ...targetCollections.map((s) => `collections/${s}/`),
      ...targetGlobals.map((s) => `globals/${s}/`),
    ];
    for (const key of Object.keys(manifest.documents)) {
      if (pulledPrefixes.some((prefix) => key.startsWith(prefix))) {
        delete manifest.documents[key];
      }
    }
  }

  // Add new entries
  for (const entries of results) {
    Object.assign(manifest.documents, entries);
  }

  // Write schema files (only when plugin is installed)
  if (schema) {
    for (const slug of targetCollections) {
      const entry = schemaCollections[slug];
      if (!entry) continue;
      const dir = path.join(collectionsDir, slug);
      const { jsonSchema, ...rest } = entry;
      await fs.writeFile(path.join(dir, "_schema.json"), JSON.stringify(rest, null, 2) + "\n");
      if (jsonSchema) {
        await fs.writeFile(
          path.join(dir, "_jsonschema.json"),
          JSON.stringify(jsonSchema, null, 2) + "\n",
        );
      }
    }
    for (const slug of targetGlobals) {
      const entry = schemaGlobals[slug];
      if (!entry) continue;
      const dir = path.join(globalsDir, slug);
      const { jsonSchema, ...rest } = entry;
      await fs.writeFile(path.join(dir, "_schema.json"), JSON.stringify(rest, null, 2) + "\n");
      if (jsonSchema) {
        await fs.writeFile(
          path.join(dir, "_jsonschema.json"),
          JSON.stringify(jsonSchema, null, 2) + "\n",
        );
      }
    }
    if (schema.localization) {
      await fs.writeFile(
        path.join(outputDir, "_localization.json"),
        JSON.stringify(schema.localization, null, 2) + "\n",
      );
    }
    progress("Schema files written.");
  }

  await saveManifest(outputDir, manifest);

  // Prune orphans: files the previous manifest tracked that this pull no
  // longer covers. Only delete if on-disk content still matches the previous
  // hash — local edits are preserved (and will surface as Added in `status`).
  let pruned = 0;
  let preserved = 0;
  for (const [key, prev] of Object.entries(previousDocuments)) {
    if (key in manifest.documents) continue;
    const filePath = path.join(outputDir, key);
    let current: string;
    try {
      current = await fs.readFile(filePath, "utf-8");
    } catch {
      continue; // already gone
    }
    if (contentHash(current) === prev.hash) {
      await fs.rm(filePath, { force: true });
      pruned++;
    } else {
      preserved++;
    }
  }
  if (pruned > 0) {
    progress(`Removed ${pruned} orphan file(s) from previous pull.`);
  }
  if (preserved > 0) {
    progress(`Kept ${preserved} orphan file(s) with local edits — review with \`status\`.`);
  }

  progress(`Done. Content written to ${outputDir}/`);

  return {
    outputDir,
    documents: Object.keys(manifest.documents).length,
    collections: targetCollections,
    globals: targetGlobals,
    pruned,
    preserved,
  };
}
