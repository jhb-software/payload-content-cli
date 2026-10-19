import type { PayloadRequest } from "payload";

/** What `@payloadcms/plugin-mcp` takes in `mcp.tools`, and what a tool handler returns. */
export interface McpToolResult {
  content: { type: "text"; text: string }[];
}

export interface McpTool {
  name: string;
  description: string;
  /**
   * A zod 3 shape (`zod/v3`). Typed loosely on purpose: `@payloadcms/plugin-mcp`
   * types it against its own zod install, and shapes from two zod installs are
   * the same at runtime but don't unify as types (TS2589).
   */
  parameters: Record<string, any>;
  handler: (args: Record<string, unknown>, req: PayloadRequest) => Promise<McpToolResult>;
}

export function jsonResult(data: unknown): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

export function errorResult(message: string): McpToolResult {
  return jsonResult({ error: message });
}
