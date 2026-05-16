## Scope

- This project is in beta-phase. Breaking changes are fine. Prioritize an ergonomic API over backwards compatibility.
- Don't add features that aren't needed right now. Keep the scope tight.

## Plans

- Plans are tracked in the `plans/` folder as markdown files with `title`, `type`, and `status` frontmatter.
  - Statuses: `draft`, `todo`, `in-progress`, `done`
  - `draft` — created by an agent, not yet reviewed by the package author. Agents should use this when they notice something worth tracking.
  - `todo` — reviewed and approved by the package author, ready to work on.
  - Only work on `todo` plans, never on `draft` plans.
- ROADMAP.md is for high-level ideas and open questions. Plans folder is for concrete work ready to implement.

## Docs

- When any public-facing API changes (CLI commands, flags, plugin options), update README.md and USAGE.md immediately in the same commit.

## Commits

- Commits and PR titles use conventional commit format.

## Tests

- Test-first for every fix and feature: write a failing test that reproduces the user-visible problem (wrong CLI output, wrong file on disk, wrong DB row), then make it pass.
- A test earns its place only if it (a) asserts user/API-visible behavior, (b) would fail if the implementation were inverted, (c) survives a reasonable refactor, (d) doesn't restate what types or schemas already guarantee.
- No smoke tests, prop-passthrough checks, mock-was-called assertions, or coverage-padding tests.
- Default to integration tests against real Payload. Use unit tests only for pure logic with non-trivial branches. Stub only external boundaries (network, fs, time, randomness, LLMs, third-party SDKs). If you'd need to mock the subject's close collaborators, test at a higher level.
- Name tests by the behavior they protect ("rejects a push when the slug is missing"), not the method called.
- When adjusting CLI code, exercise the change end-to-end via the CLI itself (`pnpm dev <command>` against the example app). The example dev app at `example/` must be running for this — start it with `pnpm example:dev` if it isn't already.

## Changelog

- Every user-visible fix/feat adds one line to the affected plugin's CHANGELOG.md under `## Unreleased` (create the heading if missing). The unit is the change, not the commit — edit the existing line on follow-up commits. chore/refactor/test/docs get no entry.
