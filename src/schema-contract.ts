/**
 * The shared contract for the plugin's `/content-cli/schema` endpoint.
 *
 * Both halves of this package speak this shape: the plugin assembles it
 * (src/plugin/index.ts) and the CLI consumes it (client.getSchema → pull,
 * discover). Change it here, and both sides type-check against the change.
 *
 * `version` is bumped on breaking changes to this contract so the CLI can
 * detect a mismatched plugin instead of silently mis-parsing.
 */

import type { FieldSchema } from "./plugin/fields.js";
import type { JsonSchema } from "./plugin/jsonSchema.js";

export const SCHEMA_CONTRACT_VERSION = 1;

export interface EntitySchema {
  slug: string;
  fields: FieldSchema[];
  jsonSchema: JsonSchema;
}

export interface LocalizationSchema {
  locales: string[];
  defaultLocale: string;
}

export interface EndpointSchema {
  /** Resolved API path, e.g. "/api/posts/publish" */
  path: string;
  method: string;
  /** Human-readable description of what the endpoint does */
  description?: string;
  /** Describes the endpoint's request/response contract */
  schema?: {
    query?: Record<string, unknown>;
    body?: Record<string, unknown>;
    response?: Record<string, unknown>;
  };
}

export interface SchemaResponse {
  version: number;
  collections: Record<string, EntitySchema>;
  globals: Record<string, EntitySchema>;
  localization: LocalizationSchema | null;
  endpoints: EndpointSchema[];
}
