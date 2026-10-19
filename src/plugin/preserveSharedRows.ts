/**
 * A Payload plugin that refuses writes which would silently discard another
 * locale's translations of array and blocks rows. See `./sharedRows.ts` for
 * when a write does that.
 *
 * The admin panel is unaffected, as it sends an id with every row. What this
 * catches is API and agent traffic that reads a document in one locale and
 * writes its rows back without their ids.
 */

import type {
  Block,
  CollectionBeforeOperationHook,
  Config,
  Field,
  GlobalBeforeOperationHook,
  PayloadRequest,
  Plugin,
  Where,
} from "payload";
import { ValidationError } from "payload";
import {
  containsObjectArray,
  findDroppedSharedRows,
  type SharedRowViolation,
} from "./sharedRows.js";

/**
 * Set `context[ALLOW_SHARED_ROW_REPLACEMENT] = true` on an operation to replace
 * rows outright, accepting the loss of the other locales' translations.
 */
export const ALLOW_SHARED_ROW_REPLACEMENT = "allowSharedRowReplacement";

export interface PreserveSharedRowsPluginOptions {
  /** Collections to guard. Default: every collection. */
  collections?: string[];
  /** Globals to guard. Default: every global. */
  globals?: string[];
  /** Default true. */
  enabled?: boolean;
}

/** How many documents a bulk (`where`) update checks. */
const BULK_CHECK_LIMIT = 100;

function describe(violation: SharedRowViolation): string {
  return (
    `${violation.path}: every row was sent without an id, so all ${violation.existingIds.length} ` +
    `existing row(s) would be replaced rather than edited, discarding the translations the other ` +
    `locales hold for them. Send each row you keep back with its id ` +
    `(${violation.existingIds.join(", ")}); rows without an id are then added. ` +
    `To replace the rows and lose those translations on purpose, set ` +
    `${ALLOW_SHARED_ROW_REPLACEMENT} on the operation context (the MCP update tool's replaceRows: true).`
  );
}

function reject(
  violations: SharedRowViolation[],
  req: PayloadRequest,
  slug: string,
  id?: number | string,
): never {
  const error = new ValidationError(
    {
      id,
      collection: slug,
      errors: violations.map((violation) => ({
        path: violation.path,
        message: describe(violation),
      })),
      req,
    },
    req.t,
  );
  // ValidationError's own message only names the fields, which tells a caller
  // nothing about what to do differently, and most error paths drop
  // `data.errors`. So the instructions go into the message itself.
  error.message = violations.map(describe).join(" ");
  throw error;
}

type Data = Record<string, unknown>;

const isRecord = (doc: unknown): doc is Data => typeof doc === "object" && doc !== null;

/** Whether a write is worth reading the stored document for. */
const shouldCheck = (data: unknown, req: PayloadRequest): data is Data =>
  Boolean(req.payload.config.localization) &&
  req.context?.[ALLOW_SHARED_ROW_REPLACEMENT] !== true &&
  containsObjectArray(data);

function check(
  fields: Field[],
  data: Data,
  existing: unknown,
  req: PayloadRequest,
  slug: string,
  id?: number | string,
) {
  const violations = findDroppedSharedRows(
    fields,
    data,
    isRecord(existing) ? existing : undefined,
    req.payload.config.blocks as Block[] | undefined,
  );
  if (violations.length > 0) reject(violations, req, slug, id);
}

// It has to run in beforeOperation: the beforeValidate field traversal, which
// runs before every document-level hook, hands each id-less row a fresh id.
// A beforeChange hook would see ids on every row and never fire. The price is
// reading the stored document here, so only writes carrying rows are checked.
const collectionHook: CollectionBeforeOperationHook = async ({ args, operation, collection }) => {
  if (operation !== "update") return args;
  const { req, data } = args as { req: PayloadRequest; data?: unknown };
  if (!shouldCheck(data, req)) return args;

  const read = {
    collection: collection.slug,
    depth: 0,
    draft: Boolean((args as { draft?: boolean }).draft),
    locale: req.locale,
    overrideAccess: true,
    req,
  } as const;
  const { id, where } = args as { id?: number | string; where?: Where };
  if (id !== undefined) {
    const existing = await req.payload.findByID({ ...read, id, disableErrors: true });
    check(collection.fields, data, existing, req, collection.slug, id);
  } else if (where !== undefined) {
    const { docs } = await req.payload.find({ ...read, where, limit: BULK_CHECK_LIMIT });
    for (const doc of docs) check(collection.fields, data, doc, req, collection.slug, doc.id);
  }
  return args;
};

const globalHook: GlobalBeforeOperationHook = async ({ args, operation, global }) => {
  if (operation !== "update") return args;
  const { req, data } = args as { req: PayloadRequest; data?: unknown };
  if (!shouldCheck(data, req)) return args;

  const existing = await req.payload.findGlobal({
    slug: global.slug,
    depth: 0,
    draft: Boolean((args as { draft?: boolean }).draft),
    locale: req.locale,
    overrideAccess: true,
    req,
  });
  check(global.fields, data, existing, req, global.slug);
  return args;
};

/**
 * Refuses an update that sends every row of a shared array or blocks field
 * without its id, which would replace the rows and discard the other locales'
 * translations of them. Inert without localization.
 *
 * @example
 * ```ts
 * export default buildConfig({ plugins: [preserveSharedRowsPlugin()] })
 * ```
 */
export function preserveSharedRowsPlugin(options: PreserveSharedRowsPluginOptions = {}): Plugin {
  return (config: Config): Config => {
    if (options.enabled === false) return config;
    const guards = (list: string[] | undefined, slug: string) => !list || list.includes(slug);
    return {
      ...config,
      collections: (config.collections ?? []).map((collection) =>
        guards(options.collections, collection.slug)
          ? {
              ...collection,
              hooks: {
                ...collection.hooks,
                // First, so no other hook rewrites the rows before they are checked.
                beforeOperation: [collectionHook, ...(collection.hooks?.beforeOperation ?? [])],
              },
            }
          : collection,
      ),
      globals: (config.globals ?? []).map((global) =>
        guards(options.globals, global.slug)
          ? {
              ...global,
              hooks: {
                ...global.hooks,
                beforeOperation: [globalHook, ...(global.hooks?.beforeOperation ?? [])],
              },
            }
          : global,
      ),
    };
  };
}
