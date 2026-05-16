---
title: Agent DX improvements
type: feature
status: draft
priority: medium
---

# Agent DX improvements

Research findings on what agents need from the CLI (2026-03-18).

## High impact

### `create` command — scaffold new documents from schema

Agents can't create new content without finding an existing doc as a template. A `create` command that generates a blank document from `_schema.json` with required fields stubbed would remove this friction.

```bash
pnpm dev create posts
# → creates content/collections/posts/new-post.json with required fields stubbed
```

### Batch field updates

"Update meta description on all 50 pages" requires 200+ individual commands. No way to apply a field change across documents in one operation.

### Lexical ↔ Markdown round-trip

Agents are much better at editing Markdown than Lexical JSON trees. A conversion layer would be the single biggest richtext editing efficiency gain, but significant implementation effort.

### Schema introspection without pull

Agents can't learn field shapes without pulling content first. A `schema <collection>` command hitting `/api/schema` directly would help orientation.

```bash
pnpm dev schema pages
# → prints field names, types, required, localized, virtual
```

## Quick wins

- Better error messages with field-level detail from Payload API responses (e.g. "field 'meta.title' is required" not "validation failed")
- Structured summaries from `pull`/`push` (counts, collections, errors)

## Not urgent but interesting

- MCP server wrapper around the CLI — unique because of the file-based staging model (no other CMS MCP does pull/edit/push)
- `--json` output mode on all commands (research recommends auto-detect non-TTY → JSON)

## Sources

- [Agent CLI design patterns — InfoQ](https://www.infoq.com/articles/ai-agent-cli/)
- [Rewrite your CLI for AI agents — Justin Poehnelt](https://justin.poehnelt.com/posts/rewrite-your-cli-for-ai-agents/)
- [Sanity Agent Context](https://github.com/sanity-io/agent-context)
- [dotCMS MCP Server](https://dev.dotcms.com/docs/mcp-server)
