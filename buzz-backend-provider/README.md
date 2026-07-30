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

Pass `--dry-run` while exercising the one-shot provider protocol to forward a
HyperCLI dry-run create request without allocating a runtime:

```bash
buzz-backend-hypercli --dry-run < tests/fixtures/deploy-request.json
```

Coding runtimes require the HyperCLI `large` tier. Provider configuration
selects a runtime, permits an optional immutable image override, and can name
an optional workspace. The provider rejects secret-looking provider config;
Buzz supplies the agent identity separately in the deploy request.

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

Deploy requests include the Buzz agent payload and provider config:

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

Stock Buzz currently calls backend providers for `info` and `deploy` only. It
does not send an undeploy/stop operation. The Buzz shutdown control stops the
harness presence but does not stop the remote HyperCLI deployment. Buzz also
disables start-on-app-launch for provider-backed agents. Edits are stored by
Buzz, but a running HyperCLI deployment keeps its existing launch environment
until it is stopped out of band and deployed again.

## Stock Buzz compatibility

The provider and SDK matrix tests validate generated request shapes for
OpenCode, Codex, Claude Code, Goose, and Kimi Code. They do not launch those
runtimes or prove an end-to-end conversational reply. The hosted path has been
exercised with stock Buzz and OpenCode: the harness connected and an explicit
`buzz messages send` published successfully. Stock Buzz does not automatically
forward ordinary ACP assistant text to chat, so a visible response requires the
agent to invoke the Buzz send command/tool.

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
