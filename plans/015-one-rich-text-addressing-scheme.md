---
title: One way to address rich text
type: refactor
status: draft
---

# One way to address rich text

The package now has two ways to point at something inside rich text:

- **CLI and `editRichText`**: a field path (`layout[0].richText`, or through a
  lexical block by its blockType, `content.TwoColumnRichText.firstColumn`) plus a
  separate node address counted from the root (`2.1`). Edits are named operations
  (`insertBefore`, `replace`, `setProp`, `linkText`, …).
- **`editAtPath` and the `updateRichText` MCP tool**: one dot path from the field
  to any node or value (`content.2.children.1.fields.doc.value`), with the
  operations `read`, `set`, `insert` and `delete`, and compact outline reads.

An agent that uses both the CLI and the MCP tools has to learn both, and the docs
explain two models for the same thing.

## Options

1. **Move the CLI to dot paths.** `lexical get/set/add/remove` take one dot path
   and use `editAtPath`; `lexical list` prints the outline. `linkText`, `search`
   and `diff` stay as they are, since they don't address a single node. This is a
   breaking change to the CLI, which is fine in beta.
2. **Keep both and say why.** `editRichText` is for scripts that apply named
   edits in batches; `editAtPath` is for agents. Write this down in USAGE.md and
   don't add features to both.

Recommendation: option 1, once the `./mcp` tools have settled after the beta
release, so the path syntax is final before the CLI adopts it.
