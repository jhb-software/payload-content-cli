# @jhb.software/payload-content-cli

[![CI](https://github.com/jhb-software/payload-content-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/jhb-software/payload-content-cli/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@jhb.software/payload-content-cli.svg)](https://www.npmjs.com/package/@jhb.software/payload-content-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Helpers that let AI agents work efficiently with Payload CMS content: a CLI, MCP tools, a Payload plugin, and a Lexical rich-text toolkit.

> **Beta.** APIs and command surface may change before 1.0. The `./mcp` tools and `./lexical` are experimental and may change in any minor release. Feedback and bug reports are very welcome.

## What's in the package

| Entry point                                 | For                                       | What it gives you                                                                                                                                                           |
| ------------------------------------------- | ----------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `payload-content` CLI                       | Agents with a shell (Claude Code, Codex…) | Every REST operation as a command, `pull`/`push` content sync, rich-text editing by path, an agent skill                                                                    |
| [`/mcp`](#mcp-tools)                        | Apps running `@payloadcms/plugin-mcp`     | Seven collection-agnostic content tools: discover, read schemas, find, create, update, edit rich text                                                                       |
| [`/plugin`](#schema-api-for-custom-tools)   | Your Payload config                       | The schema endpoint the CLI reads, the schema API for your own tools, and `preserveSharedRowsPlugin`, which keeps other locales' translations of array and blocks rows safe |
| [`/lexical`](#rich-text-from-your-own-code) | Your own scripts and tools                | Read and edit Lexical rich text by dot path; pure functions, no I/O                                                                                                         |

## Quickstart

```bash
# Install
pnpm add -D @jhb.software/payload-content-cli

# Configure (in your project root)
cat > .env << 'EOF'
PAYLOAD_URL=http://localhost:3000
PAYLOAD_API_KEY=your-api-key-here
PAYLOAD_AUTH_COLLECTION=api-keys
PAYLOAD_OUTPUT_DIR=content      # optional: directory for pulled content (default: content)
EOF

# Verify and discover
pnpm payload-content me
pnpm payload-content discover

# Install the agent skill so Claude Code knows how to use the CLI
pnpm payload-content skill
```

See [USAGE.md](USAGE.md) for the full command reference.

## Why?

Agents work best with CLIs — structured commands, predictable JSON output, and composable flags. This CLI gives agents (and humans) full access to Payload's REST API without writing any integration code:

- **Discovery** — `me` and `discover` tell the agent what's available before it does anything
- **Full REST API parity** — all Payload query parameters (`where`, `select`, `depth`, `locale`, `joins`, `populate`, `draft`, etc.) exposed as CLI flags
- **Every operation** — `find`, `create`, `update`, `delete`, `count`, `versions`, `restore`, `duplicate`, `upload`, plus raw `request` for custom endpoints
- **Bulk upload** — upload a directory or glob of media files with concurrent uploads, shared metadata, and dry-run support
- **Lexical richtext surgery** — read, set, insert, and delete any node or value by one dot path, through blocks into nested rich text, without rewriting the entire tree
- **Profiles** — save connection settings for multiple Payload instances, switch with `--profile`
- **Agent skill** — `payload-content skill` installs a Claude Code skill file so agents know how to use the CLI
- **Editor validation** — pulled content references a generated JSON Schema so IDEs flag missing required fields, wrong types, and invalid enums in real-time

## Comparison to the official MCP plugin

[`@payloadcms/plugin-mcp`](https://payloadcms.com/docs/plugins/mcp) is a good base for reading content and for your own MCP tools, prompts, and resources. Its stock tools get expensive once agents edit content. This package covers that with the CLI and with [`./mcp` tools](USAGE.md#add-the-mcp-content-tools) that run on top of the plugin:

|                  | plugin-mcp 3.91.0 stock tools                                                                | This package                                                                          |
| ---------------- | -------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| Tools and tokens | Four tools per collection, two per global; write tools embed the full schema, blocks inlined | Seven collection-agnostic tools; compact schema trees, blocks fetched on demand       |
| Rich text        | Rewrite the whole Lexical JSON field                                                         | Read and edit one node or value by dot path, through nested blocks                    |
| Drafts, locales  | Writes publish unless `draft: true`; reads apply locale fallback                             | Writes go to drafts by default; reads show what a locale stores; shared rows kept     |
| CLI extras       | —                                                                                            | `pull` / `push` with dry run and conflict detection, bulk `upload`, `count`, versions |
| Setup            | Plugin in the Payload config, API keys with per-tool permissions                             | CLI: an API key. `./mcp`: one line in the plugin's `mcp.tools`                        |

## MCP tools

If your agents reach Payload over MCP rather than a shell, `/mcp` adds a small set of content tools to [`@payloadcms/plugin-mcp`](https://payloadcms.com/docs/plugins/mcp):

```ts
import { createMcpContentTools } from "@jhb.software/payload-content-cli/mcp";

mcpPlugin({ collections: {}, mcp: { tools: [...createMcpContentTools()] } });
```

`listEntities`, `getEntitySchema`, `getBlockSchema`, `find`, `create`, `update` and `updateRichText` cover every collection and global, run with the request's user and Payload's access control, and save drafts unless told to publish.

They are aligned with the CLI, so an agent that knows one knows the other. Rich text reads as the same outline in both, one line per node, each starting with its path (`content.3 block alert [1 link]: See safety`), and `updateRichText` and the `lexical` commands edit and link at those paths with the same engine. The schema tools answer from the same projection the CLI's `_schema.json` comes from. Most differences come from where each runs: the CLI calls the REST API and can work on pulled files, while the MCP tools run inside Payload and read without locale fallback. See [USAGE.md](USAGE.md#add-the-mcp-content-tools).

## Content sync

For bulk edits or offline workflows, the CLI can pull content to the filesystem as JSON files, let you edit locally, and push changes back:

```
payload-content pull        →  JSON files on disk
  edit files                →  standard file tools
payload-content push        →  changes sent to CMS
```

The manifest tracks what was synced, so `status` shows local changes offline and `push` detects conflicts against the remote. Use `push --dry-run` to preview before committing.

`pull`, `push`, `status`, `diff`, and `find --local` take `--json` for scripted use — stdout carries only the result document, progress goes to stderr. Exit codes are part of the contract (`2` means push conflicts, distinct from `1` for errors); both are documented in [USAGE.md](USAGE.md#exit-codes).

For small, targeted changes (update a title, toggle a status field), the CRUD commands hit the API directly without any local files.

## Schema API for custom tools

The optional plugin also exports its schema introspection as plain functions, so you can build your own tools — an MCP server, a code generator, a CLI of your own — against the same projection the CLI uses. Each takes a Payload `req` and runs in-process, no HTTP round-trip:

```ts
import {
  listReadableEntities,
  getEntitySchema,
  getBlockSchema,
} from "@jhb.software/payload-content-cli/plugin";

const { collections, globals } = await listReadableEntities({ req });
const { fields } = await getEntitySchema({ req, type: "collection", slug: "pages" });
// → [{ name: "layout", type: "blocks", blockSlugs: ["hero", "cta"] }, ...]

const [hero] = await getBlockSchema({ req, slugs: ["hero"] });
```

Entity schemas name the blocks a field accepts rather than inlining them, so an agent can ask for just the ones it needs — the schema stays small, and detail unfolds one call at a time. Access control is respected throughout: entities the request can't read are omitted or throw, matching Payload's own rules. Fields carry what an agent needs to write valid content — required, localized, virtual, `filterOptions`, conditions, and a per-field summary of the richtext nodes a Lexical editor accepts.

See [USAGE.md](USAGE.md#build-custom-tools-with-the-schema-api) for the full API.

The plugin also exports `preserveSharedRowsPlugin()`, which refuses API writes that would silently drop other locales' translations of array and blocks rows ([USAGE.md](USAGE.md#keep-translations-of-shared-rows)). It guards every writer, the CLI and the MCP tools included.

## Rich text from your own code

The Lexical toolkit behind the `lexical` commands and `updateRichText` ships as `@jhb.software/payload-content-cli/lexical`: `readAtPath(doc, path)` and `editAtPath(doc, path, operation, value?)` read or change anything inside rich text by the same dot paths, and an edit returns a validated, changed copy of the document. Pure functions, no filesystem or network, so fetching and saving (and the access, locale, and draft decisions that come with them) stay in your code. See [USAGE.md](USAGE.md#edit-richtext-from-your-own-code).

## Getting started

See [USAGE.md](USAGE.md) for setup instructions and the full command reference.

For a quickstart: the `payload-content skill` command installs an Agent skill file so agents know how to use the CLI.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for ideas and open questions.

## Footer

This project is an unofficial, open source project and free to use. It is not affiliated with Payload CMS or its official MCP plugin. If you encounter any issues or have any feedback, please open an issue or pull request.
