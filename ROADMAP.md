# Roadmap

High-level ideas and open questions. Concrete work lives in `plans/`.

## Done

- Pull collections and globals to JSON files with virtual field stripping
- Push with conflict detection (manifest-based)
- Status (offline) and diff (online) commands
- CRUD commands: find, create, update, delete, count, versions, restore, duplicate, upload, request
- Lexical editing commands: read, set, insert, delete, link, search, diff
- Per-locale file model (`{id}_en.json`, `{id}_de.json`)
- Draft support on pull and push
- Dot-path addressing for lexical commands, through blocks into nested rich text
- Payload plugin for schema endpoint
- Stdin support for lexical piping (`--json -`)
- `--where` filtering on pull and CRUD commands
- `me` command for auth verification
- `skill` command for agent skill installation
- Grouped `--help` output
- Profiles for switching between CMS instances (`--profile`, `PAYLOAD_PROFILE`)
- Batch upload (`upload --dir` / `--glob` with concurrency and `--dry-run`)

## Ideas / Open questions

- Rename the package — it has grown beyond a CLI (`./lexical`, `./plugin`, `./mcp`) into a content interface for agents. A rename costs the npm name, links and installs; decide before 1.0.
- One way to address rich text across the CLI and the MCP tools — see `plans/015-one-rich-text-addressing-scheme.md`.
- Programmatic library entry point — expose `pull`/`push`/`status`/`diff`/`PayloadClient` via the package root for scripts and CI. The internals are already library-shaped (functions throw `CliError` instead of exiting, `push` returns a result summary), so this is mostly deciding on and committing to a public API surface.
- Human approval before push — commit/push model, push queue, or CMS-side review?
- Watch mode
- Versions/drafts in sync workflow — pull version history to files, diff between versions
- Multi-tenant support — base filters for tenant-scoped operations within a single instance (distinct from profiles, which switch between instances)
- Expose local content validation to agents — JSON Schema is consumed by IDEs today; agents can use `mcp__ide__getDiagnostics` when an IDE is attached, but a push-side ajv check is needed for headless runs (see `plans/006-content-validation-for-agents.md`)
