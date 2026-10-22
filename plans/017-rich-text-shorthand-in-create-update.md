---
title: Rich-text shorthand in CLI create/update data
type: feature
status: draft
priority: high
---

# Rich-text shorthand in CLI create/update data

The MCP `create` and `update` take a rich-text field as a list of nodes in the shorthand `lexical insert` already accepts (`{"type":"p","text":"…"}`, `{"type":"h2","text":"…"}`, `{"type":"ul","items":[…]}`, `{"type":"upload","value":"<id>"}`, …), or as `{root: {children}}`. The CLI's `create`/`update --data`/`--file` need the full Lexical tree, so agents hand-write hundreds of lines of Lexical JSON for a new document.

Supersedes plan 008 (Markdown input): one input format, shared with the MCP and `lexical insert`.

## Proposal

Turn rich-text values in `create`/`update` data into Lexical, the same as the MCP:

```json
{ "title": "…", "content": [{ "type": "h2", "text": "Intro" }, { "type": "p", "text": "…" }] }
```

- `src/mcp/richTextData.ts` `hydrateRichText` walks Payload `Field` configs. Rewrite it over `FieldSchema` (from `getEntitySchema` on the server, `/content-cli/schema` in the CLI) so both share it. The node builders (`src/lexical/view.ts` `toRichText`) already run on the client.
- Without the plugin the CLI can't tell which fields are rich text. A list of shorthand nodes in the data then fails with a message to install the plugin; don't guess from the value's shape (blocks rows look alike).
- A full Lexical tree passes through unchanged, so existing files keep working.
- Not `push`: pulled files are already full trees.
