---
title: Agent skill polish — upload select trap, lexical authoring, override-lock
type: docs
status: draft
priority: high
---

# Agent skill polish

Doc-only updates to `src/agent-skill.md` based on a long agent session that hit several friction points. None of these require code — the underlying CLI behavior is already correct (the `--select` upload safety guard landed in commit `69689ba`), but the skill prose doesn't reflect what agents need to know.

## Current state

- `src/agent-skill.md` Step 4 tells agents to use `--select` to minimize response size, working on `find`, `create`, and `update`. It doesn't mention `upload`.
- The lexical subcommands section explains _what_ exists, but not the node shapes agents have to produce. Agents end up guessing or pulling an example to copy.
- `--override-lock` is mentioned only in passing. Agents discover it by hitting a 423.

## Changes

### 1. Lexical node cheatsheet

Add a short reference under the lexical subcommands section with three or four examples:

- A paragraph with plain text
- A paragraph with an inline link
- An h2 heading
- A list item (ordered + unordered)

The point is to give agents the exact field shapes (`type`, `direction`, `indent`, `version`, `textFormat`, `format`, `mode`, etc.) so hand-edits stop being guesswork until plan 008 (Markdown input) lands. Once 008 ships, this section can shrink — most agents won't need to author Lexical directly anymore.

### 2. Explicit `--override-lock` guidance

Add: "If the doc is open in the admin UI, `update` will fail with 423 Locked. Pass `--override-lock` when running as an automated agent and the user expects you to win the conflict. Don't pass it by default in interactive flows — locks exist for a reason."

### 3. Round-trip pattern for live-doc lexical edits

Until plan 010 (live-doc lexical target syntax) lands, document the workaround:

```bash
payload-content find <coll> <id> --select '{"<field>":true}' > /tmp/doc.json
# ...lexical edits on /tmp/doc.json...
payload-content update <coll> <id> --file /tmp/doc.json --override-lock
```

And mention the bare-content-file workaround (wrap in `{"content": <tree>}` before invoking `lexical`) until plan 010 detects that shape natively.

## Files

- `src/agent-skill.md` — all changes
- `dist/agent-skill.md` — rebuilt on publish, not edited directly

## Out of scope

- Code changes to the CLI itself (covered by plans 008, 010, 011)
- Upstream PR to `@payloadcms/plugin-cloud-storage` `getIncomingFiles.js` (`data.mimeType` should fall back to `file.mimetype`) — worth filing but not blocking on
