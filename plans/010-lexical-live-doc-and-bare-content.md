---
title: Lexical subcommands against live docs and bare-content files
type: feature
status: draft
priority: high
---

# Lexical subcommands against live docs and bare-content files

The `lexical` subcommands work on a pulled file shaped like a full document, with rich text addressed by dot path (`content.3`, `layout.1.richText.3.fields.body.0`, plan 015). For an agent making a surgical edit to a live document that means a three-command round trip:

```bash
payload-content find episodes 6a0b... --select '{"content":true}' > /tmp/doc.json
payload-content lexical set /tmp/doc.json content.3 '{"type":"p","text":"..."}'
payload-content update episodes 6a0b... --file /tmp/doc.json --override-lock
```

And a standalone content tree (a file that is `{root: {children: [...]}}` itself) has no field to start a path at, so `lexical read` finds nothing to show and every path fails.

MCP clients don't have this problem: the `updateRichText` tool (`./mcp`) already reads and edits a live document by path. This plan brings the same to the CLI.

## Current state

- `src/lexical/commands.ts` operates on file paths. Paths start at a rich-text field inside a document object.
- No fetch/update integration — the user is responsible for pulling and pushing.
- Bare content trees (top-level `{root: {children: [...]}}`) can't be addressed: `richTextPaths` reports them at the empty path, which no command accepts.

## Proposal

### 1. Live-doc targets

Accept `<collection>:<id>[@locale]` (and `globals/<slug>[@locale]`) in place of `<file>` for every `lexical` command. The path stays the same dot path a file takes:

```bash
payload-content lexical read episodes:6a0b...
payload-content lexical set episodes:6a0b... content.3 '{"type":"p","text":"..."}'
payload-content lexical link episodes:6a0b... content --search "Auction Atlas" --relationTo pages --value <id>
payload-content lexical search posts:42@de --text "Kronenberg"
```

Internally: fetch the doc (selecting the path's first segment, no locale fallback, draft by default as the MCP tools do), apply the change with `editAtPath`/`linkRichText`, and update it back. Locale is appended with `@` to keep the target unambiguous.

`--override-lock` should be a flag on the writing commands too — default off (fail loudly on lock conflict), opt-in for AFK agents. Matches the pattern already used by `update`.

### 2. Start an empty rich-text field

`lexical insert doc.json content.0 '[…]'` on a new document fails with `No "content" in the document`, as the field is absent or null. The MCP `updateRichText` starts it (`startEmptyRichText` in `src/mcp/updateRichText.ts`); do the same for an insert at index 0. This is the "create a draft, then fill its body" flow.

### 3. Bare-content files

When the file itself is rich text, paths start at its top-level nodes: `3`, `3.children.0`, `3.fields.body.0`. `read` without a path outlines it; `link`, `search` and `diff` without a path use it.

## Implementation notes

- Target parser: a single function that returns `{ kind: "file", path } | { kind: "doc", collection, id, locale? } | { kind: "global", slug, locale? }`. All lexical commands route through it, so they read a document and write one back without knowing where it came from.
- For live targets, share the existing client fetch/update logic. Don't duplicate auth/profile/header handling.
- Bare files: `editAtPath` already resolves an index against a rich-text document; the work is accepting the empty path for "the whole file" in `read`, `richTextPaths` and the commands' default-path logic.
- `diff` should still print to stdout, not write back, even for live targets. The whole point of `diff` is preview.
- Read-only commands (`read`, `search`, `diff`) shouldn't require `--override-lock` and shouldn't pull a lock.

## Files

- `src/lexical/target.ts` — new, target parser
- `src/lexical/commands.ts` — every subcommand routes file vs. live target
- `src/lexical/read.ts`, `src/lexical/path.ts` — the empty path for bare files
- `src/agent-skill.md`, `USAGE.md`, `README.md` — document the live-target syntax (coordinate with plan 009)

## Open questions

- Concurrency: between fetch and update the doc could change. Use the manifest/etag flow already used by `update`, or accept that `--override-lock` is the escape hatch and document the race?
- Publishing: default to drafts like the MCP tools, with a `--publish` flag and the same guard against publishing over a newer draft?
- Should a live target without a path in `link`/`diff` fall back to the document's only rich-text field, as file targets do? That works on the fetched document without a schema lookup, so probably yes.
