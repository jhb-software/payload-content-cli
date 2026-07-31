---
title: Remaining debt from the pre-stable codebase audit
type: refactor
status: draft
---

# Remaining debt from the pre-stable codebase audit

What is left of a foundation audit run against 0.3.0 (2026-07-07) and re-checked
against 0.4.0 (2026-07-31). The audit's other ~36 findings shipped across the 0.4.0
cycle — schema contract, error model, deduplication, lexical extraction and testing,
plugin projection fixes, CI hardening, `--json` and exit-code docs. Only the items
below are open.

None of these get more expensive after a stable release, so none of them block 1.0.
The two contract-shaped items that *would* have (the schema contract and the
exit-code/`--json` surface) are already done.

## Correctness

- **Endpoints are captured at plugin-apply time, entities at request time**
  (`src/plugin/index.ts`). Endpoints registered by plugins applied *after* this one
  are invisible to the schema response, so plugin order matters and is undocumented.
  Fix by resolving endpoints at request time, or document the ordering requirement.

## Tests

- **Integration tests restore shared seed state by hand, without `try`/`finally`**
  (`src/__tests__/integration.test.ts`). A mid-test failure leaves the seed dirty and
  poisons later runs. The cross-file race is already fixed (`fileParallelism: false`);
  this is the remaining half. Prefer per-test documents over mutate-and-restore.
- **Tests pin exact seed contents** (`toHaveLength(5)`, exact locale lists), so any
  seed change breaks unrelated tests. Assert invariants or derive counts from the
  seed module.
- **No argv-level coverage for `me`, `discover`, `duplicate`, `restore`, `request`** —
  they are exercised through `PayloadClient` only, so flag parsing is untested.

## Ergonomics (no behaviour change)

- **`PayloadClient` redeclares near-identical option bags ~15×** (`src/client.ts`).
  Compose from the shared `CommonOpts`/`PaginationOpts`/`PublishOpts` instead.
- **`push` is sequential** while `pull` and bulk `upload` are pooled. Fine at current
  scale; the asymmetry is what will surprise the next contributor.
- **`as Record<string, unknown>` casts pervade lexical field/children access**, because
  `LexicalNode` is an index-signature type. Collapse into one accessor pair
  (`getFields`, `getChildren`) in `src/lexical/types.ts`.

## Features, not debt

- **`lexical search` reports only the first match per text node, and `lexical link`
  links only the first match**, with no `--all` or address-targeted variant. Worth a
  decision on intended semantics before it becomes contract.

## Deliberately not tracked

- The programmatic library entry point (exporting `pull`/`push`/`status`/`diff`/
  `PayloadClient` from the package root) lives in ROADMAP.md, not here — it is a new
  public API surface, not debt. It is additive now that the root export is gone, so it
  breaks nobody whenever it lands.
