---
name: hypercli-agents
description: >
  Create, run, inspect, and control managed HyperCLI agents across the
  openclaw, hermes, goose, opencode, and buzz runtimes. Use for hyper
  agents lifecycle and wait, logs, exec, shell, file copies, routines,
  grant activation with hyper agents activate, dynamic routes, archive and
  restore, and OpenClaw-only configuration through the hidden hyper agents
  config and hyper agents models commands.
---

# HyperCLI Agents

Load the `hypercli` and `hypercli-auth` skills before remote work. The
managed image command reference is
`/opt/hypercli/docs/cli/commands/agents.mdx`. Run `hyper agents --help` and
`hyper agents <command> --help` against the installed CLI when exact
options matter; hidden power commands appear only in the reference docs.

## Complete command map

| Area | Commands |
| --- | --- |
| Discovery | `ls`, `status` |
| Lifecycle | `create`, `wait`, `start`, `stop`, `delete` |
| Container access | `logs`, `exec`, `shell`, `cp` |
| Routines | `routines list`, `routines create`, `routines delete` |
| Grants | `activate` |
| Hidden power | `token`, `routes`, `config get/set` (OpenClaw only), `models` (OpenClaw only), `archive`, `restore`, `routines update` |

Do not select `--dev` or another environment unless the user explicitly
intends it.

## Inspect before changing

Resolve a user-supplied name with bounded reads:

```bash
hyper agents ls
hyper agents status <agent>
hyper agents logs <agent>
```

Table output is the safe default. `ls --json` can include launch
environment values; keep it private and never paste it wholesale. Logs and
config output can contain credentials or private user content, so query
narrowly and redact values when reporting.

## Create and lifecycle

Runtimes are `openclaw`, `hermes`, `goose`, `opencode`, and `buzz`. Confirm
the name, runtime, and target environment first, and dry-run the create:

```bash
hyper agents create docs-agent --runtime openclaw --dry-run
hyper agents create docs-agent --runtime openclaw
hyper agents wait <agent> --state running
```

Do not put secrets directly in command history; environment values passed
at create time are sensitive even in a dry run.

Lifecycle commands are mutations — obtain approval and re-resolve the exact
target immediately before acting:

```bash
hyper agents start <agent>
hyper agents stop <agent>
hyper agents delete <agent>
```

`stop` preserves the record and synced state; `delete` removes the runtime
and record. A successful acknowledgement can be transitional:
`hyper agents wait <agent>` (optionally with `--state`) confirms the target
state before dependent steps.

## Container access

Use the least powerful operation that answers the question:

```bash
hyper agents logs <agent> -f
hyper agents exec <agent> -- uname -a
hyper agents cp <agent>:/workspace/result.txt ./result.txt
hyper agents shell <agent>
```

- `logs` prints recent output; `-f` follows. Log content can include
  application secrets.
- `exec` runs one remote command after `--` and is non-interactive. Avoid
  environment or config dumps, and preserve the remote exit status and
  stderr.
- `cp` moves files in either direction with the `<agent>:<path>` syntax.
  Confirm overwrites and obtain approval before writing remotely.
- `shell` is an interactive session with broad authority, intended for
  human operator work such as harness sign-in; keep transcripts private.

`hyper agents token <agent>` (hidden) mints a fresh scoped key and prints
it once: plain stdout carries only the key, `--json` carries the full
record. Nothing is stored on disk, so treat stdout as secret-bearing, save
the key immediately, and never paste it into logs or replies.

## Routines

Routines are the scheduled and recurring task surface for an agent:

```bash
hyper agents routines list --agent <agent>
hyper agents routines create --cron "0 9 * * *" --prompt "Summarize overnight progress" --agent <agent>
hyper agents routines create --run-at 2026-10-01T09:00:00Z --prompt "One-shot reminder"
hyper agents routines delete <routine-id>
```

`routines create` takes no positionals: exactly one of `--cron EXPR` or
`--run-at ISO`, plus `--prompt TEXT`, with optional `--agent ID`,
`--name N`, and `--disabled`. `routines delete` takes the routine id (not
the agent id). Check `hyper agents routines create --help` for the exact
payload shape before submitting, and treat routine mutations as
approval-gated remote changes. `hyper agents routines update` (hidden)
edits an existing routine in place.

## Activate a grant code

```bash
hyper agents activate <code>
```

`activate` redeems a grant code for the current account and updates the
entitlements visible in `hyper me`. Codes are secrets: do not place an
unredeemed code in logs, issues, or responses, and confirm the resolved
identity with `hyper me` before redeeming.

## OpenClaw configuration

New OpenClaw agents come from `hyper agents create <name> --runtime openclaw`;
there is no separate setup helper. For agents on
that runtime, two hidden commands expose the runtime configuration and
model catalog:

```bash
hyper agents config get <agent>
hyper agents models <agent>
```

`hyper agents config set <agent>` applies changes to the live OpenClaw
runtime. Obtain approval first, keep payloads exact (validate JSON locally
when a payload is required), and treat config output as sensitive. These
commands are OpenClaw-only; they do not apply to hermes, goose, opencode,
or buzz agents.

## Routes, archive, and restore

`hyper agents routes list <agent>` (hidden) shows the agent's dynamic HTTPS
routes; `hyper agents routes add <agent> <name> --port N` (optional
`--prefix P`, `--no-auth`) adds one, and `hyper agents routes remove <agent> <name>`
deletes one. Inspect current routes before mutating, and change one named
route at a time.

`hyper agents archive <agent>` and `hyper agents restore <agent>` (hidden)
move an agent out of and back into active use. Both are mutations: resolve
the exact target and get approval first.

## Failure handling

- Resolve ambiguous names through `hyper agents ls`; never choose a match
  by guesswork.
- On `401`/`403`, load the `hypercli-auth` skill; do not rotate tokens or
  keys as an automatic retry.
- Preserve remote exec exit status and stderr. Do not describe partial
  output as command success.
- A stop acknowledgement means cleanup was accepted, not that the slot is
  released; confirm with `wait` when the next step depends on the state.
- Report agent ID/name, requested action, resulting state, and whether a
  wait reached its target state. Never report a token, key, or code value.
