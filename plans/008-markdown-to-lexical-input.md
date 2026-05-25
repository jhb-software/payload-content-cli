---
title: Markdown → Lexical input for create/update
type: feature
status: draft
priority: high
---

# Markdown → Lexical input for create/update

Agents authoring rich-text fields today have to hand-write a Lexical JSON tree: every paragraph wrapped in `{type: "paragraph", direction: "ltr", indent: 0, version: 1, textFormat: 0, textStyle: "", children: [...]}`, every text node `{type: "text", detail: 0, format: 0, mode: "normal", style: "", text: "..."}`, and so on. For a ~5-section document this is hundreds of lines of brittle JSON. It also exposes an entire class of bugs around non-ASCII characters inside JSON string literals (e.g. German `„…"` curly quotes terminating the string mid-paragraph).

The reverse direction (Lexical → Markdown) is already tracked in plan 005. This plan covers the input side, which the feedback report ranks as the single highest-impact change for agent ergonomics.

## Current state

- `create` and `update` take `--file <one.json>` for the entire payload, or `--data '<json>'` for inline overrides.
- Rich-text fields must be supplied as full Lexical JSON trees.
- No conversion utility ships with the CLI on either side.

## Proposal

### 1. `--rich-text <field>=<markdown-file-or-string>` for create/update

```bash
payload-content create episodes \
  --data '{"episodeNumber":2,"publishedAt":"2026-05-23"}' \
  --rich-text content=body.md

payload-content update episodes 6a0b... \
  --rich-text content=@body.md \
  --override-lock
```

Repeatable, so a document with multiple rich-text fields (`content`, `summary`, `seo.description`) can have each authored as Markdown. Schema-aware: error out if the named field is not a richtext field.

### 2. Stackable `--data` with last-write-wins merge

Folded in from the same feedback (§3 — building payloads from multiple sources):

```bash
payload-content create episodes \
  --data @meta.json \
  --data '{"episodeNumber":2}' \
  --rich-text content=body.md
```

Multiple `--data` flags merge in order; `@file.json` reads from disk; `--rich-text` writes into the merged object before submission. This lets an agent compose a payload from N independent sources (RSS feed, prior `find` output, generated content) without ever building one big shell-escaped JSON string.

### 3. Markdown subset

Minimum viable coverage — chosen for what agents actually emit:

- Headings h1–h6
- Paragraphs
- `**bold**`, `*italic*`, `` `code` ``
- `[text](url)` inline links
- Ordered and unordered lists (single-level acceptable for v1)
- Fenced code blocks
- Hard line breaks

Out of scope for v1: tables, images (uploads are a separate flow), blockquotes, footnotes, custom Payload blocks. These can be added incrementally as agents hit them.

## Implementation notes

- Existing Payload ecosystem packages (`@payloadcms/richtext-lexical` ships markdown converters) — prefer reusing them over hand-rolling. Verify what's in the dep graph before adding new packages.
- Conversion happens client-side before the request. The CLI does not need server cooperation.
- Field validation: hit the schema endpoint (already exposed by the plugin) to confirm the target field is richtext before converting.
- The same converter could later back a `--format markdown` flag on `pull` (plan 005) if the libraries are symmetric.

## Files

- `src/cli.ts` — add `--rich-text` option to `create`/`update`, make `--data` repeatable
- `src/markdown-to-lexical.ts` — new file, conversion entry point
- `src/agent-skill.md` — document the new flags

## Open questions

- Should `--rich-text content=body.md` accept a bare string too (no `@`), e.g. `--rich-text summary="**Hello** world"`? Probably yes — the feedback report leans toward fewer files.
- How to disambiguate `field=value` syntax from filenames containing `=`? Quote the whole arg or require `@` for files. The `@file` convention (curl-style) is unambiguous and worth adopting.
- For nested fields (`seo.description`), use dot paths. Confirm this matches the path syntax already used by `lexical` subcommands.
