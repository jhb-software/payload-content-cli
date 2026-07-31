# Changelog

## 0.4.0

- **breaking:** the package root (`"."`) is no longer exported. It mapped to `dist/cli.js`, so importing it ran dotenv loading, argv parsing and possibly `process.exit` as a side effect rather than exposing an API. Use the `payload-content` binary for the CLI, and `./plugin` or `./lexical` for programmatic use.
- **breaking:** the exported `getEntitySchema` follows progressive disclosure — a `blocks` field now returns its `blockSlugs` instead of inlining every block definition, and `jsonSchema` is omitted (it would re-inline them). Pass `blocks: "inline"` for the previous self-contained shape. The `/content-cli/schema` endpoint and the CLI are unchanged.
- feat: the Lexical toolkit behind the `lexical` commands is exported as `@jhb.software/payload-content-cli/lexical`, so server-side tools (e.g. an MCP `updateRichText`) can edit richtext without the CLI. `editRichText(doc, field, edit)` is the single way in: it resolves the field, applies one edit or a batch, validates the result, and writes it back, leaving the document untouched if any step fails. Alongside it: reads that take the same document-and-field-path arguments and return copies (`readRichText`, `getRichTextNode`, `searchRichText`, `extractRichTextLinks`/`extractRichTextBlocks`, `diffRichText`), builders for paragraphs, headings, lists, rules, blocks, links and any other element node, and `LexicalError` with a `code` so a caller can tell bad input from a genuine fault.
- feat: `getBlockSchema` resolves the slugs `getEntitySchema` reports, itself referencing nested blocks by slug. It resolves blocks declared inline on a field or in a lexical `BlocksFeature`, not just those registered on `config.blocks`.
- feat: field schemas now flag Payload-injected bookkeeping fields (`system`), fields gated by an `admin.condition` (`hasCondition`), and static `filterOptions` on relationship/upload fields, so agents can hide bookkeeping and see which related documents a field accepts.
- feat: the plugin exports `extractLexicalSummary`, so consumers with their own field walker can build a richText field's `LexicalFeatureSummary` directly instead of routing the field through `toFieldSchemas`.
- feat: the plugin's schema response now carries a contract `version`; the CLI warns when the installed plugin and CLI speak different contract versions instead of silently mis-parsing.
- feat: `find` gained `--page` for paging through large collections.
- feat: `pull`, `push`, `status`, `diff`, and `find --local` accept `--json`, putting the result on stdout as a single JSON document and moving progress narration to stderr, so a scripted run stays both parseable and observable. Exit codes are now documented as part of the contract (`2` = push conflicts, distinct from `1` = error).
- feat: mutating `lexical` commands validate the resulting tree before writing and refuse to write invalid documents (previously they wrote first and warned after).
- fix: mutating requests (create/update/upload/push) are no longer retried after mid-flight network errors or 5xx responses — a flaky connection can no longer create duplicate documents. Reads retry as before; rate-limited (429) and never-sent requests still retry.
- fix: the plugin resolves custom endpoint paths against `routes.api` instead of hardcoding `/api`, and applying the plugin twice no longer registers the schema endpoint twice.
- fix: `find --local --where` rejects unsupported operators (e.g. `not_equals`) with a clear error instead of silently matching the wrong documents, and `equals` now matches exactly instead of by substring.
- fix: manifest keys are always written with `/` separators, making pulled content directories portable between Windows and macOS/Linux.
- fix: `diff` now checks legacy flat `globals/<slug>.json` files instead of silently skipping them.
- fix: `push` prints a warning when a conflict check fails (e.g. server error) instead of silently skipping conflict detection for that document.
- fix: `push`/`status` no longer warn `Could not scan content directory` when a content type was intentionally not pulled (e.g. a collections-only pull leaves no `globals/` directory). A missing root directory is treated as "nothing of that type"; only genuine errors (permissions, etc.) are reported.
- fix: `_jsonschema.json` now emits array types for `hasMany` text and number fields instead of falsely flagging pulled arrays as invalid.
- fix: `join` fields are marked virtual and excluded from JSON schemas, so pulls strip this read-only data instead of round-tripping it into invalid pushes.
- fix: a throwing `access.read` function now logs a warning naming the entity instead of silently dropping it from the schema response.
- fix: `lexical diff` and `lexical link --from` now resolve populated relationship objects (depth>0 pulls) to their document ID instead of rendering `[object Object]`.
- fix: `lexical search`/`lexical link` no longer match text inside autolink nodes, `lexical diff` finds blocks nested in container nodes, and invalid `--tag` values or conflicting node flags are rejected with clear errors.
- fix: corrected the `relationship` lexical node docs — `relationTo`/`value` live on the node itself, not under `fields`.

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
