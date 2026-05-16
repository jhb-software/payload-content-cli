# Architecture

## Documentation files

Each documentation file has a single responsibility. Avoid duplicating information across files.

| File                               | Audience                | Purpose                                                                                                                                                                                                       |
| ---------------------------------- | ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `README.md`                        | Humans                  | What this project is, why it exists, what problems it solves, how it compares to alternatives (e.g. MCP). No setup instructions or command reference.                                                         |
| `USAGE.md`                         | Humans + agents         | Exhaustive command reference with examples. Setup instructions, all commands with flags and examples, directory structure, example project setup. The single source of truth for "how do I use this command?" |
| `ROADMAP.md`                       | Contributors            | High-level ideas and open questions. What's done, what's next.                                                                                                                                                |
| `CLAUDE.md`                        | AI agents (development) | Project conventions for agents working on the codebase itself.                                                                                                                                                |
| Agent skill (installed by `skill`) | AI agents (usage)       | Best practices and tips for agents using the CLI to manage content. Discovery-oriented — tells agents to use `--help` and read schemas rather than duplicating the command reference.                         |

### Principles

- **README** explains _what_ and _why_. It should read like a pitch — someone should understand the value proposition without seeing a single command.
- **USAGE** explains _how_. Every command, every flag, with copy-pasteable examples. This is the reference.
- **Agent skill** explains _when_ and _best practices_. It doesn't repeat the API — it teaches judgement (when to use CRUD vs sync, how to approach richtext edits, what to check first).
- Information should live in exactly one place. If USAGE.md documents a flag, README.md doesn't repeat it.
