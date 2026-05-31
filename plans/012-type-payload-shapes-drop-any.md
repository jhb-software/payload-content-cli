---
title: Replace structural `any` with typed Payload shapes
type: refactor
status: draft
---

# Replace structural `any` with typed Payload shapes

Every plugin module (`index.ts`, `schemaApi.ts`, `fields.ts`, `lexical.ts`,
`jsonSchema.ts`) opens with `/* eslint-disable @typescript-eslint/no-explicit-any */`.
The `any` is deliberate — the file headers state types are kept inline "to avoid a
hard dependency on `payload`." We type Payload's config, fields, editor, and `req`
as `any` so the plugin never `import`s from `payload` / `@payloadcms/richtext-lexical`.

Dropping the disable means choosing one of two tradeoffs:

- **Option A — type-only dependency.** Import `Field`, `SanitizedConfig`,
  `PayloadRequest`, and the lexical feature types from `payload` /
  `@payloadcms/richtext-lexical` as `import type` only. Cleanest types, but
  reverses the stated "no hard dependency" decision (even type-only imports add a
  version-coupled devDependency and can break across Payload majors).
- **Option B — minimal structural interfaces.** Hand-write interfaces for just the
  slices of Payload config the plugin touches (field nodes, editor config,
  `req.payload.config`). Keeps zero runtime/type dependency, but is real work and a
  standing drift risk against Payload's real shapes on every upgrade.

This is a design tradeoff, not a mechanical cleanup — needs an explicit decision
before implementing. Keep it out of unrelated diffs so it stays reviewable on its
own. No user-visible behavior change either way.

## Open question

Which option, A or B? (Leaning B to preserve the no-dependency design, accepting the
maintenance cost.)
