---
name: hypercli
description: >
  Operate HyperCLI product APIs and managed agents with the hyper CLI. Use as
  the router for credentials, account, compute, flows, knowledge, voice, and
  agent operations, or directly for local-image analysis and text embeddings.
---

# HyperCLI

Use the bundled `hyper` command. Run `hyper --help` and
`hyper <group> --help` before guessing flags. Detailed references live under
`/opt/hypercli/docs/cli/` in managed images.

For credential resolution or coding-harness login, load the `hypercli-auth`
skill. For media generation load `hypercli-flows`. For speech generation,
cloning, or transcription load `hypercli-voice`.

The current harness should handle ordinary reasoning and text generation.
Three specialized inference utilities remain useful when the user asks for
them:

```bash
hyper llm image ./input.png
hyper agent embed text "text to embed"
hyper agent embed test
```

`hyper llm image` defaults to a concise description; use `--prompt/-p` only
when the user asks a specific question about the image. Use `hyper agent embed`
for embedding work. Use the `hypercli-flows` skill for managed media generation
so jobs are bounded and tracked.

## Authentication

`HYPER_API_KEY` authenticates product APIs. `HYPER_AGENTS_API_KEY` can override
it for agent APIs. Environment values can override saved credentials; read
[configuration.mdx](/opt/hypercli/docs/cli/configuration.mdx) before changing a
key or base URL.

Never print, paste, or send a credential. Before a costly or mutating operation,
validate the intended identity and API base:

```bash
hyper me --output json
```

If this returns `401` or says the key is inactive, stop. Do not retry, select
another saved key, expose the key, or switch to `--x402` unless the user asks.
Report the API base, credential source name, and server detail. See
[configuration.mdx](/opt/hypercli/docs/cli/configuration.mdx#diagnosing-401-errors).

## Remote Agents

Start with table output:

```bash
hyper agents list
hyper agents status <agent>
hyper agents metrics <agent>
hyper agents logs <agent> --no-follow -n 100
```

For dynamic HTTPS routes or runtime-bound lifecycle operations, load the
`hypercli-agents` skill. Its commands use `self` as the reserved current-agent
target, for example `hyper agents routes list self`.

Do not paste `agents list --json`: it includes `launch_config`, which can contain
environment secrets. Treat config, session, file, log, exec, shell, token,
external-key, and cron output as sensitive. Get approval before `exec`, `shell`,
`cp` to a remote destination, `config-patch`, `cron-*`, lifecycle changes, or
key rotation. Read [agents.mdx](/opt/hypercli/docs/cli/commands/agents.mdx).

## Reference Map

- `configure`, `me`, `status`, `config`: `/opt/hypercli/docs/cli/configuration.mdx`
- `launch`, `instances`: `/opt/hypercli/docs/cli/commands/instances.mdx`
- `agent`: `/opt/hypercli/docs/cli/commands/agent.mdx`
- `agents`: `/opt/hypercli/docs/cli/commands/agents.mdx`
- `hyper llm image`: `/opt/hypercli/docs/cli/commands/llm.mdx`
- `hyper agent embed text/test`: `/opt/hypercli/docs/cli/commands/agent.mdx`
- `billing`, `files`, `flow`, `keys`, `jobs`, `memory`, `user`, `voice`,
  `wallet`, `workspaces`: matching
  `/opt/hypercli/docs/cli/commands/<group>.mdx`

If `/opt/hypercli` is unavailable, rely on command help rather than inventing a
contract.
