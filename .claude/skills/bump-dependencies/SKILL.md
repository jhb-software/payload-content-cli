---
name: bump-dependencies
description: Run the bundled bump-dependencies.sh to bump the workspace dependencies (root package + example app), then walk every non-patch version change to surface breaking changes and apply any code updates needed. Also audits the workspace for security advisories (audit-dependencies.sh) and fixes them via override floors or direct-dependency pins. Use when the user says "bump dependencies", "upgrade dependencies", "update dependencies", "audit dependencies", "check for vulnerabilities", or "check for GitHub advisories".
---

# Bump dependencies, review breaking changes, clear advisories

Goal: bump the dependencies via the bundled script, then for every non-patch jump confirm the CLI, plugin, MCP tools and Lexical toolkit still work against the new version — read the upstream changelog, grep `src/` and `example/src/` for affected APIs, and apply fixes. Finish with a clean `pnpm audit`.

## Audit-only runs

If the user only asks to audit / check for vulnerabilities, skip the bump steps and go straight to [Audit for vulnerabilities and fix them](#audit-for-vulnerabilities-and-fix-them). Still require a clean tree first.

## Steps

1. **Confirm a clean tree.** `git status --porcelain` must be empty so the diff in step 3 is meaningful. If dirty, tell the user and stop.

2. **Run the script** from the repo root:

   ```sh
   ./.claude/skills/bump-dependencies/bump-dependencies.sh
   ```

   It runs `pnpm -r up --latest`, reinstalls, regenerates the example's Payload types/importmap, runs `typecheck`, `lint`, `test`, and smoke-tests the example dev server. Don't reimplement any of this. If the script reports `FAILED`, stop and surface the error verbatim. `pnpm test` runs integration suites against the example app and needs MongoDB (`DATABASE_URL`), a running `pnpm example:dev`, and `pnpm example:seed` (see the `test` job in `.github/workflows/ci.yml`). If a step fails only because one of these is missing, report that instead of treating it as a regression.

3. **List non-patch bumps.** From the resulting diff, extract every dependency whose new version is a minor or major jump. Patch bumps (`1.2.3 → 1.2.4`) are skipped. Treat `0.x` specially: any change to the `0.<minor>` segment is breaking by semver convention (`^0.5.2 → ^0.6.0` counts).

   ```sh
   git diff --no-color -- package.json example/package.json
   ```

   Group by dependency so a Payload bump (`payload`, `@payloadcms/*`) is reviewed once.

4. **For each non-patch bump, read the upstream changelog.** Pick the cheapest source that covers all intermediate versions, not just the new one:
   - **GitHub Releases** — best for Payload (`payloadcms/payload`), `vitest`, `next`, `commander`, `zod`.
   - **`npm view <pkg> --json`** — fallback; `homepage` + `repository.url` give the next hop.
   - **WebFetch** the package's `CHANGELOG.md` when releases are empty.

   Read every release between OLD and NEW (exclusive of OLD, inclusive of NEW). Look for: `BREAKING`, `removed`, `renamed`, `deprecated`, peer-dependency changes, behavior changes in APIs this package uses.

5. **Grep for affected APIs.** For each breaking change, grep `src/` and `example/src/` for the symbol/option/import that changed. No hits → "not used". Hits → note file:line and what needs to change. Be skeptical of changelog wording; verify against the installed package in `node_modules/<pkg>/` before editing.

6. **Apply needed updates** and re-run `pnpm typecheck`, `pnpm lint`, `pnpm test`. If CLI behavior could be affected, exercise it end-to-end per `CLAUDE.md` (`pnpm example:dev`, then `pnpm dev <command>`). Don't claim it works without seeing it.

7. **Update `CHANGELOG.md`** under `## Unreleased` only if the upgrade required user-visible changes (e.g. the `payload` peer range changed, a CLI flag changed to track upstream). A pure version bump is `chore` and gets no entry.

8. **Report back, in this shape:**

   ```
   Upgrade summary

   Script: SUCCESS / FAILED (<step>)
   Non-patch bumps reviewed: <count>

   <dep>  <OLD> → <NEW>
     Breaking: <one-line summary or "none">
     Impact: <"none — symbol not used"  |  file:line — <what changed>>
     Action: <"no change"  |  "edited <files>"  |  "needs follow-up: <what>">

   <repeat per dep>

   Advisories: <"0 remaining" | table of what's left and why>
   Follow-ups: <anything you couldn't verify>
   ```

   Don't commit unless the user (or the scheduled task prompt) asks for it. Commits use conventional format, e.g. `chore(deps): bump dependencies` / `fix(deps): patch <pkg> advisory`.

## Reconcile `pnpm-workspace.yaml` overrides

The script bumps `package.json` and `pnpm-lock.yaml` but never touches `overrides:` in `pnpm-workspace.yaml`. Overrides win during resolution, so a dependency pinned there is silently capped.

1. **Find the mismatch.** For every dependency in both the bump diff and `overrides:`, compare declared vs resolved:

   ```sh
   grep -E "^  \"?<dep>" pnpm-workspace.yaml
   pnpm -r list <dep>
   ```

   A `^`-floor (`pkg: '^1.2.3'`) only sets a minimum. A selector override (`"pkg@1": "^1.4.0"`) only remaps that major line; check it still matches a resolved version.

2. **Keep a single Payload/Next/React.** `next`, `payload` and `@payloadcms/*` are exact-pinned in `example/package.json` and the root devDependencies. They must stay in lock-step (same `payload` version in root and example) or the example admin can crash with duplicate-context errors. Confirm one version each:

   ```sh
   pnpm -r list next payload react | grep -oE '(next|payload|react)@[0-9.]+' | sort -u
   ```

3. **Audit `^` security floors for redundancy.** Strip the floor lines, reinstall, and compare each package's lowest resolved version to its floor:
   - natural resolution **≥ floor** → redundant, drop the override.
   - natural resolution **< floor** → still load-bearing, keep it.

   Restore the tree with `git stash` (not `git checkout -- .`) once measured.

## Audit for vulnerabilities and fix them

1. **Run the audit.** The helper prints one table (one row per advisory, with the number of dependency paths affected):

   ```sh
   ./.claude/skills/bump-dependencies/audit-dependencies.sh           # any advisory → exit 1
   ./.claude/skills/bump-dependencies/audit-dependencies.sh high      # only high+ fails
   ```

   `pnpm audit` reads the same GitHub Advisory Database that drives Dependabot alerts, so a clean run here means no open GitHub advisories against the lockfile.

2. **Prefer the root-cause fix — update the owning dependency before reaching for an override.** Run `pnpm why <pkg>` (add `-r` to include the example) to find which direct dependency pulls the vulnerable version. If a newer release of that owner requires the patched range, bump it — that clears the advisory and leaves no override behind. Reach for an override only after confirming the owner can't move (already latest, or its range still spans the vulnerable version).

3. **Otherwise, add an override floor**: `pkg: '^<patched>'` in `pnpm-workspace.yaml` `overrides:`. Use a selector (`"pkg@4": "^4.3.9"`) when only one major line is affected and other majors are pulled legitimately. Watch for a floor that _caps below_ the patched version: in `0.x`, `pkg: '^0.27.0'` excludes a `0.28.1` fix.

4. **When the override won't move a locked transitive, pin it as a direct devDependency.** pnpm won't re-resolve an already-locked transitive to satisfy a changed override (`install`, `install --force`, `dedupe`, `update <pkg>` all leave it). Add the package as a root `devDependency` at the patched range; a direct dependency always resolves to its declared range, and the transitive consumer dedupes onto it.

5. **Reinstall, re-audit to zero, then verify the toolchain.** Re-run the audit _and_ `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. Forced build-tool versions (`esbuild`, `vite`) are where things break. Don't claim the advisories are cleared until the audit is empty and the checks are green.

## Heuristics for what to read carefully vs skim

- **Payload core (`payload`, `@payloadcms/*`)** — read every minor's release notes; the schema plugin, MCP tools and Lexical toolkit depend on field-config, Local/REST API and Lexical node shapes.
- **`@payloadcms/richtext-lexical`** — Lexical node/serialization changes directly affect `src/lexical/`. Read carefully.
- **`commander`** — major bumps change CLI parsing/help output; check CLI output end-to-end.
- **`zod`** — minor bumps within v4 are usually safe. Skim.
- **`next`, `react`, `react-dom`** — only used by the example app. Skim.
- **`oxlint`, `oxfmt`, `husky`, `lint-staged`, `@commitlint/*`, `@types/*`, `tsx`** — tooling. Skim; if `oxfmt` changes formatting, run `pnpm format` and commit separately.
- **`vitest`** — only matters if tests fail.

## When to stop and ask

- Script returns `FAILED` → report and stop, don't try to fix it inline.
- A breaking change requires an architectural decision (e.g. Payload removes an API the plugin depends on) → write up options and ask.
- The `payload` peer range needs to change → confirm with the user; it changes the public install matrix.
- A security floor's removal can't be proven redundant, or an advisory has no patched version (`fix: NO`) → report it instead of guessing.
