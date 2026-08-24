# HyperCLI Buzz ACP

`hypercli-buzz-acp` is HyperCLI's maintained fork of Block's Apache-2.0
`buzz-acp` crate. It keeps the installed executable name as `buzz-acp` so Buzz
Desktop and hosted runtime images can launch the same stable binary name while
HyperCLI carries the hosted-agent behavior it needs.

## Upstream Baseline

This is a HyperCLI fork, not a mirror that tracks `buzz-git` HEAD. The upstream
revision is recorded as provenance for the original codebase and as the
dependency pin for the Buzz crates this package uses:

- source repository: `https://github.com/block/buzz`
- source crate path: `crates/buzz-acp`
- upstream ref: `8342dfcc5890b81a269a8ec3db73a8a56f76ce79`
- upstream tag: `desktop-v0.5.5`
- upstream commit date: `2026-08-04`

The pin is recorded in `[package.metadata.hypercli]` in `Cargo.toml`. The
`buzz-core`, `buzz-sdk`, and `buzz-persona` git dependencies must all use the
same revision. `tests/upstream_pin.rs` enforces that relationship.

Do not advance this pin just because upstream Buzz changed. Change it only when
we intentionally choose to import a specific upstream fix or protocol change
into the HyperCLI fork.

## Fork Responsibilities

The fork adapts Buzz ACP for HyperCLI-hosted coding agents. The main functional
additions are:

- hosted HyperCLI inference environment injection for Claude Code, Codex, and
  Kimi-compatible ACP children when `HYPERCLI_RUNTIME_INFERENCE=hypercli` is
  set;
- model discovery and switching through child ACP `session/new` capabilities,
  including `BUZZ_ACP_MODEL`;
- helper subcommands for hosted setup flows: `models`, `auth-methods`,
  `authenticate`, and `auth-tag`;
- Buzz-specific base prompt and session metadata handling;
- reply-guard behavior for Buzz-visible replies through
  `BUZZ_ACP_REQUIRE_REPLY`;
- text mention support through `BUZZ_ACP_DISPLAY_NAME` and
  `BUZZ_ACP_TEXT_MENTIONS`;
- relay owner-attestation support through NIP-OA auth tags.

This crate does not own the authoritative model catalog. It asks the child ACP
runtime what models and config options it supports, then applies the requested
model when the child advertises it. A launch-time `BUZZ_ACP_MODEL` mismatch is
treated as a deployment error and exits instead of silently falling back.

## HyperCLI Runtime Inference

Native runtime authentication remains the default. HyperCLI inference routing is
enabled only by the exact opt-in:

```sh
HYPERCLI_RUNTIME_INFERENCE=hypercli
```

When enabled and `HYPER_AGENTS_API_KEY` plus `HYPER_API_BASE` are present, the
fork injects runtime-specific configuration at the ACP child boundary:

- Claude-style runtimes receive Anthropic-compatible environment variables.
- Codex receives a generated `CODEX_CONFIG` with the HyperCLI provider.
- Kimi receives Kimi model/provider environment variables.

If native vendor routing or auth variables are already present for a runtime,
that native configuration wins as a unit. The fork intentionally avoids mixing a
HyperCLI credential with a vendor URL, or the reverse.

## Model Handling

Use `buzz-acp models -- <agent command>` to inspect the model/config catalog
advertised by a child ACP runtime. Model switching prefers stable
`session/set_config_option` config options and falls back to unstable
`session/set_model` when advertised by the child.

`BUZZ_ACP_MODEL` is a launch configuration input. If the selected model is not
advertised by the child runtime, `buzz-acp` exits with status `2` so the hosted
deployment fails loudly instead of running an unintended default model.
Set `BUZZ_MODEL_PREFIX` to qualify bare launch models before catalog lookup;
for example the hosted OpenCode image sets `BUZZ_MODEL_PREFIX=hypercli/` so
`BUZZ_ACP_MODEL=coding-anthropic` resolves to `hypercli/coding-anthropic`.

## Maintenance Notes

Do not edit `/home/ubuntu/dev/buzz-git` for this fork. Treat it as a read-only
reference checkout. HyperCLI-owned behavior lives here, in
`/home/ubuntu/dev/hypercli/buzz-acp`.

Before changing the upstream pin:

1. Compare `buzz-git/crates/buzz-acp` at the current pin to the target upstream
   ref and identify the specific upstream change we want.
2. Reject unrelated upstream churn instead of carrying it forward by default.
3. Review conflict-prone files first: `src/acp.rs`, `src/lib.rs`,
   `src/pool.rs`, `src/queue.rs`, and `src/usage.rs`.
4. Preserve the HyperCLI fork behavior intentionally.
5. Run the crate tests, including `tests/upstream_pin.rs`.
