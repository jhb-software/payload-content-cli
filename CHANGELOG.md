# Changelog

## Unreleased

- feat: the plugin's schema response now carries a contract `version`; the CLI warns when the installed plugin and CLI speak different contract versions instead of silently mis-parsing.
- fix: the plugin resolves custom endpoint paths against `routes.api` instead of hardcoding `/api`, and applying the plugin twice no longer registers the schema endpoint twice.
- fix: mutating requests (create/update/upload/push) are no longer retried after mid-flight network errors or 5xx responses — a flaky connection can no longer create duplicate documents. Reads retry as before; rate-limited (429) and never-sent requests still retry.
- fix: `_jsonschema.json` now emits array types for `hasMany` text and number fields instead of falsely flagging pulled arrays as invalid.
- fix: `join` fields are marked virtual and excluded from JSON schemas, so pulls strip this read-only data instead of round-tripping it into invalid pushes.
- fix: a throwing `access.read` function now logs a warning naming the entity instead of silently dropping it from the schema response.
- fix: `push`/`status` no longer warn `Could not scan content directory` when a content type was intentionally not pulled (e.g. a collections-only pull leaves no `globals/` directory). A missing root directory is treated as "nothing of that type"; only genuine errors (permissions, etc.) are reported.

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
