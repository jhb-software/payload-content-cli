# Usage

## Setup

### Install

```bash
pnpm add -D @jhb.software/payload-content-cli
```

### Add the plugin (optional)

The plugin exposes `/api/content-cli/schema` for field metadata (`_schema.json` files, virtual field stripping, localization config). The CLI works without it — collection/global discovery uses Payload's built-in `/api/access` endpoint.

The schema response is access-aware: each collection and global is included only if the requester passes its `access.read` (matching `/api/access` semantics). Custom endpoints attached to a collection or global are filtered the same way.

```ts
// payload.config.ts
import { contentCliPlugin } from "@jhb.software/payload-content-cli/plugin";

export default buildConfig({
  plugins: [contentCliPlugin()],
});
```

To hide collections from the CLI, use Payload's access control instead of plugin options.

### Build custom tools with the schema API

The same field extraction the `/schema` endpoint uses is exported for building your own tools — for example a trio of `listEntities` + `getEntitySchema` + `getBlockSchema` MCP tools. Each takes a Payload `req` (carrying `req.payload` and the authenticated user) and runs in-process, so no HTTP round-trip.

`listReadableEntities` is the discovery half — it returns the collection and global slugs the request may read, plus localization:

```ts
import { listReadableEntities, getEntitySchema } from "@jhb.software/payload-content-cli/plugin";

// inside a Payload endpoint / MCP tool handler that has a `req`
const { collections, globals, localization } = await listReadableEntities({
  req,
});
// → { collections: ["posts", "pages"], globals: ["settings"],
//     localization: { locales: ["en", "de"], defaultLocale: "en" } }
```

`getEntitySchema` is the describe half — it resolves one collection or global to `{ slug, fields }`:

```ts
const { slug, fields } = await getEntitySchema({
  req,
  type: "collection", // or "global"
  slug: "pages",
});
// fields → [{ name: "layout", type: "blocks", blockSlugs: ["hero", "cta"] }, ...]
```

Block fields come back as slugs, not definitions, so an entity schema stays small enough to hand to an agent: it sees which blocks a field accepts and asks for the ones it needs. `getBlockSchema` resolves those slugs — and the ones a richText field lists under `lexicalFeatures.blockNodes.block.slugs` — to `{ slug, fields }`:

```ts
import { getBlockSchema } from "@jhb.software/payload-content-cli/plugin";

const blocks = await getBlockSchema({ req, slugs: ["hero"] });
// → [{ slug: "hero", fields: [...] }]
// A block nested inside "hero" is itself referenced by slug, so detail
// unfolds one call at a time.
```

Pass `blocks: "inline"` to either helper for the self-contained shape instead — every block's fields embedded, and for `getEntitySchema` a `jsonSchema` (the draft-07 validation document) alongside. That's what the `/schema` endpoint serves, since the CLI resolves blocks offline. In the default reference mode `getEntitySchema` omits `jsonSchema`, because that document inlines every block and would undo the saving; call `entityToJsonSchema` yourself if you want one.

```ts
const { fields, jsonSchema } = await getEntitySchema({
  req,
  type: "collection",
  slug: "pages",
  blocks: "inline",
});
```

- **Consistent and access-aware.** `listReadableEntities` and `getEntitySchema` evaluate the entity's `access.read` against `req` with the same lenient rule the endpoint uses (a `read` returning a `Where` clause still counts as readable), so everything `listReadableEntities` returns is resolvable by `getEntitySchema`. `getEntitySchema` **throws** on denied access; `listReadableEntities` simply omits what you can't read. `getBlockSchema` has no read check — blocks are config fragments, not access-controlled entities. Any block the config can reach resolves, whether it's defined on `config.blocks`, inline on a field, or in a lexical `BlocksFeature`; defining blocks globally on `config.blocks` is still the better default (Payload v4 drops inline blocks, and shared definitions are more performant).
- **Explicit type.** Collections and globals live in separate namespaces and a slug may exist in both, so `getEntitySchema` takes a `type` rather than guessing.
- **Bare slugs, no policy baked in.** `listReadableEntities` returns plain slugs filtered by access alone — apply your own addressing convention (e.g. a `globals/<slug>` prefix) or "internal collection" exclusions in your own handler.

The lower-level pure transforms — `toFieldSchemas` (config → agent-friendly `FieldSchema[]`, taking the same `{ blocks }` projection option), `extractLexicalSummary` (a single richText field config → its `LexicalFeatureSummary`, for consumers with their own field walker) and `entityToJsonSchema` (→ draft-07 validation doc) — are exported too, along with the `FieldSchema`, `JsonSchema`, and `LexicalFeatureSummary` types.

