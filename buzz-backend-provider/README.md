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
stop it before deploying again to apply configuration changes. It emits exactly
one JSON response and writes no protocol diagnostics to stderr.

Stop requests use the provider-assigned HyperCLI deployment id:

```json
{"op":"stop","request_id":"stop-1","agent_id":"deployment-id"}
```

The provider confirms the same `agent_id` only after the HyperCLI stop request
succeeds. Interactive Codex and Claude login is not part of the one-shot
provider protocol; hosted OpenCode can infer through its injected provider
configuration and environment.
