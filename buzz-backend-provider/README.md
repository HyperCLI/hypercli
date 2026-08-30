# Buzz HyperCLI backend provider

`buzz-backend-hypercli` is the native executable that lets Buzz create coding
agents on HyperCLI. Buzz discovers executable files named `buzz-backend-*` and
invokes the provider with a one-shot JSON request on stdin/stdout.

The provider calls the managed-agent API directly through the sibling
`hypercli-sdk` Rust crate. It does not shell out to the Python `hyper` CLI.

## Build and install

Run from the repository root:

```bash
cargo test -p buzz-backend-hypercli --all-features --locked
cargo build --release -p buzz-backend-hypercli --locked
mkdir -p ~/.local/bin ~/.local/libexec
install -m 0755 \
  target/release/buzz-backend-hypercli \
  ~/.local/libexec/buzz-backend-hypercli
for runtime in buzz-agent opencode codex claude goose kimi; do
  ln -f ~/.local/libexec/buzz-backend-hypercli \
    ~/.local/bin/buzz-backend-hypercli-${runtime}
done
```

### Windows

The Windows release archive contains one build copied under every runtime
identity that Buzz exposes:

```text
buzz-backend-hypercli.exe
buzz-backend-hypercli-buzz-agent.exe
buzz-backend-hypercli-opencode.exe
buzz-backend-hypercli-codex.exe
buzz-backend-hypercli-claude.exe
buzz-backend-hypercli-goose.exe
buzz-backend-hypercli-kimi.exe
```

Put the executables in `%USERPROFILE%\\.local\\bin`, then reopen Buzz's
create-agent dialog — the backend-provider list refetches on its own (30s
staleness), no restart needed. **Settings > Agents > Check again** refreshes
ACP harnesses only and does *not* rescan backend providers. Buzz scans that
directory explicitly, so it works even when the desktop process did not
inherit a terminal `PATH`.
Keeping all aliases beside the base executable makes each runtime appear as a
separate `Run on` choice while retaining one implementation. The release
workflow builds these files for `x86_64-pc-windows-msvc`; current artifacts are
unsigned and intended for testing until Authenticode signing is configured.

Pass `--dry-run` while exercising the provider manually. Stock Buzz never
supplies this argument. The provider sends one create-validation request with
`dry_run: true` and skips deterministic-handle lookup and restart logic:

```bash
buzz-backend-hypercli --dry-run < tests/fixtures/deploy-request.json
```

Before creating a new deployment, the provider reads the account's live slot
inventory and selects the largest available entitlement (`large`, then
`medium`, then `small`). Existing deterministic-handle deployments are reused
before capacity is considered. If a slot is claimed concurrently and create
returns HTTP 429, the provider refreshes inventory and may retry an
unattempted lower tier. Ordinary non-Buzz coding-agent helpers preserve a
caller-selected size or omit it so the backend chooses its default. The
provider tags every new deployment with `app=buzz` and the existing
`buzz_agent=<public-key>` identity tag. Portable launches that genuinely omit
`BUZZ_ACP_AGENTS` receive a memory-tier default of 2 workers on small, 5 on
medium, and 10 on large. Any concrete value supplied by Buzz, including 1, is
preserved exactly.
The resolved `agent.launch.command`
selects the canonical runtime and image; legacy requests without `launch` fall
back to `agent.agent_command`. Runtime-named provider hardlinks remain only for
saved-provider compatibility and discovery. The provider exposes no editable
configuration in Buzz, enables the canonical `/home/node` workspace sync, and
still accepts old saved image and workspace values for compatibility. It
rejects secret-looking provider config; Buzz supplies the agent identity
separately in the deploy request. Buzz launches explicitly set
`restart: false`, including when the provider starts an existing stopped
deployment, so an accepted `!shutdown` does not automatically relaunch
`hyper-acp`.

For portable launches, `launch.policy_env` is the default tier and
`launch.env` wins over it; legacy top-level launch fields are ignored. The
provider validates the resulting `BUZZ_ACP_AGENTS` value, rejects arguments
that cannot survive Buzz ACP's comma-delimited transport, and rewrites
host-resolved executables such as `CLAUDE_CODE_EXECUTABLE` to image-local
paths. Hosted identity and workspace values are applied last. When Desktop
supplies an authorization tag, it remains the authoritative owner proof;
`launch.owner_pubkey` is the legacy fallback, matching local Tauri runtime
behavior.

Image immutability is currently an operator responsibility. The provider does
not yet enforce a registry allowlist or digest-only reference, and the selected
image receives the agent nsec and caller environment.

## Authentication and tracing

Credential discovery matches the Python SDK:

1. `HYPER_AGENTS_API_KEY`
2. `HYPER_API_KEY`
3. `HYPERCLI_API_KEY`
4. the same keys in `~/.hypercli/config`
5. legacy `~/.hypercli/agent-key.json`

