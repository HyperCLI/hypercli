# Hyper ACP Buzz plugin provenance

This plugin was ported from upstream Buzz ACP.

- Source: `/home/ubuntu/dev/buzz-git/crates/buzz-acp`
- Source commit: `0e878664b08cdf7fb2d89d940bc2aa92cdc485f7`
- Last source commit touching `crates/buzz-acp`: `42aeb1571 feat(desktop): add Pi agent preset (#7208)`

The following upstream files are copied into this plugin and, except for the
deliberate deviations documented below, remain the parity source for Buzz
behavior:

- `src/acp.rs`
- `src/base_prompt.md`
- `src/config.rs`
- `src/engram_fetch.rs`
- `src/filter.rs`
- `src/lib.rs`
- `src/observer.rs`
- `src/pool.rs`
- `src/pool_lifecycle.rs`
- `src/prompt_framing.rs`
- `src/prompt_project.rs`
- `src/queue.rs`
- `src/relay.rs`
- `src/scope.rs`
- `src/session_model_channel.md`
- `src/session_model_thread.md`
- `src/setup_mode.rs`
- `src/usage.rs`
- `tests/pool_lifecycle_state.rs`

Deliberate deviations:

- `Cargo.toml` makes this a Hyper ACP plugin crate named `hyper-acp-buzz`.
- `Cargo.toml` replaces upstream workspace-inherited dependency declarations
  with concrete dependency versions and pinned upstream `buzz-core`,
  `buzz-sdk`, and `buzz-persona` dependencies.
- `src/lib.rs` exposes explicit plugin entrypoints:
  `run_from_hyper_acp(...)`, `run_plugin(...)`, and `run_compat_binary()`.
- `src/lib.rs` accepts explicit argv so `hyper-acp plugin buzz` can run the
  plugin in-process without an external plugin binary boundary.
- `src/lib.rs` routes tracing to stderr so stdout remains available for ACP
  protocol traffic.
- `src/config.rs` and `src/lib.rs` add the `auth-tag` helper by reusing
  upstream `buzz_sdk::nip_oa::compute_auth_tag`, matching the upstream
  `crates/buzz-sdk/examples/compute_auth_tag.rs` utility.
- `src/acp.rs` Unix test helpers spawn a
  `symlink("/bin/bash")`/`symlink("/bin/sh")` with the script passed via `-c`
  instead of writing + chmod + shebang-exec, for CI filesystems where freshly
  written scripts cannot be exec'd (noexec tmp / ETXTBSY / shebang resolution).
- `src/config.rs` reads the permission mode from `HYPER_ACP_PERMISSION_MODE`
  and defaults to `default` instead of upstream's `BUZZ_ACP_PERMISSION_MODE`
  defaulting to `bypass-permissions`.
- `src/acp.rs` fails closed on `session/request_permission`: it selects the
  `reject_once` option and, when no reject option is offered, responds with a
  cancelled result instead of upstream's auto-approve of `allow_once`.
- `src/pool.rs` no longer applies a non-default permission mode as a safety
  valve for auto-approved tool calls; the comment and docs reflect that
  permission requests fail closed in `AcpClient`.
- Blind signing: the agent child holds no Buzz credentials. `src/acp.rs`
  strips `BUZZ_PRIVATE_KEY`, `NOSTR_PRIVATE_KEY`, `BUZZ_AUTH_TAG`, and the
  legacy `BUZZ_ACP_PRIVATE_KEY` alias from the child environment at spawn and
  terminates the agent→client `buzz/publish` JSON-RPC method (params
  validated, channel-scoped, signed with the plugin's keys, relayed via
  `RelayEventPublisher`). Upstream had no such method; unknown methods there
  fall through to -32601.
- No-upstream-counterpart modules: `src/publish.rs` (shared validate/sign/
  publish core), `src/mcp_bridge.rs` (in-process MCP bridge on a loopback
  listener; per-session channel-bound capability tokens), and
  `src/mcp_shim.rs` (hidden `__buzz-mcp-shim` re-exec entry that pipes the
  agent's MCP stdio to the bridge; env carries only the bridge address and
  token). `src/pool.rs` injects the per-session `buzz` MCP server at
  `session/new` and installs the per-turn publish context; `src/lib.rs`
  starts the bridge after relay connect and routes the shim marker before
  clap parsing.
- `src/base_prompt.md` and `src/queue.rs` teach the agent to publish via the
  plugin-signed `publish` tool on the `buzz` MCP server (with `reply_to`
  threading) instead of `buzz messages send --reply-to`, and describe the
  two-surface access model (publish tool vs. `buzz` CLI inside the dev-MCP
  shell). Event parsing, threading anchors, and queue semantics are
  unchanged from upstream; only the publish surface instructions differ.
- `src/lib.rs` retains the dev-MCP `BUZZ_PRIVATE_KEY`/`BUZZ_AUTH_TAG` env
  injection as a documented residual: reads and non-publish writes still run
  through the dev MCP server. The agent child env no longer carries those
  keys; removing the injection entirely is the tracked follow-up once reads
  move behind the plugin bridge.

No relay, queue, owner-command, auth/membership, prompt gating, observer,
setup, usage, session-pool, or other permission semantics beyond the
deviations listed above are intentionally changed from upstream.
