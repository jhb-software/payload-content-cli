---
title: Profile credential helper (shell-out for keychain-backed secrets)
type: feature
status: draft
---

# Profile credential helper (shell-out for keychain-backed secrets)

Let users avoid storing API keys plaintext in `~/.payload-content/profiles.json` by referencing a shell command that prints the key to stdout on demand. Modeled on AWS CLI's `credential_process` and Claude Code's `apiKeyHelper`.

## Why

Profiles currently store `apiKey` as a plaintext field. The file is locked down with `chmod 0600`, which matches AWS / gcloud / `gh` defaults — but anything running as the user (npm postinstall scripts, malicious deps, exfiltration via shell history) can still read it. Power users on macOS / Linux often want the key to live in their OS keychain or password manager (`security`, `pass`, `op`, `bw`, Vault, etc.) and only be materialized in memory when needed.

Reasons not to ship native keychain integration directly:

- `keytar` is deprecated; native modules cause install/CI pain.
- Headless / WSL / Docker / CI environments have no Secret Service running, so a file fallback is needed anyway.
- A shell-out covers every keychain a user might want without us owning the integration.

## Proposed shape

Add an optional `credentialCommand` field to the profile schema:

```json
{
  "prod": {
    "payloadUrl": "https://example.com",
    "credentialCommand": "op read 'op://Private/payload-prod/api-key'"
  }
}
```

Resolution rules:

- If `credentialCommand` is set on a profile, run it and use stdout (trimmed) as the API key.
- Mutually exclusive with `apiKey` — error if both are set.
- Existing precedence stands: explicit overrides > `PAYLOAD_API_KEY` env > profile (`apiKey` or `credentialCommand`).
- Cache the resolved key in-memory for the lifetime of one CLI invocation; do not persist.

CLI:

- `profile add <name> --credential-command "<cmd>"` — set the helper.
- `profile show <name>` — print `"credentialCommand": "..."` literally; never invoke it for `show`.
- Document a security note: the command runs with the user's full shell environment.

## Open questions

- Timeout for the helper command? (5s default seems sane.)
- Should we surface a non-zero exit clearly, or just bubble the stderr?
- Do we want the AWS-style JSON-output variant (`{ "apiKey": "...", "expiresAt": "..." }`) for short-lived tokens, or keep it strictly stdin = key?
- Windows: spawn via `cmd.exe /c` or require a full path? Match what `npm` config does.

## Out of scope

- Bundling `keytar` or any native keychain module.
- Encrypting the profiles.json file at rest.
