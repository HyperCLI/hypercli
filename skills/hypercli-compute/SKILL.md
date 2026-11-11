---
name: hypercli-compute
description: >
  Browse the live GPU catalog and create, inspect, and control GPU compute
  with hyper jobs. Use for hyper jobs gpus inventory, job submission
  preflighted with --dry-run, job list/get/logs, cancellation, and the
  hidden extend and exec power commands. Named hypercli-compute, not
  hypercli-jobs, for its former breadth across hyper jobs and the retired
  hyper instances group. Not for media renders (hypercli-flows) or managed
  agent runtimes (hypercli-agents).
commands:
  - hyper jobs --help
  - hyper jobs gpus
  - hyper jobs create --dry-run
  - hyper jobs list
  - hyper jobs get <job>
  - hyper jobs logs <job>
  - hyper jobs cancel <job> --yes
  - hyper jobs extend <job> --seconds N
  - hyper jobs exec <job> -- nvidia-smi
---

# HyperCLI Compute

Load the `hypercli` and `hypercli-auth` skills first. Use the managed image
reference at `/opt/hypercli/docs/cli/commands/jobs.mdx`, then confirm flags
with `hyper jobs --help`. GPU availability and pricing are live data; never
quote remembered values.

## Complete command map

| Area | Commands |
| --- | --- |
| Catalog | `hyper jobs gpus` |
| Submit | `hyper jobs create` (supports `--dry-run`) |
| Inspect | `hyper jobs list`, `hyper jobs get`, `hyper jobs logs` |
| Control | `hyper jobs cancel` |
| Hidden power | `hyper jobs extend`, `hyper jobs exec` |

The `hyper instances` group and the `hyper launch <image>` shortcut are
retired from the current CLI; compute is `hyper jobs` only. If installed
help still lists them, follow help and report the drift.

## Browse the catalog

```bash
hyper jobs gpus
hyper jobs gpus --json
```

The catalog reports current GPU types, availability, and pricing. Use it
immediately before submitting; do not hard-code stale GPU names or prices.
Use `--json` only when a machine will parse the result.

## Submit once

Compose the create call from current help output — the image, GPU type, and
command are the minimum to confirm with the user:

```bash
hyper jobs create --help
```

Preflight with a dry run, then submit once and record the returned job ID:

```bash
hyper jobs create --dry-run
hyper jobs create
```

A dry run validates without billing; re-check the live catalog entry, GPU
type, runtime, and cost before the real call. Never resubmit after an
ambiguous timeout or transport failure: check `hyper jobs list` under the
same auth context first, because one create can start billable compute.
Confirm the paying identity with `hyper me` before the real call; credential
rules are owned by `hypercli-auth`.

## Inspect jobs

```bash
hyper jobs list
hyper jobs list --json
hyper jobs get <job>
```

Pass the full job ID (a UUID); if you only have a prefix, confirm the match
against `hyper jobs list` instead of guessing. `running` is transitional —
compute still bills; `succeeded`, `failed`, `terminated`, and `canceled`
are terminal. Job detail can include the image, command, networking, and
environment inputs; keep it private when the submission contained
sensitive values.

## Logs

```bash
hyper jobs logs <job>
hyper jobs logs <job> -f
```

`-f` follows output until interrupted with Ctrl+C (exit status 130); it
does not exit when the job does, so confirm the final state with
`hyper jobs get <job>`. Log content may contain application secrets or
user data; query narrowly and redact when reporting.

## Control

```bash
hyper jobs cancel <job> --yes
```

`cancel` is immediate; obtain approval and confirm the target and current
state with `hyper jobs get <job>` first. The CLI refuses to cancel
non-interactively without `--yes`; pass it only to record that approval. A
job in a transitional state can
still accrue cost until cancellation is accepted. Fetch the job again if
the user needs confirmation of terminal state.

Hidden power commands:

```bash
hyper jobs extend <job> --seconds 7200
hyper jobs exec <job> -- nvidia-smi
```

`extend` changes the job's runtime budget and can change cost — confirm the
new value and the exact job with the user first. `exec` runs a one-shot
remote command after `--`; preserve its exit status and stderr, obtain
approval before execution, and apply the same secrecy rules as agent exec
(see the `hypercli-agents` skill).

## Operational rules

- One create can start billable compute. Never submit duplicates while
  polling or after an ambiguous timeout.
- Use `--dry-run` to validate, then re-check live GPU type, availability,
  runtime, and cost before the real call.
- Cancel only the intended job, and only with approval.
- Report job ID, state, GPU type, and whether an operation was a dry run or
  real. Redact environment values, credentials, and authenticated URLs.

## Failure handling

- **Auth rejection** (`401`): stop; do not retry or swap credentials — load
  the `hypercli-auth` skill and follow it.
- **Transport ambiguity** after `create`: do not resubmit. Check
  `hyper jobs list` under the same auth context first; one duplicate create
  can bill twice.
- **State confusion**: a running job is a successful submission, not a
  reason to create another; confirm terminal state (`succeeded`, `failed`,
  `terminated`, `canceled`) with `hyper jobs get`, and treat an accepted
  cancel as acknowledgement, not completion.
- **Version drift**: when `hyper jobs --help` contradicts this skill, help
  wins; act on help and report the drift.
