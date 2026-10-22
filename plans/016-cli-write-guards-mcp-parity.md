---
title: Refuse CLI writes that Payload silently drops
type: feature
status: draft
priority: high
---

# Refuse CLI writes that Payload silently drops

Payload answers some writes with 200 and loses data: unknown fields are stripped, a bulk update replaces every matched document's rows, partial array data deletes the rows it leaves out. The MCP tools (`src/mcp/write.ts`) refuse most of these; the CLI's `create`/`update` send whatever they get. This applies to every Payload setup, not only localized ones.

## Scope

Only `create` and `update`. `push` sends whole pulled files with row ids, so it doesn't hit these; locale-shared rows are already guarded server-side by `preserveSharedRowsPlugin` for every transport.

1. **Unknown top-level fields.** Payload strips keys that aren't in the entity's fields and answers 200, e.g. when a field isn't deployed yet. Warn, naming them and the closest match, rather than refuse: some apps' hooks read extra keys from `data` on purpose. Add to the MCP `create`/`update` too.
2. **Bulk update with rows.** `update --where` writing an `array`/`blocks` field replaces the rows of every matched document. Refuse, with `--replace-rows` to do it anyway (as the MCP does).
3. **Left-out rows on update by id.** Read the stored rows, refuse data that leaves some out (`findLeftOutRows` in `src/mcp/rows.ts`), `--replace-rows` to allow.

4. **Publishing over a newer draft.** Seen in practice with agents writing over plain REST. A publish by id starts from the latest draft, so it puts someone's unreviewed draft changes live along with the edit; a bulk publish starts from the live documents and discards them. Before an `update` without `--draft` on a collection with drafts, compare the draft's and the live version's `updatedAt` (one extra GET, `withNewerDrafts` in `src/mcp/write.ts`) and refuse, pointing at `--draft` or an explicit flag to publish anyway. Refuse rather than warn: after the write the draft is already live. The MCP `update` only guards the bulk case today; guard by-id writes there too, with the same message.

Unknown locales are plan 019.

## Approach

The checks need field configs. The CLI gets them from the plugin's `/content-cli/schema`, so the guards run when the plugin is installed and are skipped (with a one-line note) without it. Port the checks to `FieldSchema` so the MCP and the CLI share one implementation over the same shape, instead of keeping a `Field` and a `FieldSchema` copy.

## Not now

- The rich-text checks (block slugs, missing link targets). They matter for draft writes, which skip Payload's validation; revisit with plan 017, which brings rich text into `create`/`update` data.
