# Buzz ACP plugin provenance

Source: `/home/ubuntu/dev/buzz-git/crates/buzz-acp`

Source commit: `eed74bde2f4797714335ac10c56c0b0244c1def4`

Last source commit touching `crates/buzz-acp`: `69096c9a8 preserve channel description paragraph breaks (#6946)`

This plugin directory was created by copying `crates/buzz-acp` from the source
tree 1:1, preserving the upstream module structure and tests, including
`src/prompt_framing.rs`, `src/prompt_project.rs`, and
`tests/pool_lifecycle_state.rs`.

Deliberate deviations:

- `Cargo.toml` replaces upstream workspace-inherited package metadata with the
  concrete values from `/home/ubuntu/dev/buzz-git/Cargo.toml`.
- `Cargo.toml` replaces upstream workspace-inherited dependency declarations
  with concrete dependency versions from `/home/ubuntu/dev/buzz-git/Cargo.toml`.
- `Cargo.toml` points `buzz-core`, `buzz-sdk`, and `buzz-persona` at upstream
  `block/buzz.git` revision `eed74bde2f4797714335ac10c56c0b0244c1def4` so the
  active HyperCLI build does not depend on the old `/home/ubuntu/dev/hypercli/buzz-acp`
  fork.
No relay, queue, owner-command, auth/membership, prompt gating, observer, or
activity semantics are intentionally changed from the source tree.
