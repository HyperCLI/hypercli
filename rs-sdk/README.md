# HyperCLI Rust SDK and Buzz provider

This isolated Cargo workspace contains:

- `hypercli-sdk`: a reusable, typed client for the managed deployment API.
- `buzz-backend-hypercli`: the stock Buzz Desktop backend-provider executable.

It does not implement ACP. In a deployed coding image, `buzz-acp` owns the
relay-to-runtime ACP session over stdio.

## Build and test

```bash
cd rs-sdk
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features -- -D warnings
cargo test --workspace --all-features --locked
cargo doc --workspace --all-features --no-deps --locked
cargo package -p hypercli-sdk --allow-dirty --locked
```

Repository CI runs those gates on every matching `main` or `dev` commit using
the declared Rust 1.95 toolchain. The provider package itself cannot pass
`cargo package` verification until `hypercli-sdk` version 0.1.0 is published to
crates.io; the executable is therefore distributed as a native release
artifact instead of a crates.io package.

`.github/workflows/release-buzz-provider.yml` builds unsigned Linux
x86-64/aarch64 and macOS Intel/Apple Silicon archives from one exact git ref.
It runs the native provider protocol smoke before assembling checksums. Public
release publication is opt-in; these test artifacts are intentionally not
represented as signed or notarized production binaries. The first published
test build is the `buzz-provider-v0.1.0` GitHub release.

## Provider installation

Build the provider and place the executable somewhere Buzz discovers:

```bash
cargo build --release -p buzz-backend-hypercli
install -m 0755 \
  target/release/buzz-backend-hypercli \
  ~/.local/bin/buzz-backend-hypercli
```

Buzz discovers executable `buzz-backend-*` files and shows this one as
`hypercli` in the agent creation dialog.

## Authentication

The provider does not accept credentials through `provider_config`. It uses the
same local sources as the Python HyperCLI CLI, in this order:

1. `HYPER_AGENTS_API_KEY`
2. `HYPER_API_KEY`
3. `HYPERCLI_API_KEY`
4. the same keys in `~/.hypercli/config`
5. legacy `~/.hypercli/agent-key.json`

The agents API base is resolved from `AGENTS_API_BASE_URL`, `HYPER_API_BASE`,
or `HYPERCLI_API_URL`, with environment values preceding local config.

Provider configuration is limited to flat, non-secret choices:

- `runtime`: `opencode`, `codex`, `claude-code`, `goose`, or `kimi-code`
- `size`: `small`, `medium`, or `large`
- `image`: optional image override
- `workspace`: optional HyperCLI workspace ID

Fields with secret-looking word segments such as `api_key`, `accessToken`,
`password`, or `credential` are rejected even if a caller bypasses Buzz's
matching validation.

## One-shot Buzz protocol

The process reads at most 1 MiB of JSON from stdin and emits exactly one JSON
object on stdout. It writes no diagnostics or request data to stderr.

Info:

```json
{"op":"info","request_id":"..."}
```

Deploy:

```json
{
  "op": "deploy",
  "request_id": "...",
  "agent": {
    "name": "Fizz",
    "relay_url": "wss://buzz.example.com",
    "private_key_nsec": "nsec1...",
    "auth_tag": "[\"auth\",\"...\"]",
    "agent_command": "opencode",
    "agent_args": ["acp"],
    "env_vars": {}
  },
  "provider_config": {
    "runtime": "opencode",
    "size": "small"
  }
}
```

The provider derives the agent pubkey from `private_key_nsec` and computes a
deterministic user-scoped handle from 192 bits of that pubkey. It looks up that
handle before creating a deployment and repeats the lookup after a create
conflict. This prevents ordinary retries from creating duplicate pods without
adding a local provider database.

For a stopped matching deployment, another `deploy` starts it with the current
launch payload. For a running deployment, v1 returns its existing ID without
mutating it.

## Security limitations

This is a development prototype, not a production-safe secret boundary.

Buzz necessarily sends the provider the agent nsec, owner auth tag, and merged
runtime environment. The provider never logs them and never includes HyperCLI
response bodies in errors, but the current HyperClaw backend stores raw launch
environment values in `Agent.launch_config`. Ordinary deployment reads can
return that object, and live environment/exec APIs can expose pod credentials.
That server-side behavior must be replaced by encrypted or external secret
references before production distribution.

Credential discovery also retains compatibility with the legacy
`~/.hypercli/agent-key.json` file. The existing Python login flow does not
consistently guarantee mode `0600`; this provider reads the file but does not
silently change its permissions. A production installer/login should use a
narrow deploy capability and protected storage such as macOS Keychain.

The deterministic handle is also not an atomic idempotency key. It closes
normal retry and create-race cases, but the API has no conditional
create-or-update operation. A repeated deploy cannot rotate credentials on an
already-running pod. Provider protocol v1 also has no stop, delete, inspect, or
adopt operation.

The default coding images are public GHCR release references. CI first builds
and tests immutable internal SHA images, then copies the same tested content to
GHCR. A provider E2E must use the public full-SHA tag; the mutable `latest`
defaults are only the user-facing convenience after promotion.
