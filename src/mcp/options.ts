import type { PayloadRequest } from "payload";
import { z } from "zod/v3";
import { localeProblem } from "../locales.js";

/** The hooks for what differs between apps. Every content tool takes the same ones. */
export interface McpContentToolsOptions {
  /**
   * Pick the locale to read and write. Receives the `locale` the agent passed,
   * if any. Use it when the right default isn't Payload's default locale, e.g.
   * a multi-tenant site whose tenants each have their own primary locale.
   * Throw to refuse a locale; the agent gets the message.
   */
  resolveLocale?: (
    req: PayloadRequest,
    target: { collection: string; id?: string | number; locale?: string },
  ) => string | undefined | Promise<string | undefined>;
  /** Refuse an id before it is looked up, by returning the message to show the agent. */
  checkId?: (
    req: PayloadRequest,
    target: { collection: string; id: string | number },
  ) => string | undefined | Promise<string | undefined>;
}

/**
 * The locale to read or write, with `*` read as `"all"` as Payload does. One
 * the app doesn't have is refused (see `localeProblem`).
 */
export async function pickLocale(
  options: McpContentToolsOptions,
  req: PayloadRequest,
  target: { collection: string; id?: string | number; locale?: string },
): Promise<string | undefined> {
  const locale = options.resolveLocale ? await options.resolveLocale(req, target) : target.locale;
  if (!locale) return undefined;
  const localization = req.payload.config.localization;
  const fromHook = locale !== target.locale;
  // Without localization, Payload reads and writes the one value either way.
  if (!localization && fromHook) return undefined;
  const problem = localeProblem(locale, localization ? localization.localeCodes : null, "locale");
  if (problem && fromHook) {
    // The app's own hook picked it; the agent can't fix that.
    throw new Error(`The app's resolveLocale picked "${locale}", which this app doesn't have.`);
  }
  if (problem) throw new Error(problem);
  return locale === "*" ? "all" : locale;
}

/**
 * An object argument. Some MCP clients send nested objects as JSON strings, so
 * a string is accepted and parsed (see `toObject`).
 */
export const jsonObject = z.union([z.record(z.unknown()), z.string()]);

export function toObject(
  value: Record<string, unknown> | string | undefined,
  name: string,
): Record<string, unknown> | undefined {
  if (typeof value !== "string") return value;
  if (!value.trim()) return undefined;
  let parsed: unknown;
  try {
    parsed = JSON.parse(value);
  } catch {
    throw new Error(`${name} is not valid JSON.`);
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw new Error(`${name} must be a JSON object.`);
  }
  return parsed as Record<string, unknown>;
}
