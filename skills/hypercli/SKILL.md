---
name: hypercli
description: >
  Operate HyperCLI product APIs, GPU jobs, media flows, voice, and managed
  agents with the `hyper` CLI. Use as the router for identity, credentials,
  agents, compute, flows, files, and voice operations.
---

# HyperCLI

Use the bundled `hyper` command. Run `hyper --help` and
`hyper <group> --help` before guessing flags. Detailed references live under
`/opt/hypercli/docs/cli/` in managed images.

For credential resolution or coding-harness login, load the `hypercli-auth`
skill. For identity and entitlements load `hypercli-account`. For media
generation load `hypercli-flows`. For files, workspaces, or memory import
load `hypercli-knowledge`. For GPU jobs load `hypercli-compute`. For
managed runtimes load `hypercli-agents`. For voice synthesis and
transcription load `hypercli-voice`.

## Root surface

The v1 command tree is deliberately small:

- `hyper me`: identity, capabilities, and entitlements for the active key.
- `hyper configure`: write the local product API key to
  `~/.hypercli/config`.
- `hyper skills`: inventory and print the skills bundled with this CLI.
- Groups: `hyper agents`, `hyper routines`, `hyper jobs`, `hyper flow`,
  `hyper files`, `hyper voice`, `hyper websearch`, `hyper llm chat`,
  `hyper llm image`.

Every command accepts `--json`, and create-style submissions accept
`--dry-run` for preflight validation. API-base selection —
`HYPER_API_BASE`, `HYPER_AGENTS_API_BASE` — is owned by the `hypercli-auth`
skill; change a base only when the user intends it.

## Authentication

Credential resolution — `HYPER_API_KEY` and `HYPER_AGENTS_API_KEY`, plus
keys saved by `hyper configure` — is owned by the `hypercli-auth` skill;
load it before changing any credential source.

Never print, paste, or send a credential. Before a costly or mutating
operation, validate the intended identity:

```bash
hyper me --json
```

If this returns `401` or says the key is inactive, stop. Do not retry or
select another saved key. Report the API base, credential source name, and
server detail, then follow the `hypercli-auth` skill. See
[configuration.mdx](/opt/hypercli/docs/cli/configuration.mdx#diagnosing-401-errors).

## Remote Agents

`hyper agents` is owned by the `hypercli-agents` skill. Load it for
observation, lifecycle, logs, container access, routines, and runtime
configuration; its secret-output and approval rules apply there. Read
[agents.mdx](/opt/hypercli/docs/cli/commands/agents.mdx).

## Reference Map

- `configure`, `me`, `skills`: `/opt/hypercli/docs/cli/configuration.mdx`
- `agents`: `/opt/hypercli/docs/cli/commands/agents.mdx`
- `jobs`: `/opt/hypercli/docs/cli/commands/jobs.mdx`
- `flow`: `/opt/hypercli/docs/cli/commands/flow.mdx`
- `files`: `/opt/hypercli/docs/cli/commands/files.mdx`
- `voice`: `/opt/hypercli/docs/cli/commands/voice.mdx`

If `/opt/hypercli` is unavailable, rely on command help rather than
inventing a contract.
