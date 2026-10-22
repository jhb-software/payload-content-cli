---
title: No locale fallback on CLI reads
type: feature
status: done
---

# No locale fallback on CLI reads

The MCP tools read without locale fallback: an untranslated field is empty. The CLI's `find` applies Payload's fallback unless `--fallback-locale none`, so the default locale's text looks like a translation. `pull` gets this fixed as a bug (plan 019, it corrupts data on push); this plan is about `find`.

## Done

`find` with `--locale` reads without fallback by default; `--fallback-locale <code>` opts back in. Shipped with the `pull` fix, as `find` → `update` had the same round-trip corruption.

## Decided against

- **Drafts by default for CLI writes and reads.** The MCP is agent-only; the CLI is also used by people and for content-as-code sync, where a `push` that never goes live is a surprise. It also keeps the CLI on Payload's REST semantics (publish unless `draft`). The agent skill tells agents to pass `--draft`. Live-doc `lexical` commands (plan 010) may still default to drafts, as they mirror `updateRichText`.
