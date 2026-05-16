---
title: Media/asset download on pull
type: feature
status: todo
---

# Media/asset download on pull

When pulling upload collections, download actual files alongside the JSON metadata. Detect upload docs by checking for `url`/`filename` fields. Add `--no-media` flag to skip.

**Files:** `src/client.ts`, `src/pull.ts`, `src/cli.ts`
