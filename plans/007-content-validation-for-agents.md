---
title: Expose local content validation to agents
type: feature
status: draft
priority: medium
---

# Expose local content validation to agents

The pulled content directory already ships a JSON Schema (`_jsonschema.json` per collection/global, referenced via `$schema` in each content file). Today this is used by IDEs only — VSCode et al. surface red squiggles to humans editing files. Agents writing or modifying content have no equivalent feedback loop and rely on a `push` round-trip to discover that they violated the schema, at which point the error comes from Payload (server-side validation) rather than the local schema and may not be field-precise.

## Current state

- Schema generation lives in `src/plugin/index.ts` (`entityToJsonSchema`). Each pulled collection/global gets `_jsonschema.json` next to its content files; each content file references it via `"$schema": "./_jsonschema.json"`.
- No CLI-side validation. `push` sends the file to Payload and surfaces whatever the API returns.
- Agents can read `_jsonschema.json` directly, but JSON Schema is verbose and a poor fit for token-efficient consumption.

## Options for agent access

### 1. IDE diagnostics via MCP (already available, zero new code)

Claude Code exposes `mcp__ide__getDiagnostics` (and a generic `LSP` tool) that pulls diagnostics from the connected IDE. If the agent is running interactively with the user's editor open, it can fetch the same JSON Schema validation errors the human sees — line/column, message, severity.

- **Pro:** no new code, parity with the human's view, free for any file the IDE has indexed.
- **Con:** only works when the IDE/MCP bridge is running; useless in headless/CI/AFK runs; diagnostics can lag a write the IDE hasn't picked up yet.

Action item: add a one-liner to `src/agent-skill.md` telling agents to call `getDiagnostics` on edited files when an IDE is attached.

### 2. Push-side ajv validation (load-bearing)

Run ajv (or equivalent) against `_jsonschema.json` during `push` before hitting Payload, and emit field-path-precise errors. Turns push into a tight write → validate → fix loop without depending on an IDE being attached.

- **Pro:** works headless; consistent across environments; catches errors before the network round-trip; same schema is used for IDE + agent + CI.
- **Con:** new dependency (ajv or hand-rolled); have to decide whether validation failures are fatal or warnings (probably fatal with `--force` escape hatch); need to make sure error messages are agent-friendly (JSON pointer + message + suggested fix).

### 3. Dedicated `validate` command

`pnpm dev validate [path]` runs the same ajv check standalone. Useful in pre-commit hooks and CI, and gives agents a fast feedback action without invoking `push`.

- **Pro:** explicit, scriptable, no side effects.
- **Con:** another surface; redundant with push-side validation if that exists.

### 4. Compact schema digest

A `schema <collection>` command (already noted in plan 001) that prints a token-efficient summary derived from the same JSON Schema — required fields, types, enums, formats. Different from full JSON Schema: optimized for agent reading rather than IDE validation.

- **Pro:** less noise than raw schema; pairs well with `create` scaffolding.
- **Con:** new code surface; maintenance overlap with the schema itself.

## Open questions

- **Is local (ajv-based) validation worth it at all?** Payload already validates server-side on push. The real gap is that those errors aren't always field-precise when they bubble back through the CLI — that's plan 001's "better error messages from Payload API responses" quick win. If we fix that, most of ajv's value disappears. Adding ajv also means maintaining two validators (our JSON Schema generator + ajv) that have to stay in sync with Payload's actual validation rules; drift between local-strict and server-permissive (or vice versa) creates a worse experience than no local validation. Payload's own `validateField` logic exists in the source and would be more faithful than ajv-against-derived-schema if we ever wanted truly local validation. Provisional answer: skip ajv, lean on (1) IDE diagnostics via MCP and (2) better push-error formatting. Revisit only if headless pre-flight turns out to be a real pain point.
- Should ajv validation be on by default for `push`, or opt-in (`--validate`)? Default-on seems right but may surprise users with stricter local validation than Payload accepts (e.g. server allows missing fields via defaults). (Moot if the answer above is "skip ajv".)
- How do we handle the `additionalProperties: true` divergence from Payload's `false`? Loose validation lets the schema lag behind code; strict validation may reject valid documents.
- Should errors map to Payload's error format so agents see the same shape from both local and server validation?
- Where does this sit relative to plan 001's "better error messages with field-level detail from Payload API responses"? Local validation reduces but doesn't eliminate the need for that.

## Suggested rollout

1. Skill instruction for IDE diagnostics (zero code, immediate value when IDE attached).
2. Push-side ajv validation, default-on, with `--no-validate` escape hatch. Error format: JSON Pointer + message + the offending value.
3. Standalone `validate` command if there's demand for it after #2 ships.
4. Compact schema digest (defer to plan 001's `schema` command work).
