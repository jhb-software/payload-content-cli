/**
 * Boots a real Payload on in-memory SQLite for the MCP tool tests, so access,
 * drafts and locales behave exactly as they do in an app.
 */

import { sqliteAdapter } from "@payloadcms/db-sqlite";
import { buildConfig, createLocalReq, getPayload, type Config, type Payload } from "payload";
import type { McpTool } from "../index.js";

export const open = {
  read: () => true,
  create: () => true,
  update: () => true,
  delete: () => true,
};

/** `key` keeps each test file's Payload apart in Payload's instance cache. */
export function boot(key: string, config: Omit<Config, "db" | "secret">): Promise<Payload> {
  return getPayload({
    key,
    config: buildConfig({
      secret: "test-secret",
      db: sqliteAdapter({ client: { url: ":memory:" } }),
      typescript: { autoGenerate: false },
      ...config,
    }),
  });
}

/** Call a tool as `user` (anonymous by default) and return what the agent reads. */
export async function call(
  payload: Payload,
  tool: McpTool,
  args: Record<string, unknown>,
  user?: Record<string, unknown>,
): Promise<any> {
  const req = await createLocalReq(user ? { user: user as never } : {}, payload);
  const { text } = (await tool.handler(args, req)).content[0];
  try {
    return JSON.parse(text);
  } catch {
    return text;
  }
}

export function toolNamed(tools: McpTool[], name: string): McpTool {
  const tool = tools.find((candidate) => candidate.name === name);
  if (!tool) throw new Error(`No tool "${name}"`);
  return tool;
}
