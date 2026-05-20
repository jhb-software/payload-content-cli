# Changelog

## Unreleased

- Fix: unnamed `group` fields are now hoisted into the parent schema (same as `row` / `collapsible`) instead of being silently dropped, so their child fields appear in the schema endpoint output.
- Fix: `upload` no longer silently skips the cloud-storage (S3) upload when combined with `--select`. Workaround for [payloadcms/payload#16670](https://github.com/payloadcms/payload/issues/16670) — `filename`, `mimeType`, `filesize`, and `sizes` are now always preserved in the request's `select` so the cloud-storage afterChange hook still receives them.

## 0.1.0

Initial public release. The API is subject to change until 1.0.0.
