---
name: hypercli
description: >
  Operate HyperCLI product APIs and managed agents with the hyper CLI. Use for
  credential diagnostics, inference, media flows, uploads, voice, GPU jobs,
  workspaces, web search, agent lifecycle, logs, exec, shell, and gateway RPCs.
---

# HyperCLI

Use the bundled `hyper` command. Run `hyper --help` and
`hyper <group> --help` before guessing flags. Detailed references live under
`/opt/hypercli/docs/cli/` in managed images.

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

## Media Flows

Create one render and retain its ID. `pending` and `running` mean the submission
succeeded; poll that ID instead of submitting duplicates.

```bash
hyper flow text-to-image "<prompt>" --output json
hyper flow status <render-id> --output json
hyper flow status <render-id> --watch
hyper flow get <render-id> --output <path>
```

Local media paths upload automatically under the product identity:

```bash
hyper flow image-to-image "<prompt>" --image ./input.png --output json
hyper flow image-to-video "<prompt>" --image ./input.png --output json
```

Do not substitute private or session-bound URLs for a readable local path.
`--x402` does not bypass product authentication for local uploads. Report a
terminal `failed` error and a completed result URL/download path. Read
[flow.mdx](/opt/hypercli/docs/cli/commands/flow.mdx) for per-flow inputs and the
important difference between `get --output` and `get --format`.

## Remote Agents

Start with table output:

```bash
hyper agents list
hyper agents status <agent>
hyper agents metrics <agent>
hyper agents logs <agent> --no-follow -n 100
```

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
- `billing`, `comfyui`, `files`, `flow`, `keys`, `jobs`, `llm`, `memory`,
  `user`, `voice`, `wallet`, `workspaces`: matching
  `/opt/hypercli/docs/cli/commands/<group>.mdx`

If `/opt/hypercli` is unavailable, rely on command help rather than inventing a
contract.
