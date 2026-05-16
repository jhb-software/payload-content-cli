import * as fs from "node:fs/promises";
import { parseSelect } from "./select.js";
import type { SelectType } from "./select.js";

// ── Option parsing helpers ──────────────────────────────────────────

/** Common options shared across most CRUD commands. */
export interface CommonOpts {
  depth?: number;
  locale?: string;
  fallbackLocale?: string;
  draft?: boolean;
  select?: SelectType;
  populate?: Record<string, unknown>;
  joins?: Record<string, unknown>;
  trash?: boolean;
}

/** Pagination options used by find/versions. */
export interface PaginationOpts {
  limit?: number;
  page?: number;
  sort?: string;
  pagination?: boolean;
}

/** Publish options used by create/update/upload. */
export interface PublishOpts {
  autosave?: boolean;
  publishSpecificLocale?: string;
  publishAllLocales?: boolean;
  unpublishAllLocales?: boolean;
}

/**
 * Parse raw Commander opts into typed CommonOpts.
 * Handles Number coercion for depth, JSON parsing for select/populate/joins.
 */
export function parseCommonOpts(opts: Record<string, unknown>): CommonOpts {
  return {
    depth: opts.depth !== undefined ? Number(opts.depth) : undefined,
    locale: opts.locale as string | undefined,
    fallbackLocale: opts.fallbackLocale as string | undefined,
    draft: opts.draft as boolean | undefined,
    select: opts.select ? parseSelect(opts.select as string) : undefined,
    populate: opts.populate ? parseJson(opts.populate as string, "--populate") : undefined,
    joins: opts.joins ? parseJson(opts.joins as string, "--joins") : undefined,
    trash: opts.trash as boolean | undefined,
  };
}

/** Parse raw Commander opts into typed PaginationOpts. */
export function parsePaginationOpts(opts: Record<string, unknown>): PaginationOpts {
  return {
    limit: opts.limit !== undefined ? Number(opts.limit) : undefined,
    page: opts.page !== undefined ? Number(opts.page) : undefined,
    sort: opts.sort as string | undefined,
    pagination: opts.pagination as boolean | undefined,
  };
}

/** Parse raw Commander opts into typed PublishOpts. */
export function parsePublishOpts(opts: Record<string, unknown>): PublishOpts {
  return {
    autosave: opts.autosave as boolean | undefined,
    publishSpecificLocale: opts.publishSpecificLocale as string | undefined,
    publishAllLocales: opts.publishAllLocales as boolean | undefined,
    unpublishAllLocales: opts.unpublishAllLocales as boolean | undefined,
  };
}

// ── JSON / data helpers ─────────────────────────────────────────────

export function parseJson(raw: string, label: string): Record<string, unknown> {
  try {
    return JSON.parse(raw);
  } catch {
    console.error(`Error: ${label} must be valid JSON.`);
    process.exit(1);
  }
}

export async function readDataFile(filePath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(filePath, "utf-8");
    return JSON.parse(raw);
  } catch {
    console.error(`Error: could not read or parse ${filePath}`);
    process.exit(1);
  }
}

/**
 * Resolve document data from --data or --file flags.
 * Exits with an error if neither is provided.
 */
export async function resolveData(opts: Record<string, unknown>): Promise<Record<string, unknown>> {
  if (opts.file) return readDataFile(opts.file as string);
  if (opts.data) return parseJson(opts.data as string, "--data");
  console.error("Error: provide --data or --file.");
  process.exit(1);
}

// ── Action wrapper ──────────────────────────────────────────────────

/**
 * Wraps a command action handler with consistent error handling.
 * Catches errors, prints the message, and exits with code 1.
 */
export function wrapAction<A extends unknown[]>(
  fn: (...args: A) => Promise<void>,
): (...args: A) => Promise<void> {
  return async (...args: A) => {
    try {
      await fn(...args);
    } catch (error) {
      console.error("Error:", (error as Error).message);
      process.exit(1);
    }
  };
}
