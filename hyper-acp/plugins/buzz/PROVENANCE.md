# Hyper ACP Buzz plugin provenance

This plugin was ported from upstream Buzz ACP.

- Source: `/home/ubuntu/dev/buzz-git/crates/buzz-acp`
- Source commit: `eed74bde2f4797714335ac10c56c0b0244c1def4`
- Last source commit touching `crates/buzz-acp`: `69096c9a8 preserve channel description paragraph breaks (#6946)`

The following upstream files are copied into this plugin and remain the parity
source for Buzz behavior:

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

No relay, queue, owner-command, auth/membership, prompt gating, observer,
setup, usage, or session-pool semantics are intentionally changed from
upstream.
