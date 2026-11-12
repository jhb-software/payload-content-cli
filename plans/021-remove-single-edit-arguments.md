---
title: "Remove updateRichText's deprecated single-edit arguments"
type: breaking
status: draft
---

# Remove `updateRichText`'s single-edit arguments

`updateRichText` takes `edits`, and still accepts a single `path`, `operation`, `value` and `text` (answering in the old single-result shape) for clients that cached the old schema.

## Why they're still there

- Claude.ai caches a connector's tool list for about an hour, ignores `notifications/tools/list_changed`, and keeps the old schema in conversations opened before the change.
- ChatGPT custom connectors only pick up a change after a manual Refresh and a new conversation. Published apps keep the last approved schema until an update passes review.
- The MCP SDK checks arguments against the advertised schema and drops keys it doesn't name, so old fields must stay in the schema to reach the handler.

## When

Once the apps using the tools have run the `edits` version for a few weeks, and any ChatGPT app review has gone through.

## Change

- Drop `path`, `operation`, `value`, `text` from `parameters` in `src/mcp/updateRichText.ts`, make `edits` required, and remove the `single` path from `toEdits`, `applyEdit` and the handler.
- Replace the test "still takes one edit as path and operation…" with one asserting the old shape is refused with a message naming `edits`.
- Remove the paragraph about deprecated arguments from USAGE.md; changelog line as `feat!`.
