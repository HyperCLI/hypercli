---
name: hypercli-agents
description: >
  Manage HyperCLI agents, dynamic HTTPS routes, and runtime-bound self
  lifecycle. Use for create/start/stop, route reconciliation, logs, metrics,
  exec, shell, gateway operations, Slack, relay keys, and troubleshooting.
---

# HyperCLI Agents

Load the `hypercli` and `hypercli-auth` skills before remote work. The managed
image command reference is `/opt/hypercli/docs/cli/commands/agents.mdx`. Run
`hyper agents --help` and `hyper agents <command> --help` against the installed
CLI when exact options matter.

Use `hyper agents ...` for runtime management. The older `hyper agent start`,
`stop`, `exec`, and `shell` commands remain compatibility entry points; emit
the plural canonical form in new instructions. Load the `hypercli-account`
skill for account/subscription commands under `hyper agent`, the
core `hypercli` skill for the limited image-analysis and embedding utilities,
and the `hypercli-voice` skill for voice commands.

## Complete command map

| Area | Commands |
| --- | --- |
| Discovery | `budget`, `list`, `ls`, `status`, `metrics`, `web-search` |
| Lifecycle | `create`, `wait`, `start`, `stop`, `delete` |
| Routes | `routes list`, `routes add`, `routes remove` |
| External runtimes | `external-create`, `external-rotate-key` |
| Container access | `exec`, `cp`, `shell`, `logs`, `token` |
| Gateway reads | `config`, `models`, `files`, `sessions`, `cron` |
| Gateway mutations | `config-patch`, `cron-add`, `cron-remove`, `cron-run` |
| Conversation | `gateway-chat`, compatibility `chat` |
| Integration | `hyper agent enable` |

`list` and `ls` are aliases. Group options precede the subcommand:

```bash
hyper agents --dev list
hyper agents --agents-ws-url wss://example.invalid/ws logs <agent> --ws
```

Do not select `--dev`, a custom WebSocket URL, or another API base unless the
user explicitly intends that environment.

## Inspect before changing

Resolve a user-supplied name or prefix with bounded reads:

```bash
hyper agents list
hyper agents status <agent>
hyper agents metrics <agent>
hyper agents logs <agent> --no-follow -n 100
hyper agents budget
```

Table output is the safe default. `list --json` includes complete
`launch_config`, including the environment map; keep it private and never paste
it wholesale. Metrics expose live Kubernetes CPU/memory quantities. Logs,
gateway config, sessions, and files can contain credentials or private user
content, so query narrowly and redact values when reporting.

`web-search` sends the query through the HyperCLI Brave proxy:

```bash
hyper agents web-search "current package release notes" --count 5
hyper agents web-search "site:docs.example.com websocket" --json
```

Treat search terms as remote disclosure. `--json` is useful for parsing, not
for dumping an unreviewed response into chat.

## Create and lifecycle

Create only after confirming name, size, image/flavor, ports, and indexing
policy:

```bash
hyper agents create --name docs-agent --size medium --dry-run
hyper agents create --name docs-agent --size medium --wait
hyper agents wait <agent> --timeout 300 --poll-interval 5
```

Important `create` controls include `--no-start`, `--wait/--no-wait`,
`--desktop/--no-desktop`, repeatable `--env` and `--port`, `--command`,
`--entrypoint`, `--image`, registry credentials, sync UID/GID, gateway token,
and `--dry-run`. Do not put secrets directly in command history. Registry
passwords, gateway tokens, and environment values are sensitive even when a
dry run is used.

Desktop mode uses the pro image, enables `OPENCLAW_DESKTOP_ENABLED`, and adds a
`desktop-<host>` route. The root host is the OpenClaw gateway. There is no
default `shell-<host>` route; `hyper agents shell` uses the backend WebSocket.

Memory search is enabled by default, while automatic indexing is opt-in:

```bash
hyper agents create --name research \
  --index-on-session-start --index-on-search --index-watch \
  --index-watch-debounce-ms 30000 --index-interval-minutes 120 --wait
```

Use the corresponding `--no-*` switches to disable behavior. An interval of
`0` disables periodic indexing.

Lifecycle commands:

```bash
hyper agents start <agent>
hyper agents stop <agent> --wait --timeout 900
hyper agents delete <agent> --force
```

`start` can override the saved launch settings with the same runtime, desktop,
indexing, image, registry, sync, and gateway options and supports `--dry-run`.
Without `stop --wait`, "Agent stopping" means cleanup was accepted, not that
the deployment slot is released. `stop` preserves the record and synced state;
`delete` removes the runtime and record. Get explicit approval before start,
stop, force, or delete, and re-resolve the target immediately before acting.

The `hyper agent start/stop` aliases additionally accept names/prefixes and can
print JSON. Prefer `hyper agents` unless maintaining an existing script.

## Dynamic routes

