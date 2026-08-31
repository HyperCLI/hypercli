# Hyper ACP provenance

This tree starts from the canonical Agent Client Protocol repository.

- Source URL: https://github.com/agentclientprotocol/agent-client-protocol
- Source commit: `8a3fc6ff57465461d653756f16538f58bbbdf3d1`
- Local source used for the copy: `/home/ubuntu/dev/agent-client-protocol-git`
- License: Apache-2.0, preserved in `LICENSE`

The root `Cargo.toml` and `Cargo.lock` from the canonical source are not used as
the active HyperCLI workspace roots. HyperCLI flattens the copied ACP crates into
`/home/ubuntu/dev/hypercli/Cargo.toml` so `hyper-acp`, the copied Buzz plugin,
and HyperCLI's SDK/provider crates build and test under one lockfile.

HyperCLI-specific additions are intentionally isolated under:

- `crates/hyper-acp`: the HyperCLI ACP launcher/transport wrapper.
- `plugins/buzz`: the Hyper ACP Buzz plugin, ported from upstream Buzz ACP with
  its own provenance file.
- `plugins/buzz-acp`: a thin compatibility binary for callers that still expect
  the `buzz-acp` executable name. It delegates to `plugins/buzz`.
- `plugins/slack-relay`: the Slack relay plugin.
