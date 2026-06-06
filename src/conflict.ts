import { PayloadClient } from "./client.js";
import { contentHash } from "./manifest.js";
import { formatDocument, type FieldSchema } from "./content-format.js";

export interface EntitySchemaInfo {
  fields?: FieldSchema[];
  hasJsonSchema: boolean;
}

export interface EntitySchemas {
  collections: Record<string, EntitySchemaInfo>;
  globals: Record<string, EntitySchemaInfo>;
}

/**
 * Fetch the schema once and reduce it to the per-entity field metadata that
 * `formatDocument` needs. Returns empty maps when the plugin is not installed —
 * matching how `pull` writes documents without virtual-field stripping in that
 * case, so the hashes still line up.
 */
export async function loadEntitySchemas(client: PayloadClient): Promise<EntitySchemas> {
  const schema = await client.getSchema();
  const toInfo = (raw: unknown): Record<string, EntitySchemaInfo> => {
    const out: Record<string, EntitySchemaInfo> = {};
    const entries = (raw ?? {}) as Record<string, { fields?: FieldSchema[]; jsonSchema?: unknown }>;
    for (const [slug, entry] of Object.entries(entries)) {
      out[slug] = { fields: entry.fields, hasJsonSchema: Boolean(entry.jsonSchema) };
    }
    return out;
  };
  return {
    collections: toInfo(schema?.collections),
    globals: toInfo(schema?.globals),
  };
}

export interface RemoteTarget {
  type: "collection" | "global";
  collection: string;
  id?: string;
  locale?: string;
  draft?: boolean;
}

/**
 * Whether the remote document's content differs from what we last pulled.
 *
 * Re-fetches the document the same way `pull` does (depth 0, same locale),
 * renders it with `formatDocument`, and compares its hash to the base hash
 * stored in the manifest. This is locale-accurate — pushing one locale never
 * changes another locale's content, so its hash still matches — unlike a
 * document-level `updatedAt`, which every locale's write bumps.
 *
 * Fetch errors (including "not found") propagate so callers can decide how to
 * treat a missing or unreachable document.
 */
export async function remoteContentChanged(
  client: PayloadClient,
  target: RemoteTarget,
  baseHash: string,
  schemas: EntitySchemas,
): Promise<boolean> {
  const remoteDoc =
    target.type === "global"
      ? await client.getGlobal(target.collection, {
          depth: 0,
          locale: target.locale,
          draft: target.draft,
        })
      : await client.getDoc(target.collection, target.id!, {
          depth: 0,
          locale: target.locale,
          draft: target.draft,
        });

  const info =
    target.type === "global"
      ? schemas.globals[target.collection]
      : schemas.collections[target.collection];

  const remoteHash = contentHash(
    formatDocument(remoteDoc, info?.fields, info?.hasJsonSchema ?? false),
  );
  return remoteHash !== baseHash;
}
