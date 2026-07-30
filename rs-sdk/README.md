# HyperCLI Rust SDK

`hypercli-sdk` is the reusable typed Rust client for HyperCLI managed-agent
deployments. Executable integrations belong in their own top-level packages;
the Buzz provider lives in `../buzz-backend-provider/`.

The repository root is the Cargo workspace. Run Rust gates from there:

```bash
cargo fmt --all --check
cargo clippy --workspace --all-targets --all-features --locked -- -D warnings
cargo test --workspace --all-features --locked
cargo doc --workspace --all-features --no-deps --locked
cargo package -p hypercli-sdk --allow-dirty --locked
```

The client reads credentials and endpoint configuration from environment
variables and `~/.hypercli/config`. Set `HYPER_HTTP_TRACE_FILE` to append
mode-`0600` JSONL request traces. Trace payloads recursively redact
secret-looking fields, omit authorization headers, and never record response
bodies.

## Buzz coding-agent launch

`BuzzLaunchConfig` renders the private Buzz identity and behavior onto a typed
`CreateDeploymentRequest` while deriving the executable command, arguments,
and MCP bridge from the selected coding runtime:

```rust
use hypercli_sdk::{BuzzLaunchConfig, CreateDeploymentRequest, ManagedRuntime};

let mut request = CreateDeploymentRequest::new(ManagedRuntime::Opencode);
let mut buzz = BuzzLaunchConfig::new(agent_nsec, relay_url);
buzz.auth_tag = Some(owner_signed_auth_tag);
buzz.parallelism = 1;
buzz.apply_to(&mut request, Some("Fizz"))?;
```

The renderer enforces the `large` tier, `/home/node` persistence with UID/GID
1000, no public routes, lazy pool creation, relay observation, and canonical
runtime launch values. The config does not implement `Debug` or `Serialize`
because it owns the agent nsec.
