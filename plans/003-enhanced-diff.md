---
title: Enhanced diff with field-level output
type: feature
status: todo
---

# Enhanced diff with field-level output

The current `diff` command only compares `updatedAt` timestamps. Add a `--verbose` flag that fetches both local and remote versions and shows a structural JSON diff (which fields changed and how).

**Files:** `src/diff.ts`, `src/cli.ts`
