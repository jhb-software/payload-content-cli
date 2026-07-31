---
title: Replace structural `any` with typed Payload shapes
type: refactor
status: done
---

# Replace structural `any` with typed Payload shapes

Every plugin module (`index.ts`, `schemaApi.ts`, `fields.ts`, `lexical.ts`,
`jsonSchema.ts`) opens with `/* eslint-disable @typescript-eslint/no-explicit-any */`.
The `any` is deliberate — the file headers state types are kept inline "to avoid a
hard dependency on `payload`." We type Payload's config, fields, editor, and `req`
as `any` so the plugin never `import`s from `payload` / `@payloadcms/richtext-lexical`.

The open question was which tradeoff to take:

- **Option A — type-only dependency.** Import `Field`, `SanitizedConfig`,
  `PayloadRequest` and the lexical feature types as `import type` only. Cleanest
  types, but reverses the "no hard dependency" decision.
- **Option B — minimal structural interfaces.** Hand-write interfaces for the
  slices of Payload config the plugin touches. Zero dependency, but real work and
  a standing drift risk on every Payload upgrade.

## Decision (2026-07-31): neither — keep the `any`, pin the behaviour with a test

Both options answer "how do we describe Payload's shapes?" when the actual goal is
"how do we find out when Payload's shapes change under us." A test answers that
directly and more cheaply.

**Option A was rejected on a cost the framing missed.** The `any`s in question sit
on *exported* signatures (`contentCliPlugin(config: any): any`,
`getEntitySchema({ req: any })`). Typing them bakes payload types into our published
`.d.ts`, so a consumer whose payload version drifted gets errors from *our* package —
turning an optional peer into a required one. That is a worse outcome than the `any`.

**Option B was rejected as effort without coverage.** Hand-written interfaces encode
our assumptions, so they agree with us, not with Payload — the same blind spot the
hand-built test fixtures already had.

**What shipped instead:** `payload` and `@payloadcms/richtext-lexical` as
devDependencies (cost ≈ 0 — `example/` already pinned both, so the lockfile grew 9
lines with no new downloads), plus `src/plugin/__tests__/real-config.test.ts`, which
runs a real `buildConfig()` and a real `lexicalEditor()` through the endpoint handler
with no network or database.

This targets where the risk actually was. Core field projection was already covered
against real Payload by the integration suite (it asserts `_schema.json` served by the
running example server). The uncovered part was `lexicalFeatures` — and no amount of
typing could have covered it, because `resolvedFeatureMap` and
`sanitizedServerFeatureProps` live in `@payloadcms/richtext-lexical` and are public
types nowhere. That code reads them defensively (`instanceof Map`, `Array.isArray`,
fallbacks) *by design*, for version tolerance; strict types would fight the design
rather than validate it.

The test asserts every configured feature maps to a typed node and that `customNodes`
stays empty — the exact silent-degradation path a renamed feature key would take.
Verified by mutation: renaming one `FEATURE_PROJECTIONS` key fails the test.

The `eslint-disable` lines stay, and the file headers' "types are kept inline to avoid
a hard dependency on `payload`" remains accurate for shipped code — the dependency is
dev-only and confined to tests.
