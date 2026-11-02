---
name: bump-dependencies
description: Bump the workspace dependencies (root package + example app) with the bundled script, review breaking changes in what matters, and clear security advisories. Use when the user says "bump dependencies", "upgrade dependencies", "update dependencies", "audit dependencies", "check for vulnerabilities", or "check for GitHub advisories".
---

# Bump dependencies, review breaking changes, clear advisories

If the user only asks to audit, do steps 1, 4 and 7.

## 1. Check the tree

`git status --porcelain` must be empty, so the diff shows only the bump. If it isn't, tell the user and stop.

## 2. Bump

```sh
./.claude/skills/bump-dependencies/bump-dependencies.sh           # bump, then check
./.claude/skills/bump-dependencies/bump-dependencies.sh --check   # check only
```

The script bumps everything to latest, then runs CI's checks against a dedicated local database, starting and stopping the example app itself. It needs MongoDB on `localhost:27017` and port 3939 free.

Going to latest can overshoot, so unmet peers or differing root and example pins are expected. They stop the script: pin what the peer needs (`pnpm peers check` shows it, and a lockfile may need a root `devDependency` to move), then rerun with `--check`.

Payload, `next` and React must be one version each across root and example, or the example admin can crash with duplicate-context errors. `payload` and `@payloadcms/*` are exact pins.

Any other failure may be a real break: continue with step 5 to find out.

## 3. Reconcile overrides

The script never touches `overrides:` in `pnpm-workspace.yaml`, and overrides win during resolution. For each bumped dependency listed there, check that the override doesn't hold it back, and raise or remove it if it does.

Don't remove a security floor just to tidy up. The lockfile keeps resolved versions, so removing a floor and reinstalling doesn't show whether it's still needed.

## 4. Clear advisories

```sh
./.claude/skills/bump-dependencies/audit-dependencies.sh
```

For each advisory, in this order:

1. **Update the owner.** `pnpm why <pkg> -r` shows who pulls it in. Bump the owner if a newer release requires the patched range.
2. **Add an override floor:** `pkg: '^<patched>'`. Use a selector (`"pkg@4": "^4.3.9"`) when other major lines are legitimate. In `0.x`, `^0.27.0` excludes a `0.28.1` fix.
3. **Add a root `devDependency`** at the patched range if the lockfile won't move the transitive version. pnpm doesn't re-resolve a locked transitive to satisfy a changed override.

The goal is no advisories, or an explanation for each one left. Check that a patched version is actually published (`npm view <pkg> versions`) before chasing it.

`pnpm audit` and Dependabot count differently, so a clean audit doesn't prove there are no open GitHub alerts.

## 5. Review the bumps

List the changes with `git diff -- package.json example/package.json`. A change to the `0.<minor>` segment counts as breaking.

- **Root `dependencies` and Payload (`payload`, `@payloadcms/*`):** read the release notes of every version from OLD to NEW for removals, renames, and peer or Node changes. The plugin, MCP tools and Lexical toolkit depend on Payload's field config, API and Lexical node shapes. Search `src/` and `example/src/` for anything affected, and verify against `node_modules/<pkg>/` rather than trusting the wording.
- **Everything else:** read the notes only if a check fails.

Fix what broke, then rerun with `--check`. If CLI behaviour could change, exercise it per `CLAUDE.md`.

## 6. Changelog

Add a line under `## Unreleased` in `CHANGELOG.md` only if installers are affected: a security fix in the `ships` column of the audit, or a change to the `payload` peer range or CLI behaviour. A plain version bump gets no entry.

## 7. Report

```
Upgrade summary

Checks: SUCCESS / FAILED (<step>)
Pins held back: <dep, why>

<dep>  <OLD> → <NEW>
  Breaking: <one line, or "none", or "notes not read">
  Impact: <"none" | file:line and what changed>

Advisories: <before> → <after>, <n> reach installers
Left open: <each advisory and why>
Follow-ups: <anything you couldn't verify>
```

Don't commit unless asked. Use `chore(deps): bump dependencies` or `fix(deps): patch <pkg> advisory`.

## When to stop and ask

- A failure you can't trace to a bump.
- A breaking change that needs an architectural decision, such as Payload removing an API the plugin depends on.
- The `payload` peer range needs to change, since that changes the public install matrix.
