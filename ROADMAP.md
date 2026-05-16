# Roadmap

High-level ideas and open questions. Concrete work lives in `plans/`.

## Done

- Pull collections and globals to JSON files with virtual field stripping
- Push with conflict detection (manifest-based)
- Status (offline) and diff (online) commands
- CRUD commands: find, create, update, delete, count, versions, restore, duplicate, upload, request
- Lexical editing commands: list, get, add, replace, remove, set, link, search, diff
- Per-locale file model (`{id}_en.json`, `{id}_de.json`)
- Draft support on pull and push
- Block-aware `--field` paths for lexical commands
- Payload plugin for schema endpoint
- Stdin support for lexical piping (`--json -`)
- `--where` filtering on pull and CRUD commands
- `me` command for auth verification
- `skill` command for agent skill installation
- Grouped `--help` output
- Profiles for switching between CMS instances (`--profile`, `PAYLOAD_PROFILE`)

## Ideas / Open questions

- Human approval before push — commit/push model, push queue, or CMS-side review?
- Lexical to Markdown conversion
- Watch mode
- Versions/drafts in sync workflow — pull version history to files, diff between versions
- Multi-tenant support — base filters for tenant-scoped operations within a single instance (distinct from profiles, which switch between instances)
- Batch upload — bulk upload of media files (images, PDFs, etc.) in a single command (e.g. from a directory), with progress and error reporting
- Expose local content validation to agents — JSON Schema is consumed by IDEs today; agents can use `mcp__ide__getDiagnostics` when an IDE is attached, but a push-side ajv check is needed for headless runs (see `plans/007-content-validation-for-agents.md`)
