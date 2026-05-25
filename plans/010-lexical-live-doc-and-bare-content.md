---
title: Lexical subcommands against live docs and bare-content files
type: feature
status: draft
priority: high
---

# Lexical subcommands against live docs and bare-content files

The `lexical` subcommands today require a pulled file shaped like a full document (richtext nested under a known field, e.g. `doc.content`). For an agent making surgical edits to a live document this means a five-step round trip:

```bash
payload-content find episodes 6a0b... --select '{"content":true}' > /tmp/doc.json
payload-content lexical replace /tmp/doc.json --field content --at <addr> --paragraph "..."
payload-content update episodes 6a0b... --file /tmp/doc.json --override-lock
```

And if the agent is already holding a standalone content tree (root is `{root: {children: [...]}}`), the subcommands error with `No Lexical rich text found in document` because they assume a wrapping document shape.

## Current state

- `src/lexical/*` operates on file paths. The file must contain a document object with the richtext field nested under a known path.
- No fetch/update integration — the user is responsible for pulling and pushing.
- Bare content trees (top-level `{root: {children: [...]}}`) are rejected.

## Proposal

### 1. Live-doc target syntax

Accept `<collection>:<id>:<field>[@locale]` as a target for `lexical {search, get, replace, add, remove, set, link, list, diff}`:

```bash
payload-content lexical replace episodes:6a0b...:content --at <addr> --paragraph "..."
payload-content lexical link episodes:6a0b...:content --text "Auction Atlas" --url https://...
payload-content lexical search posts:42:body@de --query "Kronenberg"
```

Internally: fetch the doc (selecting the target field), mutate the tree in memory, push back with `--override-lock` semantics. Locale is appended with `@` to keep the colon path unambiguous.

`--override-lock` should be a flag on these commands too — default off (fail loudly on lock conflict), opt-in for AFK agents. Matches the pattern already used by `update`.

### 2. Bare-content file detection

When `<file>` is passed as a target, detect the shape:

- If the root has `root.children`, treat the whole file as the field value.
- Otherwise, expect a document object and require `--field <path>` as today.

The detection is one check — `typeof parsed?.root?.children !== "undefined"` — and removes the only reason agents currently have to wrap content trees by hand before invoking `lexical`.

## Implementation notes

- Target parser: a single function that returns `{ kind: "file", path } | { kind: "doc", collection, id, field, locale? }`. All lexical commands route through it.
- For `kind: "doc"`, share the existing client fetch/update logic. Don't duplicate auth/profile/header handling.
- Diff command: should still print to stdout, not write back, even for live targets. The whole point of `diff` is preview.
- Read-only commands (`search`, `get`, `list`) shouldn't require `--override-lock` and shouldn't pull a lock.

## Files

- `src/lexical/target.ts` — new, target parser
- `src/lexical/*.ts` — every subcommand routes file vs. live target
- `src/cli.ts` — argument parsing changes
- `src/agent-skill.md` — replace round-trip workaround section with the new syntax (coordinate with plan 009)

## Open questions

- Concurrency: between fetch and update the doc could change. Use the manifest/etag flow already used by `update`, or accept that `--override-lock` is the escape hatch and document the race?
- For `lexical add` on a deeply nested address, the fetch needs the whole field (no projection within richtext). Confirm we're not trying to be clever with partial fetches.
- Should `<collection>:<id>` without a field default to the first richtext field on the collection? Probably no — explicit beats magic, and a schema lookup adds latency.
