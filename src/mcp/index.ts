/**
 * MCP tools for `@payloadcms/plugin-mcp` (`@jhb.software/payload-content-cli/mcp`).
 *
 *   import { updateRichTextTool } from '@jhb.software/payload-content-cli/mcp'
 *   mcpPlugin({ mcp: { tools: [updateRichTextTool()] } })
 *
 * The tools run inside Payload, with the request's user and access control, and
 * build on the `./lexical` toolkit.
 */

export { createMcpContentTools } from "./tools.js";
export type { McpContentToolsOptions } from "./options.js";
export { updateRichTextTool } from "./updateRichText.js";
export type { UpdateRichTextOptions } from "./updateRichText.js";
export type { McpTool, McpToolResult } from "./result.js";
