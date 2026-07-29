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
import {
  listReadableEntities,
  getEntitySchema,
} from "@jhb.software/payload-content-cli/plugin";

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

Each `FieldSchema` carries `system: true` for fields Payload injects rather than the author declaring them (`createdAt`, `updatedAt`, `_status`, `blockName`, and generated array/block row `id`s — but not a collection's custom ID field), `hasCondition: true` when the field is gated by an `admin.condition`, and `filterOptions` when a static filter constrains which related documents may be assigned. `system` marks bookkeeping, not a write ban: `_status` is the publish control and `createdAt` is accepted on create.

### Edit richtext from your own code

The Lexical toolkit behind the `lexical` commands is exported separately, for tools that fetch and save documents themselves — an MCP `updateRichText`, a migration script, a seed. It is pure: no filesystem, no network, no Payload import.

```ts
import {
  readRichText,
  editRichText,
  buildParagraph,
} from "@jhb.software/payload-content-cli/lexical";

const doc = await payload.findByID({ collection: "posts", id, depth: 0, req });

// What's in the field? Each entry carries the address the edits take.
readRichText(doc, "content", { depth: 1 });
// → [{ address: "0", type: "heading", tag: "h2", preview: '"Intro"' },
//    { address: "1", type: "block", blockType: "cta", preview: "(cta)" }, ...]

editRichText(doc, "content", { op: "insertAfter", address: "0", node: buildParagraph("New") });

await payload.update({ collection: "posts", id, data: { content: doc.content }, req });
```

`editRichText` is the only way to change a field: it resolves the field, applies the edit, validates the result, and writes it back into `doc` — mutating only the field's children, so you can send the top-level field back as a whole. If anything fails, `doc` is left exactly as it was.

Edits are `{ op, … }`: `append` and `prepend` (no address needed — they work on an empty field), `insertBefore`, `insertAfter`, `insertInside`, `replace`, `remove`, `setProp`, and `linkText`. Pass an array to apply several in one go — resolved once, validated once, written once, and all-or-nothing if one of them fails:

```ts
editRichText(doc, "content", [
  { op: "replace", address: "0", node: buildHeading("New title") },
  { op: "setProp", address: "2", key: "format", value: "center" },
  { op: "linkText", search: "our docs", node: buildInternalLink("our docs", "pages", pageId) },
]);
```

- **One level of abstraction.** Every function takes the document and a field path — never a bare tree — so nothing in your code has to know that a richtext value is `{ root: { children } }`. Reads hand back copies; `editRichText` is the only way to change a field.
- **Addresses, not indexes.** `"3"` is the fourth top-level node, `"3.1"` its second child — so nested nodes are reachable. `readRichText` returns each node's address, type, and text preview, plus the one property that identifies it: `tag` for headings, `listType`/`itemCount` for lists, `blockType` for blocks. `{ depth: 1 }` keeps the summary to the top level.
- **Errors you can branch on.** Failures throw `LexicalError` with a `code`: `FIELD_NOT_FOUND`, `INVALID_ADDRESS`, `ADDRESS_OUT_OF_BOUNDS`, `NOT_A_CONTAINER`, `INVALID_TREE`, `INVALID_NODE`. All of them mean the input was wrong, so a tool can relay the message to whoever sent it instead of reporting a fault.
- **Node builders.** `buildParagraph`, `buildHeading`, `buildList`, `buildText`, `buildHorizontalRule`, `buildBlock`, `buildInternalLink`, and `buildElement` for any other node type. The element builders take plain text or ready-made inline nodes — `buildParagraph([buildText("see "), link])` — and every built node passes validation as-is.
- **Field paths resolve through blocks.** A path walks plain properties and array indexes, and descends into a lexical block by its `blockType` — `"content.TwoColumnRichText.firstColumn"` reaches the richtext field inside a block nested in `content`.
- **Reads.** `readRichText` for the map, `getRichTextNode` for one node, `searchRichText` for text not already inside a link, `extractRichTextLinks`/`extractRichTextBlocks` for inventories, and `diffRichText(source, target, field)` for comparing locale variants. Plus the `LexicalNode` types and their guards (`isTextNode`, `isLinkNode`, `hasChildren`).

Fetching and saving stay yours, and with them the decisions the CLI can't make for you: access control (`overrideAccess: false`), which locale, and whether the write is a draft.

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

Flags: `--where`, `--select`, `--limit`, `--page`, `--sort`, `--depth`, `--locale`, `--fallback-locale`, `--draft`, `--trash`, `--joins`, `--populate`, `--pagination` / `--no-pagination`, `--local`.

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
```

Without arguments, pushes files that changed since last pull. Detects conflicts (remote modified after your last pull) and exits with code 2 unless `--force` is set.

`push` and `pull` refuse to run if the manifest's recorded server URL differs from the current `PAYLOAD_URL` — this protects you from pushing staging content to prod (or vice versa) after a profile/env switch. Pass `--allow-url-change` if the switch is intentional.

### status — local changes (offline)

```bash
payload-content status
```

Shows modified (M), added (A), and deleted (D) documents. No API call needed.

### diff — local vs remote comparison

```bash
payload-content diff
```

Shows which documents have local changes, remote changes, or both (conflicts).

---

## Lexical commands

Surgical editing of Lexical richtext fields. All commands operate on local files — no API calls.

### Node addressing

Nodes are addressed by index path from the root's children: `0` = first child, `2.1` = third child's second child. Use `lexical list` to discover addresses.

### Field auto-detection

If `--field` is omitted, the tool finds the Lexical richtext field automatically. Use `--field` when a document has multiple richtext fields (e.g. page blocks): `--field "layout[0].richText"`.

### lexical list — show node tree

```bash
payload-content lexical list <file>
payload-content lexical list <file> --field "layout[0].richText"

# Output:
# [0] heading  "Getting Started"
# [1] paragraph  "Payload CMS is a powerful..."
# [2] paragraph  "In this tutorial, we will..."
```

### lexical get — extract a node as JSON

```bash
payload-content lexical get <file> --at 0
payload-content lexical get <file> --at 2.1 --field "layout[0].richText"
```

### lexical add — insert a node

```bash
payload-content lexical add <file> --at 0 --position after --paragraph "New paragraph."
payload-content lexical add <file> --at 0 --position before --heading "New Section" --tag h2
payload-content lexical add <file> --position end --paragraph "Appended."
payload-content lexical add <file> --position end --json '{"type":"paragraph",...}'
payload-content lexical add <file> --position end --json -         # read from stdin
```

Node shorthands: `--paragraph "text"`, `--heading "text" --tag h2`, `--text "text"`. Use `--json` for custom node types.

### lexical replace — replace a node

```bash
payload-content lexical replace <file> --at 2 --json '{"type":"paragraph",...}'
payload-content lexical replace <file> --at 2 --paragraph "Replaced text."
```

### lexical remove — remove a node

```bash
payload-content lexical remove <file> --at 3
```

### lexical set — modify a node property

```bash
payload-content lexical set <file> --at 0 --prop tag --value h3
payload-content lexical set <file> --at 1.0 --prop text --value "Updated text"
```

### lexical search — find unlinked text matches

```bash
payload-content lexical search <file> --text "TypeScript"
payload-content lexical search <file> --text "TypeScript" --field "layout[0].richText"
```

Prints addresses and surrounding context for matches. Skips already-linked text.

### lexical link — wrap text in an internal link

```bash
# Manual: specify collection and ID
payload-content lexical link <file> --search "TypeScript" --relationTo tags --value <id>

# From another file: copy link definition
payload-content lexical link target.json --from source.json --at 2.1
payload-content lexical link target.json --from source.json --at 2.1 --search "English text"
```

### lexical diff — compare two files

```bash
payload-content lexical diff file_de.json file_en.json --field content
```

Shows links and blocks that exist in one file but not the other. Useful for locale sync.

### Piping nodes between files

Copy nodes between files by piping `lexical get` into `lexical add`:

```bash
# Copy node 8 from one file and append to another
payload-content lexical get source.json --at 8 \
  | payload-content lexical add target.json --position end --json -

# Replace a node with one from another file
payload-content lexical get source.json --at 2 \
  | payload-content lexical replace target.json --at 4 --json -
```

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