API-base settings use `AGENTS_API_BASE_URL`, `HYPER_API_BASE`, or
`HYPERCLI_API_URL`. Set `HYPER_HTTP_TRACE_FILE` to capture redacted JSONL HTTP
traces from the Rust SDK. Response bodies are always omitted because upstream
validation errors can echo launch secrets.

## Protocol

Info request:

```json
{"op":"info","request_id":"probe-1"}
```

Deploy requests include the Buzz agent payload and provider config. This
example is abbreviated; stock v0.5.2 also emits model/provider, timeout,
parallelism, response-policy, allowlist, prompt, and authorization fields:

```json
{
  "op": "deploy",
  "request_id": "deploy-1",
  "agent": {
    "name": "Fizz",
    "relay_url": "wss://buzz.example.com",
    "private_key_nsec": "nsec1...",
    "agent_command": "opencode",
    "agent_args": ["acp"],
    "env_vars": {}
  },
  "provider_config": {}
}
```

The provider derives a deterministic user-scoped handle from the agent public
key, checks for an existing deployment before create, and repeats the lookup
after a conflict. A deploy request restarts a stopped deployment with the
request's current launch settings. New deployments carry a non-secret launch
fingerprint tag. An identical request for an already-running deployment is
idempotent; a changed request fails clearly until the agent is stopped. Once
stopped, changed launch settings or a changed runtime replace the old
deployment so Buzz's “changes apply next spawn” contract remains true. Legacy
same-runtime deployments without a fingerprint retain the compatible restart
path. For `failed`, let cleanup reach `stopped` (or stop the deployment with
authenticated HyperCLI tooling), then deploy again; the provider never starts
through an uncleared runtime. It emits exactly one JSON response and writes no
protocol diagnostics to stderr.

Stock v0.5.2 sends `idle_timeout_seconds`, legacy
`turn_timeout_seconds`, `max_turn_duration_seconds`, `respond_to`, and
`respond_to_allowlist`. The provider validates their relationships and allowed
values before deployment. For Goose only, non-empty structured Buzz `model` and
`provider` values become `GOOSE_MODEL` and `GOOSE_PROVIDER`.

Stock Buzz Desktop v0.5.2 invokes backend providers only for `info` and
`deploy`; there is no provider stop or undeploy request. Desktop's Shutdown
action sends a best-effort owner-authored, agent-mentioned `!shutdown` channel
message. Without a shared channel it errors. If delivered and accepted, stock
`hyper-acp` exits. New provider launches set `restart: false`, so the hosted
terminal-state observer can clean the namespace, mark the deployment
`stopped`, and release its slot. Desktop receives no acknowledgement and does
not reconcile its local deployed record. Use authenticated HyperCLI lifecycle
APIs when reliable infrastructure stop/delete is required.

## Stock Buzz compatibility

The provider and SDK matrix tests validate representative generated shapes for
native Buzz Agent, OpenCode, Codex, Claude Code, Goose, and Kimi Code. They do not launch those
runtimes or prove an end-to-end conversational reply. The hosted path has been
exercised with stock Buzz and OpenCode: the harness connected and an explicit
`buzz messages send` published successfully. Stock Buzz expects ACP NDJSON;
non-JSON child output is skipped, and `agent_message_chunk` is activity
telemetry rather than a channel publication. There is no plaintext fallback. A
visible response requires the agent to invoke the Buzz send command/tool.

The provider owns the default hosted image catalog because every provider
deployment is a Buzz launch. Its defaults are the dedicated `hypercli-buzz-agent`,
`hypercli-buzz-opencode`, `hypercli-buzz-codex`, `hypercli-buzz-claude`,
`hypercli-buzz-goose`, and `hypercli-buzz-kimi-code` families. The reusable
Rust SDK deliberately has no image catalog; it renders launch behavior onto a
caller-supplied deployment request, leaving image policy to the provider or
application.

The provider keeps `sync_root=/home/node` for persistence and Files API access.
It defaults `HYPER_WORKSPACES_DIR` to `/home/node/shared` for HyperCLI
Workspace projections and preserves an explicit caller environment value. The
Buzz-specialized image entrypoint reconciles the standard nest after mount and
runs the harness from `/home/node/.buzz`; OpenCode and Codex use its canonical
`AGENTS.md`, and Claude Code creates `CLAUDE.md -> AGENTS.md`.
`base_prompt.md` remains compiled into the Buzz-compatible path inside
`hyper-acp`.

Interactive Codex and Claude login is not part of the one-shot provider
protocol. Hosted OpenCode can infer through its injected provider configuration
and environment.

## Secret handling

The provider receives the agent nsec and caller environment, then includes both
in the raw deployment launch environment. The HyperClaw backend currently
persists that environment in `Agent.launch_config`; authenticated deployment
read, environment, and exec surfaces may therefore expose those values. Treat
this integration as experimental for sensitive credentials until launch
secrets use encrypted or external secret references.

The default `RUST_LOG` filter keeps harness lifecycle diagnostics while
disabling `acp::stream` content logging. A caller can opt into a different
filter, but enabling `acp::stream` can write generated message text to
centralized container logs.
