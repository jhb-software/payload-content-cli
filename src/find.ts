import * as fs from "node:fs/promises";
import * as path from "node:path";
import type { Config } from "./config.js";
import type { SelectType } from "./select.js";

export interface FindOptions {
  collection?: string;
  select?: SelectType;
  where?: Record<string, string>;
}

export interface FindResult {
  filePath: string;
  fields: Record<string, string>;
}

function getByDotPath(obj: unknown, dotPath: string): unknown {
  let current = obj;
  for (const segment of dotPath.split(".")) {
    if (current === null || current === undefined || typeof current !== "object") return undefined;
    current = (current as Record<string, unknown>)[segment];
  }
  return current;
}

function matchesWhere(doc: Record<string, unknown>, where: Record<string, string>): boolean {
  for (const [field, value] of Object.entries(where)) {
    const docVal = getByDotPath(doc, field);
    if (docVal === undefined || docVal === null) return false;
    if (!String(docVal).toLowerCase().includes(value.toLowerCase())) return false;
  }
  return true;
}

function formatValue(val: unknown): string {
  if (val === undefined || val === null) return "-";
  if (typeof val === "string") return val;
  if (typeof val === "number" || typeof val === "boolean") return String(val);
  return JSON.stringify(val);
}

async function scanDir(
  dir: string,
  outputDir: string,
  options: FindOptions,
): Promise<FindResult[]> {
  const results: FindResult[] = [];
  let entries;
  try {
    entries = await fs.readdir(dir);
  } catch {
    return results;
  }

  for (const entry of entries) {
    if (!entry.endsWith(".json") || entry.startsWith("_") || entry.startsWith(".")) continue;

    const filePath = path.join(dir, entry);
    try {
      const raw = await fs.readFile(filePath, "utf-8");
      const doc = JSON.parse(raw) as Record<string, unknown>;

      if (options.where && !matchesWhere(doc, options.where)) continue;

      const fields: Record<string, string> = {};
      if (options.select) {
        const isExclude = Object.values(options.select).every((v) => !v);
        if (isExclude) {
          for (const key of Object.keys(doc)) {
            if (!(key in options.select)) {
              fields[key] = formatValue(doc[key]);
            }
          }
        } else {
          for (const [field, included] of Object.entries(options.select)) {
            if (included) {
              fields[field] = formatValue(getByDotPath(doc, field));
            }
          }
        }
      }

      results.push({
        filePath: path.relative(outputDir, filePath),
        fields,
      });
    } catch {
      // skip invalid JSON
    }
  }

  return results;
}

export async function find(config: Config, options: FindOptions = {}): Promise<FindResult[]> {
  const outputDir = path.resolve(config.outputDir);
  const results: FindResult[] = [];

  if (options.collection) {
    const collectionDir = path.join(outputDir, "collections", options.collection);
    const globalDir = path.join(outputDir, "globals", options.collection);

    results.push(...(await scanDir(collectionDir, outputDir, options)));
    results.push(...(await scanDir(globalDir, outputDir, options)));
  } else {
    for (const topDir of ["collections", "globals"]) {
      const base = path.join(outputDir, topDir);
      let slugs;
      try {
        slugs = await fs.readdir(base);
      } catch {
        continue;
      }
      for (const slug of slugs) {
        const dir = path.join(base, slug);
        const stat = await fs.stat(dir);
        if (stat.isDirectory()) {
          results.push(...(await scanDir(dir, outputDir, options)));
        }
      }
    }
  }

  return results;
}

export function printFindResults(results: FindResult[]): void {
  if (results.length === 0) {
    console.log("No documents found.");
    return;
  }

  for (const result of results) {
    const parts = [result.filePath];
    for (const val of Object.values(result.fields)) {
      parts.push(val);
    }
    console.log(parts.join("  "));
  }
}
