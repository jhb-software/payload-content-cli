import { findTool } from "./find.js";
import type { McpContentToolsOptions } from "./options.js";
import type { McpTool } from "./result.js";
import { getBlockSchemaTool, getEntitySchemaTool, listEntitiesTool } from "./schema.js";
import { updateRichTextTool } from "./updateRichText.js";
import { createTool, updateTool } from "./write.js";

/**
 * The content tools for `@payloadcms/plugin-mcp`, in the order an agent uses
 * them: discover, read the schema, read content, write. Every tool runs with
 * the request's user and Payload's access control.
 */
export function createMcpContentTools(options: McpContentToolsOptions = {}): McpTool[] {
  return [
    listEntitiesTool(),
    getEntitySchemaTool(),
    getBlockSchemaTool(),
    findTool(options),
    createTool(options),
    updateTool(options),
    updateRichTextTool(options),
  ];
}
