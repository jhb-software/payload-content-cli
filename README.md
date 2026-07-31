# @jhb.software/payload-content-cli

[![CI](https://github.com/jhb-software/payload-content-cli/actions/workflows/ci.yml/badge.svg)](https://github.com/jhb-software/payload-content-cli/actions/workflows/ci.yml)
[![npm version](https://img.shields.io/npm/v/@jhb.software/payload-content-cli.svg)](https://www.npmjs.com/package/@jhb.software/payload-content-cli)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

A CLI for managing Payload CMS content, built for AI agents.

> **Beta.** APIs and command surface may change before 1.0. Feedback and bug reports are very welcome.

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
- **Lexical richtext surgery** — add, remove, replace, and modify individual nodes without rewriting the entire tree
- **Profiles** — save connection settings for multiple Payload instances, switch with `--profile`
- **Agent skill** — `payload-content skill` installs a Claude Code skill file so agents know how to use the CLI
- **Editor validation** — pulled content references a generated JSON Schema so IDEs flag missing required fields, wrong types, and invalid enums in real-time

## Comparison to the official MCP plugin

The [official MCP plugin](https://github.com/payloadcms/payload-mcp) works well for simple use cases, especially for reading content, but it adds friction:

- **Setup required** — the MCP plugin needs to be installed and configured. The CLI only needs an API key.

Full comparison:

|                    | MCP plugin (as of 05/2026)                             | @jhb.software/payload-content-cli                      |
| ------------------ | ------------------------------------------------------ | ------------------------------------------------------ |
| Tool scaling       | One tool per operation per collection — bloats quickly | Collection-agnostic commands — fixed tool count        |
| REST API parity    | Partial — limited query parameters                     | Full — all Payload REST API parameters supported       |
| Operations         | Missing `count`, versions, and others                  | All collection + global operations                     |
| Read a document    | Good — single tool call                                | Good — `find` or read pulled JSON                      |
| Update one field   | OK — full document round-trip                          | Good — edit one field in a file                        |
| Edit richtext      | Bad — agent must construct entire Lexical tree         | Good — `lexical add/replace/remove` for surgical edits |
| Bulk edits         | Bad — one API call per document                        | Good — edit files, push once                           |
| Conflict detection | None                                                   | Built-in — manifest-based diffing                      |
| Dry run            | Not possible                                           | `push --dry-run`                                       |
| Offline work       | Not possible                                           | `status` works without network                         |
| Setup              | MCP plugin to install and configure                    | Just an API key                                        |
| Token cost         | High                                                   | Low                                                    |

The CLI and MCP aren't mutually exclusive. While the MCP plugin is a great fit for simple use cases, the CLI is a better fit for more complex use cases, especially when you need to edit content.

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
import { listReadableEntities, getEntitySchema, getBlockSchema } from "@jhb.software/payload-content-cli/plugin";

const { collections, globals } = await listReadableEntities({ req });
const { fields } = await getEntitySchema({ req, type: "collection", slug: "pages" });
// → [{ name: "layout", type: "blocks", blockSlugs: ["hero", "cta"] }, ...]

const [hero] = await getBlockSchema({ req, slugs: ["hero"] });
```

Entity schemas name the blocks a field accepts rather than inlining them, so an agent can ask for just the ones it needs — the schema stays small, and detail unfolds one call at a time. Access control is respected throughout: entities the request can't read are omitted or throw, matching Payload's own rules. Fields carry what an agent needs to write valid content — required, localized, virtual, `filterOptions`, and a per-field summary of the richtext nodes a Lexical editor accepts.

See [USAGE.md](USAGE.md#build-custom-tools-with-the-schema-api) for the full API.

The Lexical toolkit behind the `lexical` commands ships the same way, under `@jhb.software/payload-content-cli/lexical` — one `editRichText(doc, field, edit)` call addresses a node, edits it, validates the result, and writes the field back, without rewriting the document. Pure functions, no filesystem or network, so fetching and saving (and the access, locale, and draft decisions that come with them) stay in your code. See [USAGE.md](USAGE.md#edit-richtext-from-your-own-code).

## Getting started

See [USAGE.md](USAGE.md) for setup instructions and the full command reference.

For a quickstart: the `payload-content skill` command installs an Agent skill file so agents know how to use the CLI.

## Roadmap

See [ROADMAP.md](ROADMAP.md) for ideas and open questions.

## Footer

This project is an unofficial, open source project and free to use. It is not affiliated with Payload CMS or its official MCP plugin. If you encounter any issues or have any feedback, please open an issue or pull request.
