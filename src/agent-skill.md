---
name: payload-content
description: |
  Manages Payload CMS content via the payload-content CLI. Supports CRUD operations,
  content sync (pull/push), richtext editing, and locale management.
  Use when reading, creating, updating, deleting, or syncing CMS content, editing
  richtext nodes, or working with locales.
user-invocable: false
---

# Payload Content CLI

Manages Payload CMS content from the command line. Provides two modes: direct CRUD for simple changes and file-based content sync for bulk edits.

## Overview

The `payload-content` CLI connects to a Payload CMS instance and exposes content operations. CRUD commands (`find`, `update`, `create`, `delete`, `upload`) work directly against the API. Content sync (`pull` → edit → `push`) downloads documents as JSON files for local editing.

Run `payload-content --help` to discover all commands and options.

## Prerequisites

- `payload-content` CLI installed and on PATH
- Environment configured with required environment variables
- Plugin is optional — needed only for `_schema.json` / `_jsonschema.json` files, virtual-field stripping, and custom endpoint metadata in `discover`. Run `payload-content discover` to check whether it is installed. To install it, add to `payload.config.ts`:

  ```ts
  import { contentCliPlugin } from "@jhb.software/payload-content-cli/plugin";

  export default buildConfig({
    plugins: [contentCliPlugin()],
  });
  ```

## Instructions

### Step 1: Verify connectivity and discover the API

Before doing any real work, always run these two commands:

```bash
payload-content me                # confirm auth works
payload-content discover          # list collections, globals, and custom endpoints
```

`discover` lists available collection and global slugs. If the content-cli plugin is installed, it also lists custom endpoints registered by plugins (with descriptions and schemas).

### Step 2: Choose the right mode for the task

- **Quick CRUD** (`find`, `update`, `create`, `delete`, `upload`) — for simple, targeted changes: toggling a status, updating a title, uploading media, checking a field value. No local files needed.
- **Content sync** (`pull` → edit → `push`) — for bulk edits, richtext changes, or when the full document structure is needed. Edit files locally and push once.

Start with CRUD. Escalate to content sync when constructing JSON inline becomes harder than editing files.

**Important:** For `create`, `update`, and `request` commands, prefer `--file` over `--data`. Write your JSON to a temporary file and pass it with `--file`. Only use `--data` for trivially small inline JSON (e.g. a single field). Never pipe `cat` into `--data`.

### Step 3: Read schemas before editing

Read `_schema.json` files to understand field types. Fields with `virtual: true` are computed and read-only — never include them in updates.

### Step 4: Minimize response size

- Use `--select` to request only needed fields. Works on `find`, `create`, and `update`.
- Use `--depth 0` to avoid expanding relationships. Only increase depth when populated data is actually needed.
- Use `--where` to scope operations: `'{"slug":{"equals":"hello"}}'` (Payload query syntax as JSON).

### Step 5: Preview before writing

Use `--dry-run` on push to preview changes before committing them.

### Step 6: Use lexical subcommands for richtext

Prefer `lexical` subcommands (`add`, `remove`, `replace`, `set`) over rewriting the entire Lexical tree. Use `lexical list` to see node structure first. Pipe nodes between files with `lexical get` and `lexical add`.

### Step 7: Handle locales

Pull multiple locales (`--locale en de`), use `lexical diff` to compare, and `lexical link --from` to sync links between locale files.

## Output

Commands return JSON to stdout. CRUD commands return the affected document(s). Content sync writes JSON files to a local content directory. `payload-content status` shows pending changes as a diff summary.

## Examples

### Quick read — only fetch what you need

```bash
payload-content find posts --where '{"slug":{"equals":"hello"}}' --select '{"title":true,"slug":true}' --depth 0
```

### Quick update

```bash
# For non-trivial data, write a file and use --file
payload-content update posts <id> --file changes.json --select '{"id":true,"title":true}'
# For single-field updates, inline --data is fine
payload-content update posts <id> --data '{"title":"New Title"}' --select '{"id":true,"title":true}'
```

### Bulk workflow

```bash
payload-content pull --collections posts
# ... edit files ...
payload-content status          # see what changed
payload-content push --dry-run  # preview
payload-content push            # commit
```

### Upload media

```bash
payload-content upload media --file ./photo.jpg --data '{"alt":"Hero image"}'
payload-content upload media --url "https://example.com/image.png" --data '{"alt":"Remote image"}'
echo '<svg>...</svg>' | payload-content upload media --filename icon.svg --data '{"alt":"Icon"}'
```

### Richtext surgery

```bash
payload-content lexical list <file>
payload-content lexical add <file> --at 0 --position after --paragraph "New text."
```

## Error Handling

| Error                            | Cause                               | Solution                                                    |
| -------------------------------- | ----------------------------------- | ----------------------------------------------------------- |
| Auth failure on any command      | Missing or expired credentials      | Run `payload-content me` to verify auth configuration       |
| Virtual field in update payload  | Included a `virtual: true` field    | Read `_schema.json` and remove virtual fields from the data |
| Unexpected nested objects        | Default depth expands relationships | Add `--depth 0` to keep references as IDs                   |
| Push conflict or unexpected diff | Stale local files                   | Re-pull, review `status`, then push again                   |

Run `payload-content <command> --help` for full options on any command.