Inspect before mutating, then change only one named route unless the user
explicitly asks to replace the full declarative map:

```bash
hyper agents routes list <agent> --output table
hyper agents routes add <agent> web --port 3000
hyper agents routes add <agent> public -p 8080 --no-auth --prefix app
hyper agents routes add <agent> root -p 3000 --root
hyper agents routes remove <agent> web
```

Authentication defaults on. `--prefix` and `--root` are mutually exclusive.
There can be at most ten routes. Check `hyper agents routes list` after a
mutation when you need the resolved URL or current infrastructure status.

Inside a managed runtime, literal `self` is reserved for status, start, stop,
and route operations. Its authorization comes from the active runtime-key
binding while the generic runtime scope stays `agents:none`. It is not valid
for delete or key rotation. `start self` is lifecycle-only: it sends no launch
overrides and reuses the backend-stored configuration. A process can request
`hyper agents stop self --force`, but it cannot restart itself after its own
pod is gone.

## External runtimes and relay keys

```bash
hyper agents external-create customer-runtime --runtime openclaw
hyper agents external-rotate-key <agent>
```

Both operations mutate registration state and can return a relay key shown
once. `--json` also contains that secret. Obtain approval first, capture the
key only into the intended secret store, and never repeat it in a response or
log. Rotation invalidates the prior relay credential.

## Container access

Use the least powerful operation that answers the question:

```bash
hyper agents logs <agent> --no-follow -n 200
hyper agents exec <agent> "uname -a" --timeout 30
hyper agents cp <agent>:/workspace/result.txt ./result.txt
hyper agents shell <agent>
```

- `logs` defaults to 100 lines and following; use `--no-follow` for bounded
  inspection. `--ws` chooses the backend WebSocket instead of executor mode.
- `exec` returns remote output and is non-interactive. Avoid `env`, `printenv`,
  recursive home reads, or secret/config dumps.
- `cp` supports local-to-agent and agent-to-local `agent:path` syntax. Confirm
  overwrites and obtain approval before writing remotely.
- `shell` is an interactive backend PTY with broad authority. Use it only when
  one-shot exec is insufficient and keep all captured output private.
- `token <agent>` refreshes backend access and stores it in
  `~/.hypercli/agents.json`; it prints expiry, not the token. The state file is
  secret-bearing.

The `hyper agent exec/shell` forms are compatibility forwards for
`hypercli-openclaw` deployments.

## Gateway operations

Gateway commands target the OpenClaw gateway on the root agent host:

```bash
hyper agents config <agent>
hyper agents config <agent> --schema
hyper agents models <agent>
hyper agents sessions <agent> --limit 20
hyper agents files <agent>
hyper agents cron <agent>
```

`files` can read or write gateway workspace files:

```bash
hyper agents files <agent> --get SOUL.md
hyper agents files <agent> --set 'SOUL.md=# Runtime instructions'
```

The value passed to `--set` is `path=content`; it mutates remote state and can
leak content through shell history. Prefer a safer approved transport for
secrets and large files.

Mutations require approval and exact JSON:

```bash
hyper agents config-patch <agent> '{"agents":{"defaults":{"model":"provider/model"}}}'
hyper agents cron-add <agent> '{"name":"hourly","schedule":"0 * * * *","command":"run-task"}'
hyper agents cron-run <agent> <job-id>
hyper agents cron-remove <agent> <job-id>
```

`config-patch` applies a merge patch and restarts the gateway. Validate JSON
locally first and do not embed literal keys. A manual cron run may cause
external side effects; do not assume it is a read-only test.

## Chat and Slack

Use gateway chat for the current OpenClaw path:

```bash
hyper agents gateway-chat <agent> "Reply with exactly: ready" --session-key main
```

This streams the response and can trigger whatever tools the remote agent is
allowed to use. State constraints explicitly and obtain approval if the prompt
could induce mutations. `hyper agents chat <agent> --model hypercli/kimi-k2.5`
is older compatibility chat and opens an interactive loop; do not prefer it.

Attach the hosted Slack relay with:

```bash
hyper agent enable <agent> --restart --wait --timeout 900
```

Without `--restart`, persisted configuration may not be read until a later
restart. This changes remote integration state; confirm the target and whether
restart downtime is acceptable.

## Failure handling

- Resolve ambiguous agent prefixes through `list`; never choose a match by
  guesswork.
- A successful create/start/stop response may be transitional. Use `wait` or a
  bounded status poll when the next step depends on `RUNNING` or `STOPPED`.
- On `401`/`403`, load the `hypercli-auth` skill; do not rotate tokens or keys
  as an automatic retry.
- Preserve remote exec exit status and stderr. Do not describe partial output
  as command success.
- On gateway errors, distinguish backend deployment reachability from gateway
  pairing/config failures before restarting anything.
- Report agent ID/name, requested action, resulting state, and whether waiting
  reached a terminal state. Never report a one-time key or credential value.
