---
title: One way to address rich text
type: refactor
status: done
---

# One way to address rich text

Approved by the package author on 2026-10-19: the CLI and `./lexical` move to the
dot paths `editAtPath` and the `updateRichText` MCP tool use. One path syntax
everywhere, from the field down to any node or value, through blocks into nested
rich text (`layout.1.richText.3.fields.body.0.children.1.fields.doc.value`).

## Why

The old scheme was a field path (`layout[0].richText`, or a block by its type,
`content.alert.body`) plus a node address (`2.1`). A block reached by type is the
first of that type, so the second alert's rich text was unreachable; field
auto-detection only saw top-level fields; `[0]` vs `.` got mixed up; a value
inside a node was split across `--at` and `--prop`.

## CLI

| Before                                    | After                                                 |
| ----------------------------------------- | ----------------------------------------------------- |
| `list`, `get --at` (+ `--field`)          | `read <file> [path] [--full]`                         |
| `set --at --prop --value`, `replace --at` | `set <file> <path> [value] [--json]`                  |
| `add --at --position`                     | `insert <file> <path> [node] [--json]`                |
| `remove --at`                             | `delete <file> <path>`                                |
| `search --field`                          | `search <file> [path] --text`                         |
| `link --field`, `--from --at`             | `link <file> [path] …`, `--from <file> --link <path>` |
| `diff --field`                            | `diff <source> <target> [path]`                       |

- `read` without a path lists every rich-text field with its outline. `--full`
  prints the stored JSON, for copying nodes between files.
- `search` without a path searches every rich-text value, nested ones included.
- `link` and `diff` without a path use the document's only rich-text field and
  name the candidates when there is more than one.
- Results name full dot paths, so any output can be fed back as input.
- `--paragraph`/`--heading`/`--text`/`--tag`/`--position`/`--create` go: shorthand
  nodes (`{"type":"p","text":"…"}`) cover them, and insert takes the index.

## `./lexical`

- `editAtPath` is the read and edit API. `editRichText`, `readRichText` and
  `getRichTextNode` are removed.
- `searchRichText`, `extractRichTextLinks`, `extractRichTextBlocks` and
  `diffRichText` take a dot path and return `path` (a full dot path) instead of
  `address`.
- New: `linkRichText(doc, path, search, link)` (returns a changed copy, like
  `editAtPath`) and `richTextPaths(doc, { nested })`.
