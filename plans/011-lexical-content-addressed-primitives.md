---
title: Content-addressed lexical primitives — replace-text, replace-link, wrap-text
type: feature
status: draft
priority: medium
---

# Content-addressed lexical primitives

The existing `lexical` subcommands address nodes by tree position (`--at <addr>`). For the most common agent edits — "fix this typo", "update this link's URL", "turn this string into a link" — agents end up doing tree walks in Python because the position-addressed primitives are awkward for content-driven changes.

This plan adds three content-addressed primitives.

## Current state

- `lexical replace` requires an address. Replacing a text run anywhere in the tree means walking nodes by hand.
- `lexical link` exists but operates on existing link nodes; it doesn't turn a substring inside a paragraph into a new link.
- Find-and-replace inside text-node strings is a Python loop today.

## Proposal

### `lexical replace-text`

```bash
payload-content lexical replace-text <target> --old "Hans Kronenberg" --new "Hanns Kronenberg"
payload-content lexical replace-text <target> --old "Flu" --new "Flue" --all
```

Walks all text nodes in the tree, runs string replacement on each `text` value. `--all` replaces every occurrence (default); a `--first` flag could replace only the first match if needed. No regex in v1 — string only — to avoid quoting hell from the shell.

### `lexical replace-link`

```bash
payload-content lexical replace-link <target> --url-matches "rheinwerk" --new-url "https://www.rheinwerk-verlag.de/..."
payload-content lexical replace-link <target> --url "https://old.example.com/x" --new-url "https://new.example.com/x"
```

Finds link nodes by URL — `--url` for exact match, `--url-matches` for substring. Swaps the `url` field on the matched link node(s). Does not touch link text. Optionally `--new-text` to swap the visible label too.

### `lexical wrap-text`

```bash
payload-content lexical wrap-text <target> --text "/facts/autoauctionatlas/" --url "https://..."
```

Finds a substring inside a text node, splits the node into up-to-three siblings (before, link, after), and wraps the middle in a link node. This is the hardest of the three to write by hand — the agent has to split a text node into three siblings and preserve formatting flags — and is the highest-value primitive once available.

Multi-match policy: `--first` (default) wraps only the first occurrence; `--all` wraps every occurrence. Erroring on no-match should be the default to catch typos.

## Implementation notes

- All three are pure tree walks on the Lexical content tree. They compose with the live-doc target syntax from plan 010 once that lands.
- Preserve text-node formatting flags (`format`, `mode`, `detail`, `style`) when splitting — wrap-text must clone them onto the surviving siblings.
- Share the tree walker with existing `lexical search` — no need for a parallel implementation.
- Each command exits non-zero with a descriptive message if no match is found (overridable with `--allow-noop` if scripts need it).

## Files

- `src/lexical/replace-text.ts`, `src/lexical/replace-link.ts`, `src/lexical/wrap-text.ts`
- `src/cli.ts` — register new subcommands
- `src/lexical/walk.ts` — extract a shared walker if not already factored
- `src/agent-skill.md` — document the new primitives

## Out of scope for v1

- Regex matching (string only)
- Class-based formatting changes (bold/italic toggles)
- Cross-node matches — `replace-text` operates within a single text node; a match split across two adjacent text nodes won't be found. Document this; revisit if it bites.

## Open questions

- Should `replace-text` count matches and print "N occurrences replaced" to stderr? Probably yes — silent edits scare both humans and agents.
- For `wrap-text`, what if the matched substring already has a link ancestor (e.g. the URL changed mid-link)? Default: skip those matches and report. Alternative: replace the wrapping link's URL — but that's what `replace-link` is for, so keep them orthogonal.
