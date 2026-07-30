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
install -m 0755 \
  target/release/buzz-backend-hypercli \
  ~/.local/bin/buzz-backend-hypercli
```

Pass `--dry-run` while exercising the provider manually. Stock Buzz never
supplies this argument. The provider sends one create-validation request with
`dry_run: true` and skips deterministic-handle lookup and restart logic:

```bash
buzz-backend-hypercli --dry-run < tests/fixtures/deploy-request.json
```

Buzz-backed coding-runtime launches require the HyperCLI `large` tier.
Ordinary non-Buzz coding-agent helpers preserve a caller-selected size or omit
it so the backend chooses its default. Provider configuration selects a
runtime, permits an optional immutable image override, and can name an optional
workspace. The provider rejects secret-looking provider config; Buzz supplies
the agent identity separately in the deploy request. Buzz launches explicitly
set `restart: false`, including when the provider starts an existing stopped
deployment, so an accepted `!shutdown` does not automatically relaunch
`buzz-acp`.

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
  "provider_config": {
    "runtime": "opencode",
    "size": "large"
  }
}
```

The provider derives a deterministic user-scoped handle from the agent public
key, checks for an existing deployment before create, and repeats the lookup
after a conflict. A deploy request restarts a stopped deployment with the
request's current launch settings. A deploy request for an already-running
deployment is idempotent and does not update its launch settings in place;
stop it through the authenticated HyperCLI deployment API before asking Buzz
to deploy it again with changed settings. It emits exactly one JSON response
and writes no protocol diagnostics to stderr.

Stock v0.5.2 sends `idle_timeout_seconds`, legacy
`turn_timeout_seconds`, `max_turn_duration_seconds`, `respond_to`, and
`respond_to_allowlist`. The provider validates their relationships and allowed
values before deployment. For Goose only, non-empty structured Buzz `model` and
`provider` values become `GOOSE_MODEL` and `GOOSE_PROVIDER`.

Stock Buzz Desktop v0.5.2 invokes backend providers only for `info` and
`deploy`; there is no provider stop or undeploy request. Desktop's Shutdown
action sends a best-effort owner-authored, agent-mentioned `!shutdown` channel
message. Without a shared channel it errors. If delivered and accepted, stock
`buzz-acp` exits, but Desktop receives no acknowledgement and does not stop or
reconcile the HyperCLI deployment. Use authenticated HyperCLI lifecycle APIs
for infrastructure stop/delete.

## Stock Buzz compatibility

The provider and SDK matrix tests validate representative generated shapes for
OpenCode, Codex, Claude Code, Goose, and Kimi Code. They do not launch those
runtimes or prove an end-to-end conversational reply. The hosted path has been
exercised with stock Buzz and OpenCode: the harness connected and an explicit
`buzz messages send` published successfully. Stock Buzz expects ACP NDJSON;
non-JSON child output is skipped, and `agent_message_chunk` is activity
telemetry rather than a channel publication. There is no plaintext fallback. A
visible response requires the agent to invoke the Buzz send command/tool.

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
