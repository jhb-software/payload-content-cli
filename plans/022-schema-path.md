---
title: "path on getEntitySchema"
type: feat
status: in-progress
---

# `path` on `getEntitySchema`

Schema trees get big. On a real multi-tenant site, `products` is ~5 KB and `header` 5.4 KB of the package's own text, with blocks as slugs only. The size comes from nesting (`links[] → columns[] → items[]`), a link shape written out at each level, repeated `[when …]` rules and identical `cta` groups. An agent editing one group pays for the whole tree before every write; with a path it pays ~1 KB.

## Shape

`path` takes a dot path or a list of them, like `find`'s `path`.

- No `path`: the full tree, byte for byte as today.
- Segments are field names through groups, named tabs and arrays. Blocks stay references: `path: "layout"` shows the slugs, and `getBlockSchema` is the way into a block's fields. No block-slug segments.
- One section per path, headed `products.billing (group)`, sections joined by a blank line.
- `[when …]` rules keep their sibling-relative form (`/a` and `^a` stay correct inside a slice).
- The `read-only:` line lists only read-only fields under the path, relative to it.
- An unknown path is refused with the field names that exist at that level, worded like `find`'s missing-path message (`src/mcp/missingPath.ts`).
- The legend stays in the tool description.

## Where

`entityArgs` and `getEntitySchemaTool` in `src/mcp/schema.ts`; a slice over the field list before `renderSchemaTree` (`src/mcp/schemaTree.ts`).

## Not doing

A CLI flag (there is no `schema` command), `path` on `getBlockSchema`.

## Tests

`src/mcp/__tests__/schema.test.ts`, exact rendered text: a group, a named tab, an array, a blocks field (slugs only), several paths, an unknown path, and no path unchanged.

## Later, not in this plan

Render a repeated group shape once and reference it; factor a `[when]` rule shared by consecutive siblings.
