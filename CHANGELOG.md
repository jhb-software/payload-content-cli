# Changelog

## Unreleased

- Feat: `profile add` can keep the API key out of `profiles.json`. Use `--credential-command "<cmd>"` to fetch it from any external store (1Password, pass, Vault, …) on demand, or `--keychain` on macOS to seed the login Keychain and wire it up automatically. Add `--keychain-prompt` to require a Keychain access prompt on every read. `profile remove` cleans up Keychain entries it created.
- Feat: schema endpoint now includes static `defaultValue` per field. Function defaults are skipped because they require runtime context (req, user, locale).
- Fix: unnamed `group` fields are now hoisted into the parent schema (same as `row` / `collapsible`) instead of being silently dropped, so their child fields appear in the schema endpoint output.
- Fix: `upload` no longer silently skips the cloud-storage (S3) upload when combined with `--select`. Workaround for [payloadcms/payload#16670](https://github.com/payloadcms/payload/issues/16670) — `filename`, `mimeType`, `filesize`, and `sizes` are now always preserved in the request's `select` so the cloud-storage afterChange hook still receives them.

## 0.1.0

Initial public release. The API is subject to change until 1.0.0.
