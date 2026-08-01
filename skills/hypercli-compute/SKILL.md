---
name: hypercli-compute
description: >
  Browse GPU inventory, validate and launch HyperCLI instances, and inspect or
  control jobs. Use for hyper instances, root hyper launch, job status/logs,
  GPU metrics, runtime extension, cancellation, remote exec/shell, ports,
  load balancers, Dockerfiles, registry auth, and x402 GPU launches.
---

# HyperCLI Compute

Load the `hypercli` and `hypercli-auth` skills first. Use the managed image
references at `/opt/hypercli/docs/cli/commands/instances.mdx` and
`/opt/hypercli/docs/cli/commands/jobs.mdx`, then confirm flags with installed
command help. GPU availability and pricing are live data; never quote
remembered values.

## Complete command map

| Group | Commands |
| --- | --- |
| `hyper instances` | `list`, `gpus`, `regions`, `capacity`, `launch` |
| `hyper jobs` | `list`, `get`, `logs`, `metrics`, `cancel`, `extend`, `exec`, `shell` |
| Root compatibility | `hyper launch` is the same callable as `hyper instances launch` |

Prefer the grouped `hyper instances launch` form in new automation.

## Browse before launching

```bash
hyper instances list --output table
hyper instances gpus --region fi --output table
hyper instances regions --output table
hyper instances capacity --gpu h100 --output json
```

`list` supports GPU and region filters. `gpus` supports a region filter.
`capacity` shows point-in-time idle and launching counts; it does not reserve
hardware or guarantee the next launch. Use JSON only when a machine will parse
it.

## Validate and launch

Start with a dry run whenever supported by the intended payment path:

```bash
hyper instances launch nvidia/cuda:12.6.3-base-ubuntu22.04 \
  --gpu l40s --count 1 --runtime 3600 \
  --command "nvidia-smi" --dry-run
```

Then launch once and retain the returned job ID:

```bash
hyper instances launch nvidia/cuda:12.6.3-base-ubuntu22.04 \
  --gpu l40s --count 1 --runtime 3600 \
  --command "python app.py" --output json
```

Core controls are:

- placement: `--gpu`, `--count`, `--region`, repeatable `--constraint`, and
  `--cpu-vendor`
- lifetime/cost: `--runtime`, `--interruptible/--on-demand`, and `--dry-run`
- process: `--command`, repeatable `--env`, image, registry credentials, or
  `--dockerfile`
- networking: repeatable `--port`, `--lb`, and `--lb-auth`
- observation: `--follow`, `--cancel-on-exit`, and `--output table|json`
- alternate payment: `--x402 --amount <USDC>`

Interruptible is the default and can be reclaimed. Use on-demand only when the
user accepts the price difference and needs better continuity. A cold-boot dry
run warns that provisioning may take about 15 minutes; a warm indication is
not a guaranteed start time.

The CLI wraps commands containing shell operators in `sh -c`. Quote carefully
and do not put credentials in `--command`, `--env`, `--registry-password`, or
shell history. Registry auth is sent only when both username and password are
provided. A Dockerfile is read completely and base64-encoded; `--dockerfile`
means a remote build on the GPU node and overrides the image as the build base.

### Networking

`--lb <container-port>` creates an HTTPS endpoint at the job hostname with TLS
terminated by Traefik. Add `--lb-auth` unless unauthenticated public access is
intentional. Repeatable `--port <port>` exposes raw TCP with no automatic TLS:

```bash
hyper instances launch image:tag --lb 8080 --lb-auth -p 2222
```

Confirm that the service binds the corresponding container port. Public
endpoints increase exposure; never open a port merely to debug local process
startup.

### x402 launch

```bash
hyper instances launch image:tag --gpu l40s --x402 --amount 2.5
```

`--amount` is required and must be positive. The paid amount determines runtime,
so explicit `--runtime` is ignored. This path unlocks the local wallet and can
print an access key plus status, logs, and cancel URLs; JSON contains all of
them. Treat that output as a credential bundle. Do not retry an ambiguous
payment/launch failure until checking wallet/account state and recent jobs.

The normal product-auth path can dry-run without reserving funds. Do not assume
the same preflight semantics for x402.

## Find and inspect jobs

```bash
hyper jobs list --state running --page 1 --page-size 50
hyper jobs list --tag team=ml --tag env=prod --output json
hyper jobs get <job-id-or-unambiguous-prefix>
```

Tag filters must be `KEY=VALUE`. `list --output json` returns an object with
`jobs`, `total_count`, `page`, and `page_size`. Job JSON can include image,
command, networking, tags, and other deployment details; keep it private if
launch inputs contain sensitive values.

Commands accepting a job ID resolve a 36-character UUID directly or search
recent jobs for a unique prefix. If a prefix is absent or ambiguous, stop and
ask for a full ID rather than selecting one.

## Logs and metrics

```bash
hyper jobs logs <job> --tail 200
hyper jobs logs <job> --follow
hyper jobs logs <job> --tui
hyper jobs metrics <job> --output json
hyper jobs metrics <job> --watch
```

Without `--follow` or `--tui`, logs print to stdout and `--tail` slices locally.
Follow mode uses WebSocket streaming. TUI mode can combine logs and metrics;
`--cancel-on-exit` makes Ctrl+C cancel the job, so use it only when explicitly
requested. Log output may contain application secrets or user data.

Metrics show system CPU/RAM and available GPU utilization, VRAM, temperature,
and power. `--watch` is interactive and ignores JSON output. An absence of GPU
metrics does not itself mean the job failed.

## Remote access

Prefer a bounded one-shot command:

```bash
hyper jobs exec <job> "nvidia-smi" --timeout 30
```

`exec` writes remote stdout to local stdout, stderr to local stderr, and exits
with the remote exit code. Preserve that exit status in automation. Obtain
approval before execution, avoid environment/config dumps, and do not claim
success from output alone when the exit code is nonzero.

Use an interactive PTY only when exec is insufficient:

```bash
hyper jobs shell <job> --shell /bin/bash
```

The current registered shell connects through the director WebSocket proxy and
uses Ctrl+] to disconnect. It requires a running job and Unix TTY support.
Shell access is broad; keep transcripts private and do not mutate unrelated
state.

## Runtime mutation

```bash
hyper jobs extend <job> 7200
hyper jobs cancel <job>
```

`extend` sets the new runtime in seconds and may change cost. `cancel` is
immediate and has no confirmation prompt. Obtain approval, resolve the exact
job, and inspect current state first. After either command, fetch the job again
if the user needs confirmation of terminal state.

## Operational rules

- One launch request can create billable compute. Never submit duplicates while
  polling or after an ambiguous timeout.
- Use `--dry-run` to validate product-auth launches, then re-check live price,
  region, GPU count, runtime, interruptibility, and ports before the real call.
- `--follow` does not mean the launch failed when the client disconnects. Keep
  the job ID and inspect it rather than launching again.
- Cancel only the intended job. A job in a transitional state may still accrue
  cost until cancellation is accepted.
- Report job ID, state, GPU/count, region, price/runtime when available, exposed
  endpoint type, and whether an operation was dry-run or real. Redact keys,
  registry credentials, environment values, and authenticated URLs.
