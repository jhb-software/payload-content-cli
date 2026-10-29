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
  /**
   * MCP tool hints (`readOnlyHint`, …) that let a client decide how much
   * confirmation a call needs. `@payloadcms/plugin-mcp` passes them on from v4;
   * on 3.x only with a patch (see USAGE.md).
   */
  annotations?: {
    title?: string;
    readOnlyHint?: boolean;
    destructiveHint?: boolean;
    idempotentHint?: boolean;
    openWorldHint?: boolean;
  };
  handler: (args: Record<string, unknown>, req: PayloadRequest) => Promise<McpToolResult>;
}

export function jsonResult(data: unknown): McpToolResult {
  return { content: [{ type: "text", text: JSON.stringify(data) }] };
}

/** Text meant for the model to read rather than parse, e.g. a schema tree. */
export function textResult(text: string): McpToolResult {
  return { content: [{ type: "text", text }] };
}

/** `details`: what the model may need besides the message, e.g. what to try instead. */
export function errorResult(message: string, details?: string): McpToolResult {
  return jsonResult(details === undefined ? { error: message } : { error: message, details });
}
