---
title: "getEntitySchema path, app read-only fields, and nothing-matched notes"
type: feat
status: draft
---

# `getEntitySchema` path, app read-only fields, nothing-matched notes

From the afx-site handoff (afx-site PR #606 wraps the MCP tools in `apps/cms/src/plugins/mcp-content/contentTools.ts`). Three things it works around belong in the package. afx-site agreed to the scope below. Ship item 1 alone as `0.6.0-beta.6`; items 2 and 3 can follow in a later beta.

## 1. `path` on `getEntitySchema` (beta.6)

Schema trees get big: on afx-site staging `products` is ~5 KB and `header` 5.4 KB, both the package's own text with blocks as slugs only. `header`'s size comes from nesting (`links[] → columns[] → items[]`), a link shape written out at each level, repeated `[when …]` rules and identical `cta` groups. An agent editing `announcementBar` or `buttons` would pay ~1 KB instead of 5.

**Shape:** `path` takes a dot path or a list of them, like `find`'s `path`.

- No `path`: the full tree, byte for byte as today.
- Segments are field names through groups, named tabs and arrays. Blocks stay references: `path: "layout"` shows the slugs, and `getBlockSchema` is the way into a block's fields. No block-slug segments.
- One section per path, headed `products.billing (group)`, sections joined by a blank line.
- `[when …]` rules keep their sibling-relative form (`/a` and `^a` stay correct inside a slice).
- The `read-only:` line lists only read-only fields under the path, relative to it.
- An unknown path is refused with the field names that exist at that level, reusing `explainMissingPath` (`src/mcp/missingPath.ts`) so `find` and `getEntitySchema` word the same mistake the same way. Ranking close names first is fine; exact wording isn't promised to callers.
- The legend stays in the tool description.

**Where:** `entityArgs` and `getEntitySchemaTool` in `src/mcp/schema.ts`; a `sliceFields(fields, path)` over the field list before `renderSchemaTree` (`src/mcp/schemaTree.ts`), with the read-only prefix made relative.

**Not doing:** a CLI `--path` (there is no `schema` command in `src/cli.ts`), `path` on `getBlockSchema`.

**Tests** (`src/mcp/__tests__/schema.test.ts`, exact rendered text): a group, a named tab, an array, a blocks field (slugs only), several paths, an unknown path, and no path unchanged.

## 2. Fields an app sets itself

afx-site rewrites the tree text: it drops the `tenant*:` line by prefix and appends `tenant (the tenant argument sets it)` to `read-only:` (`tenantReadOnly`).

**Shape:** `McpContentToolsOptions.readOnlyFields?: (req, { collection }) => Record<string, string> | Promise<…>`, field name → reason. The field leaves its normal place in the tree and shows on the `read-only:` line as `name (reason)`.

- Display only: `create` and `update` don't refuse these fields. afx-site still accepts `data.tenant` on create to name the site and checks it against its tenant argument; its field hook already refuses moving a document to another tenant on every surface.
- Top-level names only for now (tenant is the only user).
- Needs `req`, so it runs in the tool handler and adjusts the field list (or passes the reasons in) before rendering.

afx-site then deletes `tenantReadOnly`.

## 3. Say so when nothing matches

- **Bulk `update` by `where`** matching nothing: add `note: "No <collection> match; nothing changed."` to `{ ids: [], status }`.
- **Localized field in the filter:** when the result is empty (bulk update or `find`) and `where` tests a localized field, add `"<field> is localized and read in <locale>; pass locale to match another language."`. Uses the collection config only. `find` gets no note otherwise; `totalDocs: 0` is already clear.
- No `describeScope` option. afx-site drops `withNothingMatched` entirely.

**Open:** how deep to walk `where` for localized fields (`and`/`or`, dotted paths into groups and arrays). Start with what the existing field schema can resolve.

## Release

- `0.6.0-beta.6` with item 1; CHANGELOG, README and USAGE updated with the change.
- afx-site bumps, adds a `path` line to `docs/reference/MCP.md`, and runs `pnpm -F cms test` and `pnpm -F cms test:db src/plugins/mcp-content src/mcp`.
- Later beta with 2 and 3; afx-site deletes `tenantReadOnly` and `withNothingMatched`.
- Possible later wins (not in this plan): render a repeated group shape once and reference it; factor a `[when]` rule shared by consecutive siblings.
