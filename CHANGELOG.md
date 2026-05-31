# Changelog

## 0.3.1

- fix: the plugin's exported API (`contentCliPlugin`, `toFieldSchemas`, `getEntitySchema`, `getBlockSchema`, `listReadableEntities`) is now typed against Payload's own `Config`/`Field`/`PayloadRequest` shapes instead of `any`, so consumers get type-checking and autocomplete. `payload` is declared as an optional peer dependency and imported type-only — nothing is added to the runtime.

## 0.3.0

- feat: the plugin entry now exports the schema API for building custom tools (e.g. `listEntities` + `getEntitySchema` + `getBlockSchema` MCP tools) without going through HTTP. `listReadableEntities({ req })` returns the readable collection/global slugs plus localization; `getEntitySchema({ req, type, slug })` returns the same `{ slug, fields, jsonSchema }` the `/schema` endpoint produces for one entity; `getBlockSchema({ req, slugs })` resolves richText block slugs to `{ slug, fields }`.
- feat: schema endpoint now reports the enabled Lexical nodes of each `richText` field under a `lexicalFeatures` key, organized by where each node lives in richtext JSON. Every key is the exact node `type` to emit, so agents know what a field accepts before authoring. Surfaces in `_schema.json`.
- **breaking:** renamed the exported `extractFields` to `toFieldSchemas`

## 0.2.0

- feat: API keys can now be stored outside `profiles.json`. `profile add` gained `--credential-command "<cmd>"`, which resolves the key on demand from an external store (1Password, pass, Vault, …), and `--keychain`, a macOS shortcut that stores the key in the login Keychain and wires up the matching credential command automatically.
- fix: schema endpoint now includes static `defaultValue` per field.
- fix: unnamed `group` fields are now hoisted into the parent schema (same as `row` / `collapsible`) instead of being silently dropped, so their child fields appear in the schema endpoint output.
- fix: `upload` no longer silently skips the cloud-storage (S3) upload when combined with `--select`. Workaround for [payloadcms/payload#16670](https://github.com/payloadcms/payload/issues/16670) — `filename`, `mimeType`, `filesize`, and `sizes` are now always preserved in the request's `select` so the cloud-storage afterChange hook still receives them.

## 0.1.0

Initial public release. The API is subject to change until 1.0.0.
