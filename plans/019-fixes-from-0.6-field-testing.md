---
title: Fixes from 0.6 field testing
type: fix
status: in-progress
priority: high
---

# Fixes from 0.6 field testing

Found while moving the zzs CMS (Payload 3.84.1, MongoDB, no localization) to `createMcpContentTools()` and testing the CLI against it, plus an audit of plans 016–018. Each fix starts with a red test that reproduces it.

## Done

- `pull --locale` read with fallback, so a pushed locale file stored the default locale's text as a translation. A locale file that lacks a required field now fails on `push` (or saves with `--draft`), loudly instead of copying the default locale's text. `find --locale` got the same fix (plan 018).
- `discover` named the wrong package for the plugin import.
- Unknown locales: the MCP tools refuse a locale on an app without localization, the CLI's `--locale` refuses one the app doesn't have. One shared check (`src/locales.ts`); `*` reads as `all`. The CLI check uses the plugin's schema and fails open without it, on a refused key or another contract version.
- `getBlockSchema` suggests the slug meant by a block's config name, else lists the valid slugs (capped) and where a field's own are.

## Open: needs a reproduction in zzs

Doesn't reproduce against the example app; reproduce in zzs (`link:` dependency) before fixing.

1. **Empty `layout:` line in the MCP rich-text summary** on a lexical field with default features plus blocks. `layoutProps` only ever gets `"align"`/`"indent"`, and the example renders `layout: align, indent`. Check the zzs output verbatim; maybe a wrapped or truncated line.

## Closed

- `find --draft --select` returning unselected fields: reproduced neither on the example app nor on a second try in zzs (`coverImage`/`thumbnails`/`_status` returned only those). Reopen with a reproduction.

## Moved elsewhere

- `lexical insert` can't start an empty rich-text field → plan 010.
- Hiding collections from the MCP tools → plan 014.
- Write guards, shorthand in `create`/`update`, read defaults → plans 016, 017, 018.
