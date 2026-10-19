---
title: One shared set of MCP content tools
type: feature
status: in-progress
---

# One shared set of MCP content tools

## Goal

Payload apps that expose their content over MCP each carry their own copy of the
generic content tools (`listEntities`, `getEntitySchema`, `getBlockSchema`, `find`,
`create`, `update`, `updateRichText`), and the copies drift. This package owns them
under the `./mcp` export, with small hooks for what genuinely differs between apps.
App-specific tools (page URLs, health checks, media upload, …) stay in the apps.

Design principles: agent-friendly and token-efficient, deep modules (small interface,
lots of behaviour behind it), progressive disclosure (cheap overview first, detail on
request). Tool descriptions lead with what the tool does and when to use it, and don't
lean on other tools' names.

## Decisions

- **One beta release with the whole toolset**, so every app migrates once and the tools
  share conventions (descriptions, error shape, `globals/<slug>`, draft defaults,
  hooks). The author publishes; agents never do.
- **Test in a real app before publishing**, via a local `link:` dependency that is not
  committed.
- **The shared-row guard lives in this package.** Any localized Payload app with
  non-localized `array`/`blocks` fields loses other locales' translations when rows are
  written back without their `id`.
- **Hooks are only added when an app needs them**: `resolveLocale` (e.g. a per-tenant
  default locale) and `checkId` (e.g. refusing malformed ids). Anything app-wide, such
  as filling a tenant on create, belongs in a Payload hook in the app, which covers every
  writer, not just MCP.
- Apps drop or replace a tool by filtering `createMcpContentTools()` on `name`, and add
  their own tools beside it. Tool names stay stable, since apps may grant access per
  tool name.

## Done

- `editAtPath(doc, path, operation, value?)` in `./lexical` (`src/lexical/path.ts`,
  compact views in `src/lexical/view.ts`): one dot path from a document to any node or
  value inside its rich text, through blocks into nested rich text. Operations `read`,
  `set`, `insert`, `delete`.
- `createMcpContentTools(options?)` (`src/mcp/tools.ts`) returns every tool;
  `updateRichTextTool` is the only other tool export. `McpContentToolsOptions`
  (`src/mcp/options.ts`) is `resolveLocale` + `checkId`.
- Schema tools (`src/mcp/schema.ts`) answer as a field tree (`src/mcp/schemaTree.ts`,
  legend in the tool description), system fields hidden.
- `find` (`src/mcp/find.ts`): drafts by default, `fallbackLocale: false`, capped limit,
  JSON-string `where`/`select`.
- `create`/`update` (`src/mcp/write.ts`): drafts by default, `_status` set only on
  entities with drafts, lean answers, Payload validation detail in the error message.
  Update by id and `updateGlobal` start from the latest draft, so `draft:false` publishes
  it together with `data`; only bulk update by `where` discards newer drafts, so only it
  has the `overwriteDraft` guard.
- `updateRichText` (`src/mcp/updateRichText.ts`): drafts by default, `overwriteDraft`
  guard (it reads the published version when publishing), refuses unknown block slugs
  and links/uploads to missing documents.
- Tools carry MCP `annotations`; stock `@payloadcms/plugin-mcp` drops them, so apps
  that want them patch it to forward them.
- `preserveSharedRowsPlugin(options?)` and `ALLOW_SHARED_ROW_REPLACEMENT` in `./plugin`
  (`src/plugin/preserveSharedRows.ts`, `src/plugin/sharedRows.ts`); defaults to every
  entity. `update` has `replaceRows` to opt out per call.
- `McpTool.parameters` is typed `Record<string, any>`: `@payloadcms/plugin-mcp` types it
  against its own zod 3 install, and this package's `zod/v3` shapes don't unify with it
  as types (TS2589), though they are identical at runtime. Build shapes with
  `import { z } from "zod/v3"`.
- Integration tests boot real Payload on in-memory SQLite (`src/mcp/__tests__/payload.ts`).
  SQLite ids are numbers, and blocks in fixtures need a stored `id`.
- README, USAGE ("Add the MCP content tools", "Keep translations of shared rows") and
  CHANGELOG are updated.

## Next

1. **Local test in a real app**: point it at this package with a `link:` dependency
   (don't commit it), replace its own generic tools with `createMcpContentTools`, run its
   checks, and exercise the tools against a local CMS. Revert the link afterwards.
2. **Beta release** by the author.
3. **App migrations** follow the handoff in each app's own repository, not here.

## Known gaps

- The reference check only sees `{relationTo, value}` pairs (links, upload nodes,
  polymorphic relationships). A plain id in a block's upload or relationship field
  isn't checked; that needs the block schema.
- Rich text that is `null` (never edited) can be started by path only when it is a
  top-level field; a `null` rich-text field inside a block or array row needs a
  whole-value `set` of `{root: {children: [...]}}` on the field.
- Upstream: the shared-row data loss is a Payload footgun; the issue is drafted in
  `plans/payload-issue-shared-row-data-loss.md` for the author to file.

## Working rules

- Commit to the current branch with conventional commit messages and no body; never
  push, never publish.
- Run `pnpm test`, `pnpm typecheck`, `pnpm lint`, `pnpm format:check` before each commit.