Each `FieldSchema` carries `system: true` for fields Payload injects rather than the author declaring them (`createdAt`, `updatedAt`, `_status`, `blockName`, and generated array/block row `id`s — but not a collection's custom ID field), `hasCondition: true` when the field is gated by an `admin.condition` — its own or one on a row, collapsible, unnamed group or tab it sits in — and `filterOptions` when a static filter constrains which related documents may be assigned. `system` marks bookkeeping, not a write ban: `_status` is the publish control and `createdAt` is accepted on create.

A condition is a function, so the schema can't show the rule on its own. To publish it, declare the rule as data beside the function in `admin.custom.condition`, in any shape your agents understand (an object or a plain sentence). The field's `conditions` then lists every rule that gates it, outermost first; all must hold. It is omitted when any gating condition declares no rule, so a partial list never reads as the whole rule:

```ts
{
  name: "icon",
  type: "text",
  admin: {
    condition: (_, siblingData) => siblingData?.style === "secondary",
    custom: { condition: { field: "style", equals: "secondary" } },
  },
}
// → { name: "icon", type: "text", hasCondition: true, conditions: [{ field: "style", equals: "secondary" }] }
```

### Edit richtext from your own code

> Experimental: may change in any minor release.

The Lexical toolkit behind the `lexical` commands is exported separately, for tools that fetch and save documents themselves — an MCP tool, a migration script, a seed. It is pure: no filesystem, no network, no Payload import.

One dot path addresses anything in a document's rich text: it starts at a richtext field (`content`, `layout.1.richText`), a number after a richtext value indexes its top-level nodes (`content.3`), and from there it follows the node's JSON — including into rich text nested in a block (`content.3.fields.body.0`). The same paths work in the CLI and the `updateRichText` MCP tool.

```ts
import { editAtPath, readAtPath } from "@jhb.software/payload-content-cli/lexical";

const doc = await payload.findByID({ collection: "posts", id, depth: 0, req });

readAtPath(doc, "content");
// → ["content.0 p: Intro", "content.1 block alert [1 link]: See safety", "content.2 ul (2 items): a; b"]

readAtPath(doc, "content.0");
// → { type: "paragraph", version: 1, children: [{ type: "text", version: 1, text: "Intro" }] }

const { doc: changed } = editAtPath(
  doc,
  "content.1.fields.body.0.children.1.fields.doc.value",
  "set",
  newPageId,
);

await payload.update({ collection: "posts", id, data: { content: changed.content }, req });
```

`readAtPath(doc, path)` works on any path, `""` for the whole document: rich text becomes an outline, one line per node, each starting with its path; a node becomes its JSON without Lexical's default properties; anything else is returned as it is, with the rich text inside it outlined.

`editAtPath(doc, path, operation, value?)` changes rich text:

- **`set`**: replace the value. Nodes may be given as read (defaults and unchanged outlines are restored), in full, or as shorthand: `{type: "p", text}`, `{type: "h2", text}`, `{type: "ul", items}`, `{type: "hr"}`, `{type: "block", fields}`, `{type: "upload", value}`, `{type: "text", text}`. Shorthand is plain text, so it is refused over links, formatting or inline nodes; to change words, set a text node's `text`. Returns the node's new outline line.
- **`insert`** a node before the index the path ends in (the node count appends), **`delete`** the node at the path. Both return the node's outline line, the new count, and which nodes moved.

An outline only stands in for the rich text it was read from: an unchanged one is restored, an edited one is refused. To copy a block, or put one where a different node was, give its nested rich text as `{root: {children: [...]}}`, nodes as read or as shorthand. A copied block gets a new id.

The input document is never modified; a change returns a changed copy as `doc`, validated first. Failures throw `LexicalError` with a `code` — `PATH_NOT_FOUND` (naming the valid range or keys), `UNSUPPORTED_AT_PATH`, `INVALID_NODE`, `INVALID_TREE`, `TEXT_NOT_FOUND` — all meaning the input was wrong, so a tool can relay the message instead of reporting a fault.

Alongside them, each covering every rich text at or below a path (`""` for the whole document, a node such as `content.2` for just that node, or a text node such as `content.2.children.1`) and naming full dot paths in their results:

- `richTextPaths(doc, { nested? })` — every rich-text value's path, fields in array rows included.
- `searchRichText(doc, path, text)` — matches, those inside a link marked `linked`.
- `linkRichText(doc, path, text, { relationTo, value, newTab? })` — wrap the first unlinked match in an internal link; returns a changed copy, the link's path and its node's outline line.
- `extractRichTextLinks(doc, path)` — internal links and their targets.
- `diffRichText(source, target, path)` — links and blocks only one locale variant has.

For walking rich text yourself, the module exports its node types: `LexicalRoot`, `LexicalNode`, `LexicalElementNode`, `LexicalTextNode`, `LexicalLinkNode` (`link`/`autolink`, with `fields.linkType`, `url` and `doc`), and `RichTextValue`, what a rich-text field stores (`{ root }`).

Fetching and saving stay yours, and with them the decisions the CLI can't make for you: access control (`overrideAccess: false`), which locale, and whether the write is a draft.

### Add the MCP content tools

> Experimental: may change in any minor release.

For a Payload app running [`@payloadcms/plugin-mcp`](https://payloadcms.com/docs/plugins/mcp), `/mcp` ships a small, collection-agnostic set of content tools, in place of the plugin's one-tool-per-collection-and-operation set:

```ts
import { createMcpContentTools } from "@jhb.software/payload-content-cli/mcp";

mcpPlugin({
  collections: {}, // the content tools cover every collection and global
  mcp: { tools: [...createMcpContentTools(), ...yourOwnTools] },
});
```

Every tool runs with the request's user and Payload's access control. Collections are addressed by slug, globals as `"globals/<slug>"`.

| Tool              | What it does                                                                          |
| ----------------- | ------------------------------------------------------------------------------------- |
| `listEntities`    | The readable collections and globals, and the locales.                                |
| `getEntitySchema` | One entity's fields as a compact tree, one line per field. Blocks are listed by slug. |
| `getBlockSchema`  | The fields of blocks by slug, in the same tree format.                                |
| `find`            | One document by id, a page of a collection filtered by `where`, or a global; rich text as outlines, one value by `path`, or matches of `text`. |
| `create`          | A document in a collection, as a draft by default. Answers with its id.               |
| `update`          | Some fields of a document by id, of every document a `where` matches, or of a global. |
| `updateRichText`  | Edit rich text in place by path, or link text to a document (below).                  |

The schema tools answer in a tree rather than JSON, which costs an agent about half the tokens; the legend rides in the tool description, so it is paid once per session:

```
pages (collection)
  title*: text (localized)
  theme: select (light | dark) = "light"
  author: relationship → authors
  layout[]: blocks (hero | cta)
  body: richText
    ✎ block nodes: paragraph, heading (h2, h3), block (alert)
```

Payload's bookkeeping (`id`, timestamps, `_status`) is left out. Fields your app maintains itself, marked both hidden and read-only, are left out of the tree too, but named on a closing `read-only, in find results only:` line, since `find` returns them. Fields you add to the link feature are listed under the `✎ inline nodes: link` line.

`find` reads the latest draft unless `draft: false`, so an agent sees its own unpublished edits. It returns what a locale stores, without fallback, so an untranslated field reads as empty rather than as another language. Rich text comes back as an outline, one line per node starting with its path (`"content.1 block alert [1 link]: See safety"`), the same outline `lexical read` prints. For one document, `path` reads a single value, a node as JSON without Lexical's defaults, and `text` lists where the text occurs in its rich text, marking matches already inside a link. `where` and `select` may be objects or JSON strings (some MCP clients send nested objects as strings), `limit` is capped at 100, and `depth` defaults to 0.

Writes go to the draft unless `draft: false`, which publishes (the tools set `_status` explicitly, since Payload's `draft: false` alone never publishes). Publishing one document or a global publishes its latest draft together with the changes, as the admin panel's Publish does. A bulk publish by `where` starts from the live documents instead, so it is refused when a matched document has newer draft changes, unless `overwriteDraft: true`. `data` may be an object or a JSON string; `locale: "all"` is refused for writes. Rich text sent back as the outline `find` showed is kept as stored; an edited outline is refused with a pointer to edit its nodes instead. An array or blocks field in `data` is its complete list of rows, so `update` refuses data that leaves out stored rows (Payload would delete them) and bulk updates that write rows. `replaceRows: true` allows both, and the replacement [`preserveSharedRowsPlugin`](#keep-translations-of-shared-rows) refuses. Answers are lean: `{ id, status }` (`status` only on collections with drafts), `{ ids, status }` for a bulk update.

To keep answers lean, `create`, `update` and `updateRichText` write with `select: {}`. Payload applies `select` before `afterChange` runs, so those hooks, your own and plugins' (search sync, cache revalidation), receive a `doc` with only its `id`. A hook that reads other fields from `doc` should get them from `data` or `previousDoc` instead, or the collection should list them in [`forceSelect`](https://payloadcms.com/docs/queries/select#forceselect) (`_status` for drafts, for example).

#### Edit rich text by path

`updateRichText` packages [`editAtPath`](#edit-richtext-from-your-own-code) and `linkRichText` as a tool, on the paths `find` shows. It takes `collection`, `id`, `path`, `operation` (`set`, `insert`, `delete`, `link`), `value`, `text` (for `link`), `locale`, `draft` and `overwriteDraft`. `link` wraps the first unlinked match of `text` at or below `path` in an internal link to `value` (`{ relationTo, value }`) and answers with the link's path and its node's outline line. Edits go to the draft by default. `draft: false` publishes, and is refused when it would discard newer draft changes unless `overwriteDraft: true`. Since draft writes skip Payload's validation, the blocks and the link or upload targets an edit adds are checked first: each block must be one its rich-text field allows, also when an edit keeps a block's id but changes its type. A locale is read without fallback; rich text nobody has written yet in it, at any depth (an array row, a block), is started empty, so `insert` at `content.0` or `sections.0.body.0` begins it.

#### Options

Two options cover what differs between apps, and every tool that takes a locale or an id uses them. Both may be async:

```ts
createMcpContentTools({
  // The locale to read and write, e.g. a tenant's primary locale when the agent passes none.
  // Throw to refuse one, e.g. a locale a tenant doesn't serve; the agent gets the message.
  resolveLocale: (req, { collection, id, locale }) => locale ?? primaryLocaleOf(req),
  // Refuse an id before it is looked up, by returning the message to show.
  checkId: (req, { collection, id }) =>
    isSlug(id) ? "Pass the document id, not its slug." : undefined,
});
```

An unknown collection, global or locale is answered with the ones the agent may use. To drop or replace one tool, filter the list by `name`. Tool names are stable, since `@payloadcms/plugin-mcp` keys its per-key access flags on them. Tools carry MCP `annotations` (`readOnlyHint`, `title`), so clients can run the read tools without asking for confirmation. `@payloadcms/plugin-mcp` forwards them from v4 on. On 3.x, patch it (`pnpm patch @payloadcms/plugin-mcp`) to pass them on in the custom-tool registration in `dist/mcp/getMcpHandler.js`:

```diff
 registerTool(isToolEnabled, tool.name, () => server.registerTool(tool.name, {
     description: tool.description,
-    inputSchema: tool.parameters
+    inputSchema: tool.parameters,
+    ...tool.annotations && { annotations: tool.annotations }
 }, payloadToolHandler(tool.handler)), payload, useVerboseLogs);
```

Your own tools can answer and address entities the same way. `/mcp` exports `jsonResult`, `textResult` and `errorResult` (the `{ error }` shape the content tools use), `parseTarget(collection)`, which turns `"globals/<slug>"` into `{ kind: "global", slug }`, and `openTarget(req, options, collection, id?)`, which also answers an unknown slug with the valid ones and runs `checkId`:

```ts
import { errorResult, jsonResult, openTarget, type McpTool } from "@jhb.software/payload-content-cli/mcp";
import { z } from "zod/v3";

const healthTool: McpTool = {
  name: "health",
  description: "Health report of a collection or global.",
  parameters: { collection: z.string() },
  handler: async (args, req) => {
    try {
      const { target } = await openTarget(req, {}, String(args.collection));
      return jsonResult(await reportFor(req, target));
    } catch (err) {
      return errorResult(err instanceof Error ? err.message : String(err));
    }
  },
};
```

### Keep translations of shared rows

A non-localized array or blocks field holds one set of rows for every locale, and the localized values inside belong to each row's id. Payload treats a row sent without its id as a new row, so an API client or agent that reads a document in one locale and writes the rows back without ids replaces them, and the other locales' translations of them are gone. The edited locale looks right, so nobody notices until later. `preserveSharedRowsPlugin` from `/plugin` refuses such a write and names the ids to send back:

```ts
import { preserveSharedRowsPlugin } from "@jhb.software/payload-content-cli/plugin";

export default buildConfig({
  plugins: [preserveSharedRowsPlugin()], // or ({ collections: ["pages"], globals: ["nav"] })
});
```

By default it guards every collection and global that has a shared field, including those other plugins add, since it runs after them (it sets Payload's plugin `order`). Collections and globals without one get no hook and pay nothing. A bulk update by `where` checks every matching document, and the plugin is inert without localization. It reads the stored rows with the write's own access, so a caller who can't read a document learns nothing about its rows from a refusal. Writes that keep at least one row's id, localized arrays, arrays without localized fields, and the admin panel (which sends an id with every row) pass. To replace the rows on purpose, set `context: { [ALLOW_SHARED_ROW_REPLACEMENT]: true }` on the operation; the MCP `update` tool does so with `replaceRows: true`. The refusal is a `ValidationError` whose message says the same for every transport; `isSharedRowRefusal(error)` recognises it, for adding transport-specific advice.

### Enable API key auth

The CLI authenticates via Payload's API key feature. We recommend creating a dedicated `api-keys` collection rather than adding API keys to your `users` collection — this keeps machine credentials separate from user accounts. Example:

```ts
// collections/ApiKeys.ts
import type { CollectionConfig } from "payload";

export const ApiKeys: CollectionConfig = {
  slug: "api-keys",
  auth: { useAPIKey: true, disableLocalStrategy: true },
  admin: { useAsTitle: "name" },
  access: {
    create: isAdmin,
    read: isSelfOrAdmin,
    update: isAdmin,
    delete: isAdmin,
  },
  fields: [{ name: "name", type: "text", required: true }],
};
```

Key points:

- `disableLocalStrategy: true` — API key entries can't log into the admin panel
- `isSelfOrAdmin` on `read` — the API key can read its own document (needed for `/api/api-keys/me`), admins can manage all keys
- `isAdmin` on everything else — only admins create, update, or delete keys

Create an API key in the admin panel under **API Keys → Create New**.

### Environment variables

Create a `.env` in the directory where you'll run the CLI:

```bash
PAYLOAD_URL=http://localhost:3000
PAYLOAD_API_KEY=your-api-key-here
PAYLOAD_AUTH_COLLECTION=api-keys  # default
PAYLOAD_OUTPUT_DIR=content        # default: directory for pulled content
PAYLOAD_PROFILE=my-profile        # optional: use a saved profile as default
```

### Verify and discover

```bash
payload-content me          # confirm auth works
payload-content discover    # list collections, globals, and custom endpoints
```

`me` confirms authentication. `discover` lists available collection and global slugs. If the content-cli plugin is installed, it also lists custom endpoints registered by plugins (with descriptions and schemas).

---

## CRUD commands

No local files or plugin needed. Work directly against the Payload REST API.

### find — search documents or globals

```bash
payload-content find posts                                                # list all
payload-content find posts <id>                                           # get by ID
payload-content find posts --where '{"status":{"equals":"published"}}'    # filter
payload-content find posts --limit 10 --sort -createdAt                   # paginate and sort
payload-content find posts --select '{"title":true,"slug":true}'          # include specific fields
payload-content find posts --select '{"content":false,"richText":false}'  # exclude fields
payload-content find posts --locale de --draft                            # locale + drafts
payload-content find globals/site-settings                                # get a global
payload-content find globals/site-settings --select '{"siteName":true}'   # global with select
payload-content find posts --local                                        # search pulled files (offline)
payload-content find posts --local --where '{"slug":{"equals":"hello"}}' --select '{"title":true,"slug":true}'
```

Flags: `--where`, `--select`, `--limit`, `--page`, `--sort`, `--depth`, `--locale`, `--fallback-locale`, `--draft`, `--trash`, `--joins`, `--populate`, `--pagination` / `--no-pagination`, `--local`, `--json` (with `--local`).

In `--local` mode only `--where` and `--select` are applied; other flags are ignored because the search runs against pulled JSON files, not the API. Local `--where` supports only the `equals` (exact match), `like`, and `contains` (case-insensitive substring) operators — any other operator is rejected with an error. Drop `--local` for full operator support.

### create — create a document

```bash
payload-content create posts --file draft.json
payload-content create posts --file draft.json --draft
payload-content create posts --data '{"title":"New Post","slug":"new-post"}'
payload-content create posts --data '{"title":"Draft"}' --locale de
```

Use `--file` to read data from a JSON file, `--data` for small inline JSON. Prefer `--file` when constructing data programmatically — write a JSON file, then pass it.

Flags: `--file`, `--data`, `--locale`, `--fallback-locale`, `--depth`, `--select`, `--populate`, `--draft`, `--autosave`, `--publish-specific-locale`, `--publish-all-locales`.

### update — update a document or global

```bash
payload-content update posts <id> --file changes.json
payload-content update globals/site-settings --file settings.json
payload-content update posts <id> --data '{"title":"Updated"}'
payload-content update posts --where '{"status":{"equals":"draft"}}' --data '{"status":"published"}'
```

Provide an ID for single update, `--where` for bulk update, or `globals/<slug>` for globals. Use `--file` to read data from a JSON file, `--data` for small inline JSON.

Flags: `--file`, `--data`, `--where`, `--locale`, `--fallback-locale`, `--depth`, `--select`, `--populate`, `--draft`, `--trash`, `--autosave`, `--override-lock`, `--publish-specific-locale`, `--publish-all-locales`, `--unpublish-all-locales`.

### delete — delete documents

```bash
payload-content delete posts <id>
payload-content delete posts --where '{"status":{"equals":"draft"}}'
```

Provide an ID or `--where` for bulk delete.

Flags: `--where`, `--depth`, `--select`, `--populate`, `--trash`, `--override-lock`.

### count — count documents

```bash
payload-content count posts
payload-content count posts --where '{"status":{"equals":"published"}}'
payload-content count posts --trash                                       # include soft-deleted
```

Flags: `--where`, `--trash`.

### versions — list or get versions

```bash
payload-content versions posts                                                     # list all versions
payload-content versions posts <version-id>                                        # get a specific version
payload-content versions posts --where '{"version._status":{"equals":"draft"}}'    # filter versions
payload-content versions posts --limit 5 --sort -updatedAt                         # paginate and sort
payload-content versions globals/site-settings                                     # global versions
payload-content versions globals/site-settings <version-id>                        # specific global version
```

Flags: `--where`, `--select`, `--limit`, `--sort`, `--depth`, `--locale`, `--fallback-locale`, `--populate`, `--page`, `--pagination` / `--no-pagination`, `--trash`.

### restore — restore a version

```bash
payload-content restore posts <version-id>                    # restore a collection version
payload-content restore posts <version-id> --draft            # restore as draft
payload-content restore globals/site-settings <version-id>    # restore a global version
```

Flags: `--depth`, `--draft`, `--populate`.

### duplicate — duplicate a document

```bash
payload-content duplicate posts <id>
payload-content duplicate posts <id> --draft
payload-content duplicate posts <id> --select '{"title":true,"slug":true}'
```

Flags: `--depth`, `--select`, `--populate`, `--draft`, `--locale`.

### upload — upload a file to a media collection

```bash
payload-content upload media --file ./photo.jpg --data '{"alt":"Hero image"}'
payload-content upload media --url "https://example.com/image.png" --data '{"alt":"Remote image"}'
echo '<svg>...</svg>' | payload-content upload media --filename icon.svg --data '{"alt":"Icon"}'
payload-content upload media --file ./doc.pdf --draft
payload-content upload media --file ./photo.jpg --data '{"alt":"Bild"}' --locale de
```

Supports three file sources: local file (`--file`), URL (`--url`, fetched server-side by Payload), or stdin (pipe data). Use `--filename` to override the filename when uploading from URL or stdin.

#### Bulk upload

```bash
payload-content upload media --dir ./images --data '{"folder":"abc123"}'
payload-content upload media --glob "./assets/**/*.png"
payload-content upload media --dir ./images --dry-run
payload-content upload media --dir ./images --concurrency 3
```

Use `--dir` to upload all files from a directory (non-recursive) or `--glob` to match a pattern. `--dir` and `--glob` are mutually exclusive with each other and with `--file`/`--url`. The `--data` option applies shared field values to every file (e.g. assign all uploads to a folder).

Flags: `--file`, `--url`, `--data`, `--filename`, `--select`, `--populate`, `--locale`, `--fallback-locale`, `--depth`, `--draft`, `--autosave`, `--publish-specific-locale`, `--publish-all-locales`, `--dir`, `--glob`, `--concurrency`, `--dry-run`.

### request — raw HTTP to any endpoint

```bash
payload-content request GET "posts?limit=1"
payload-content request GET example-plugin/stats
payload-content request POST example-plugin/publish-all --data '{"confirm":true}'
payload-content request PATCH some-plugin/resource/<id> --data '{...}'
payload-content request DELETE some-plugin/resource/<id>
```

Escape hatch for custom endpoints registered by plugins.

---

## Content sync commands

Pull content to files, edit locally, push back. Works without the plugin; install the plugin for schema metadata.

### pull — download content to local files

```bash
payload-content pull                                          # everything
payload-content pull --collections posts pages                # specific collections
payload-content pull --globals site-settings                  # specific globals
payload-content pull --locale de                              # single locale ({id}_de.json)
payload-content pull --locale en de                           # multiple locales side by side
payload-content pull --draft                                  # draft versions
payload-content pull --collections posts --where '{"tenant":{"equals":"acme"}}'
payload-content pull --json                                   # summary as JSON
```

`--where` accepts [Payload query syntax](https://payloadcms.com/docs/queries/overview) as JSON. When used, only matched documents are pulled and existing manifest entries are preserved.

Virtual fields are automatically stripped when the plugin is installed (provides schema metadata).

### push — upload local changes

```bash
payload-content push                                          # modified + added files
payload-content push content/collections/posts/<id>.json      # specific file(s)
payload-content push --dry-run                                # preview without changes
payload-content push --force                                  # overwrite even with conflicts
payload-content push --draft                                  # push as drafts
payload-content push --json                                   # summary as JSON
```

Without arguments, pushes files that changed since last pull. Detects conflicts (remote modified after your last pull) and exits with code 2 unless `--force` is set; `--dry-run` reports them too. A document pulled with `--draft` or pushed with `--draft` is compared against its latest draft, so an unpublished draft isn't mistaken for a remote change, by `push` as well as by `diff`.

`push` and `pull` refuse to run if the manifest's recorded server URL differs from the current `PAYLOAD_URL` — this protects you from pushing staging content to prod (or vice versa) after a profile/env switch. Pass `--allow-url-change` if the switch is intentional.

### status — local changes (offline)

```bash
payload-content status
payload-content status --json
```

Shows modified (M), added (A), and deleted (D) documents. No API call needed.

### diff — local vs remote comparison

```bash
payload-content diff
payload-content diff --json
```

Shows which documents have local changes, remote changes, or both (conflicts).

### JSON output

`pull`, `push`, `status`, `diff`, and `find --local` accept `--json`, which puts the result on stdout as a single JSON document and nothing else. (Remote `find` already prints JSON.) Progress narration moves to stderr, so a scripted run stays readable in a terminal while the output still parses:

```bash
payload-content status --json | jq '.modified'
payload-content pull --json > result.json      # progress still shown on stderr
```

Shapes:

| Command        | stdout                                                                              |
| -------------- | ----------------------------------------------------------------------------------- |
| `pull`         | `{ outputDir, documents, collections, globals, pruned, preserved }`                 |
| `push`         | `{ pushed, created, conflicts, errors }`                                            |
| `status`       | `{ modified, added, deleted }` — or `null` when nothing has been pulled yet         |
| `diff`         | `{ localOnly, remoteOnly, remoteModified, localModified, bothModified, unchanged }` |
| `find --local` | array of `{ filePath, fields }`                                                     |

`status --json` returns `null` rather than empty arrays when there is no manifest, so "never pulled" stays distinguishable from "no changes".

### Exit codes

| Code | Meaning                                                                                                                                                               |
| ---- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `0`  | Success                                                                                                                                                               |
| `1`  | Error — bad arguments, network/API failure, or a document that failed to push. Also `find` (local or remote) when nothing matched                                     |
| `2`  | `push` only: one or more documents were skipped as conflicts. Nothing was written for those; re-run with `--force` to overwrite, or `pull` to take the remote version |

Code `2` is distinct from `1` so automation can tell "your content is stale" from "the command broke". A `push` that hits both conflicts and errors exits `2`.

---

## Lexical commands

Read and edit Lexical rich text in pulled files by dot path. All commands operate on local files — no API calls.

### Paths

A path starts at a richtext field — `content`, or `layout.1.richText` for one inside an array or blocks row. A number after a richtext value indexes its top-level nodes (`content.3`); from there the path follows the node's JSON, into rich text nested in a block too: `layout.1.richText.3.fields.body.0.children.1.fields.doc.value`. Every command prints full paths, so any output can be fed back as input. A wrong path names the valid keys or index range.

### lexical read — outline, node, or value

```bash
payload-content lexical read page.json
# layout.1.richText.0 h2: Before you go
# layout.1.richText.1 p: Check the entry rules before booking.
# layout.1.richText.2 block alert: Bring cash.
# layout.1.richText.3 block alert [1 link]: See visa requirements first.

payload-content lexical read page.json layout.1.richText.3.fields.body   # rich text nested in the second alert
payload-content lexical read page.json layout.1.richText.0               # a node, without Lexical's defaults
payload-content lexical read page.json layout.1.richText.3 --full        # the stored JSON
```

Without a path, `read` outlines every richtext field. Each line starts with the node's path, ready to pass to the other commands.

### lexical set — replace a node or value

```bash
payload-content lexical set page.json layout.1.richText.0.tag h3
payload-content lexical set page.json layout.1.richText.3.fields.body.0.children.1.fields.doc.value <id>
payload-content lexical set page.json layout.1.richText.1 '{"type":"p","text":"Replaced."}'
payload-content lexical set page.json layout.1.richText.1 --json @node.json
```

The value is JSON-parsed unless the current value is a string. `--json` takes JSON, `@file.json`, or `-` for stdin. Shorthand is refused over links or formatting; set a text node's `text` instead.

### lexical insert / delete — add or remove a node

```bash
payload-content lexical insert page.json layout.1.richText.2 '{"type":"p","text":"New paragraph."}'
payload-content lexical insert page.json layout.1.richText.4 '{"type":"h2","text":"Appended"}'   # index = count appends
payload-content lexical delete page.json layout.1.richText.2
```

`insert` adds before the index the path ends in. Shorthand nodes: `{"type":"p","text"}`, `{"type":"h2","text"}`, `{"type":"ul","items":[…]}`, `{"type":"hr"}`, `{"type":"block","fields":{…}}`, `{"type":"upload","value"}`; full nodes work too. An invalid node leaves the file untouched.

### lexical search — find text

```bash
payload-content lexical search page.json --text "visa"
payload-content lexical search page.json layout.1.richText --text "visa"
# [layout.1.richText.1.children.0] "Check the visa rules..."
```

Without a path, searches every richtext field, nested rich text included. Matches inside a link are marked `(linked)`.

### lexical link — wrap text in an internal link

```bash
payload-content lexical link page.json --text "TypeScript" --relationTo tags --value <id>
payload-content lexical link page.json layout.1.richText --text "TypeScript" --relationTo tags --value <id>

# Copy a link's target from another file, e.g. another locale
payload-content lexical link page_en.json --from page_de.json --link layout.1.richText.3.fields.body.0.children.1
```

Links the first unlinked match at or below the path, or anywhere in the file without one, and prints the link's path and its node's outline line. With `--from`, the link's own text is searched unless `--text` is given.

### lexical diff — compare two files

```bash
payload-content lexical diff page_de.json page_en.json
payload-content lexical diff page_de.json page_en.json layout.1.richText
```

Shows links and blocks, nested ones included, that exist in one file but not the other; the whole file without a path. Useful for locale sync.

### Copying nodes between files

```bash
payload-content lexical read source.json content.8 --full \
  | payload-content lexical insert target.json content.2 --json -
```

A copied block gets a new id.

---

## Utility commands

### me — verify authentication

```bash
payload-content me
```

Confirms the API key works and shows the authenticated user.

### discover — discover available collections and endpoints

```bash
payload-content discover
```

Discovers available collections, globals, and custom endpoints. Shows whether the schema metadata plugin is installed. If endpoints include `custom` metadata (description, schema), those are displayed too — useful for giving agents context about available API actions.

### skill — install agent skill file

```bash
payload-content skill                          # writes .claude/skills/payload-content/SKILL.md
payload-content skill --output ./my-skill.md   # custom output path
```

Installs a Claude Code agent skill with usage instructions. The default path `.claude/skills/payload-content/SKILL.md` is where Claude Code discovers skills automatically.

### clean — delete content directory

```bash
payload-content clean          # interactive confirmation
payload-content clean --yes    # skip confirmation
```

### profile — manage connection profiles

Save connection settings to `~/.payload-content/profiles.json` for reuse across projects. Useful when the CLI is installed globally and you switch between different Payload instances, environments, or permission scopes.

**When to use profiles:**

- **Dev vs production** — point at `localhost:3000` during development, switch to the live URL for production content
- **Different projects** — work with multiple Payload sites from the same machine without juggling `.env` files
- **Different permission scopes** — use a read-only API key for pulling content and a separate admin API key for pushing changes

```bash
# Set up profiles for different environments
payload-content profile add dev --url http://localhost:3000 --api-key dev-key-123
payload-content profile add prod --url https://cms.example.com --api-key prod-key-456

# Set up profiles for different projects
payload-content profile add blog --url https://blog-cms.example.com --api-key blog-key --output-dir blog-content
payload-content profile add docs --url https://docs-cms.example.com --api-key docs-key --output-dir docs-content

# Set up profiles for different permission scopes
payload-content profile add readonly --url https://cms.example.com --api-key readonly-key
payload-content profile add admin --url https://cms.example.com --api-key admin-key
```

Use a profile with any command via `--profile` or `PAYLOAD_PROFILE`:

```bash
payload-content pull --profile dev
payload-content push --profile admin
payload-content find posts --profile prod
PAYLOAD_PROFILE=dev payload-content me                                # set as shell default
```

Manage profiles:

```bash
payload-content profile list                                          # list all profiles
payload-content profile show dev                                      # show a profile's settings (API key is masked)
payload-content profile remove old-project                            # delete a profile
```

**Resolution order** (last wins): profile → `.env` (only when no profile is selected) → real environment variables → explicit overrides.

Selecting a profile via `--profile` or `PAYLOAD_PROFILE` opts out of `.env` autoloading so an ambient `.env` in your cwd cannot silently shadow profile credentials. Real environment variables (set in your shell) still override profile values to match AWS/Stripe CLI behavior, and a warning is printed when this happens.

Flags for `profile add`: `--url`, `--api-key`, `--credential-command`, `--keychain`, `--keychain-prompt`, `--auth-collection`, `--output-dir`.

#### Keeping the API key out of `profiles.json`

`--api-key` is written plaintext to `~/.payload-content/profiles.json` (mode `0600`). To avoid that:

- `--credential-command "<cmd>"` — shell command that prints the key to stdout. Run on demand; the key is held in memory only.

  ```bash
  payload-content profile add prod --url https://cms.example.com \
    --credential-command "op read 'op://Private/payload-prod/api-key'"
  # Works with any helper: `pass show …`, `vault kv get …`, etc.
  ```

- `--keychain` (macOS) — stores `--api-key` in the login Keychain and wires up the matching `credentialCommand` for you. Add `--keychain-prompt` to require a Keychain access prompt on every read (recommended for production keys or shared machines).

  ```bash
  payload-content profile add prod --url https://cms.example.com \
    --api-key 'sk_…' --keychain [--keychain-prompt]
  ```

---

## Directory structure

After `pull`:

```
content/
  .manifest.json             # sync metadata (path → hash + updatedAt)
  _localization.json         # locale config (locales, defaultLocale)
  collections/
    posts/
      _schema.json           # field definitions (type, required, localized, virtual)
      _jsonschema.json       # JSON Schema for editor validation
      <id>.json              # one file per document
      <id>_de.json           # locale-specific file (when pulled with --locale)
  globals/
    site-settings/
      _schema.json
      _jsonschema.json
      site-settings.json
```

### Schema files

Each `_schema.json` describes field types after all plugins have run:

```json
{
  "slug": "posts",
  "fields": [
    { "name": "title", "type": "text", "required": true, "localized": true },
    { "name": "path", "type": "text", "virtual": true, "localized": true },
    { "name": "author", "type": "relationship", "relationTo": "users" },
    {
      "name": "content",
      "type": "richText",
      "lexicalFeatures": {
        "textFormats": ["bold", "code", "italic"],
        "blockNodes": {
          "paragraph": true,
          "heading": { "sizes": ["h2", "h3"] },
          "quote": true,
          "list": { "types": ["bullet", "number"] },
          "horizontalrule": true,
          "upload": { "enabledCollections": ["media"] },
          "relationship": { "enabledCollections": ["authors"] },
          "block": { "slugs": ["callout"] }
        },
        "inlineNodes": {
          "link": { "enabledCollections": ["pages", "posts"] }
        },
        "layoutProps": ["align", "indent"],
        "customNodes": ["spoilerBlock"]
      }
    }
  ]
}
```

Fields with `virtual: true` are computed (e.g. by plugins) and should not be edited.

`richText` fields carry a `lexicalFeatures` summary of the Lexical nodes their editor accepts, so an agent knows what it may emit before authoring content. Each key under `blockNodes`/`inlineNodes` is the exact node `type` string to use, with its options co-located:

- **`textFormats`** — format marks applied to text nodes via the `format` bitmask (`bold`, `italic`, `underline`, `strikethrough`, `code`, `subscript`, `superscript`).
- **`blockNodes`** — block-level node types: `paragraph`, `heading` (`sizes`), `quote`, `list` (`types`: `bullet`/`check`/`number`, set via `listType`), `table`, `horizontalrule`, `upload` and `relationship` (each `enabledCollections`/`disabledCollections`; `upload` also carries per-collection custom `fields`), and `block` (`slugs` for Payload block decorators).
- **`inlineNodes`** — inline node types that appear inside block children: `link` (`enabledCollections`/`disabledCollections`) and `inlineBlock` (`slugs`).
- **`layoutProps`** — properties set on block nodes rather than node types: `align` (text-align) and `indent` (nesting).
- **`customNodes`** — node `type` strings registered by custom features (any feature without a built-in projection). Emit `{ "type": "<value>", ... }` and consult that feature's own docs for the rest of the node's shape. Editor-UI-only features (toolbars, debug views) and built-in node types never appear here.

### Editor validation

`_jsonschema.json` is a standard JSON Schema describing the on-disk shape of each collection or global. Pulled documents include a `"$schema": "./_jsonschema.json"` reference, which IDEs use to validate documents on the fly — flagging missing required fields, wrong types, and invalid enum values.

The `$schema` property is stripped automatically on `push` so Payload never sees it.

---

## Example project

The `example/` directory contains a full Payload v3 app:

```bash
# Setup
pnpm install
cat > example/.env << 'EOF'
PAYLOAD_SECRET=payload-content-cli-dev-secret-key-change-me
DATABASE_URL=mongodb://localhost:27017/payload-content-cli
EOF

pnpm example:seed    # seed test data
pnpm example:dev     # start on port 3939
```

```bash
# Configure CLI
cat > .env << 'EOF'
PAYLOAD_URL=http://localhost:3939
PAYLOAD_API_KEY=test-api-key-for-development
PAYLOAD_AUTH_COLLECTION=api-keys
EOF
```

The seed creates: 1 admin user, 3 categories, 5 posts with translations, 6 pages with block layouts, 5 media items, and 1 global.
