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
  hasSharedRows,
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
}

/** Every refusal's message starts with this. */
const REFUSAL_PREFIX = "Refused to replace shared rows.";

/**
 * Whether `error` is this plugin's refusal, so a caller can add advice for its
 * own transport (such as how to opt out) to the message.
 */
export function isSharedRowRefusal(error: unknown): error is Error {
  return error instanceof Error && error.message.startsWith(REFUSAL_PREFIX);
}

function describe(violation: SharedRowViolation): string {
  return (
    `${violation.path}: every row was sent without an id, so all ${violation.existingIds.length} ` +
    `existing row(s) would be replaced rather than edited, discarding the translations the other ` +
    `locales hold for them. Send each row you keep back with its id ` +
    `(${violation.existingIds.join(", ")}); rows without an id are then added.`
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
  error.message = [REFUSAL_PREFIX, ...violations.map(describe)].join(" ");
  throw error;
}

type Data = Record<string, unknown>;

const isRecord = (doc: unknown): doc is Data => typeof doc === "object" && doc !== null;

/** Whether a write is worth reading the stored document for. */
const shouldCheck = (data: unknown, req: PayloadRequest): data is Data =>
  Boolean(req.payload.config.localization) &&
  req.context?.[ALLOW_SHARED_ROW_REPLACEMENT] !== true &&
  containsObjectArray(data);

/** Whether the write itself skips access control; the Local API's default is to. */
const callerOverridesAccess = (args: unknown): boolean =>
  (args as { overrideAccess?: boolean }).overrideAccess !== false;

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
// That read runs before Payload's access check, so it uses the caller's access:
// a refusal names row ids, and must not for a document the caller can't read.
const collectionHook: CollectionBeforeOperationHook = async ({ args, operation, collection }) => {
  if (operation !== "update") return args;
  const { req, data } = args as { req: PayloadRequest; data?: unknown };
  if (!shouldCheck(data, req)) return args;

  const read = {
    collection: collection.slug,
    depth: 0,
    draft: Boolean((args as { draft?: boolean }).draft),
    locale: req.locale,
    overrideAccess: callerOverridesAccess(args),
    req,
  } as const;
  const { id, where } = args as { id?: number | string; where?: Where };
  if (id !== undefined) {
    const existing = await req.payload.findByID({ ...read, id, disableErrors: true });
    check(collection.fields, data, existing, req, collection.slug, id);
  } else if (where !== undefined) {
    // Every matching document, reading only the fields the write touches.
    const select = Object.fromEntries(Object.keys(data).map((key) => [key, true as const]));
    const { docs } = await req.payload.find({ ...read, where, select, pagination: false });
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
    overrideAccess: callerOverridesAccess(args),
    req,
  });
  check(global.fields, data, existing, req, global.slug);
  return args;
};

/**
 * Refuses an update that sends every row of a shared array or blocks field
 * without its id, which would replace the rows and discard the other locales'
 * translations of them. Inert without localization, and on collections and
 * globals without a shared field. Runs after the app's other plugins, so it
 * also guards the collections they add.
 *
 * @example
 * ```ts
 * export default buildConfig({ plugins: [preserveSharedRowsPlugin()] })
 * ```
 */
export function preserveSharedRowsPlugin(options: PreserveSharedRowsPluginOptions = {}): Plugin {
  const plugin: Plugin = (config: Config): Config => {
    const configBlocks = config.blocks as Block[] | undefined;
    const guards = (list: string[] | undefined, slug: string, fields: Field[]) =>
      (!list || list.includes(slug)) && hasSharedRows(fields, configBlocks);
    return {
      ...config,
      collections: (config.collections ?? []).map((collection) =>
        guards(options.collections, collection.slug, collection.fields)
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
        guards(options.globals, global.slug, global.fields)
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
  // Payload runs plugins by ascending order (default 0).
  plugin.order = 1000;
  return plugin;
}
