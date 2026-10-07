# Coding Image Maintainer Guide

This directory builds hosted coding-agent images. Read `README.md` before
changing the provider contract, image entrypoints, runtime commands, or
workspace initialization.

These public recipes consume the private mono's agent-base image. Hyper-ACP
and Hyper-Runner source stays in the private mono's `acp/` tree; only compiled
binaries are distributed in carrier/runtime images. Never copy that source into
this repository or its build contexts.

## Sources Of Truth

- `README.md` is the human architecture and lifecycle reference for these
  images.
- Plain ACP launches carry no compiled ACP base prompt: identity, file, and
  environment instructions land in the seeded native instruction file
  (`AGENTS.md.template`), and the private mono's `acp/hyper-acp` injects nothing on the
  wire — the adapter REJECTS a client `systemPrompt` on
  `session/new|load|resume` and bails when `HYPER_ACP_BASE_PROMPT` /
  `HYPER_ACP_BASE_PROMPT_FILE` is configured (no injection;
  `acp/hyper-acp/crates/hyper-acp/src/adapter.rs`). Buzz provider launches
  deliver no prompt either: hosted Buzz sessions send `mcpServers: []` and
  the plugin rejects system instruction sources; the compiled base prompt is
  test-pinned only and never delivered.
- `/opt/hypercli/skills` contains the installed HyperCLI skill bodies.
- `/opt/hypercli/share/runtime/AGENTS.md.template` is the canonical
  runtime-neutral instruction file. The shared entrypoint seeds it into each
  runtime's resolved native instruction root (per the README matrix) at boot,
  only when no user-managed file, link, or directory exists there. It must
  keep referencing the platform-projected persona files `~/.hypercli/USER.md`
  and `~/.hypercli/SOUL.md`.
- The private mono's `acp/hyper-acp` owns hosted ACP startup. Plain ACP launches run
  `hyper-acp` with `HYPER_ACP_AGENT_COMMAND` and `HYPER_ACP_AGENT_ARGS`.
  Buzz/Nostr launches run `hyper-acp plugin buzz`, which links the copied
  `acp/hyper-acp/plugins/buzz` implementation for relay behavior, prompt
  transport, mention matching, and the shared reply guard. The Buzz plugin
  manifest pins the unmodified upstream Buzz crates it consumes.
- The HyperCLI provider owns translation from Buzz's portable launch request to
  the HyperCLI deployments API.
- HyperClaw/Lagoon owns remote scheduling and container lifecycle.

Do not duplicate these contracts in another Markdown file. Update `README.md`
and the executable tests together when the contract changes.

## Change Rules

- Track upstream Buzz behavior and keep the hosted delta in
  the private mono's `acp/hyper-acp/plugins/buzz` minimal. Advance its documented
  upstream pin only after reviewing the complete upstream `buzz-acp` diff and
  running its tests.
- Never invent a Desktop provider operation. Protocol v1 supports only `info`
  and `deploy`.
- Preserve the resolved `launch` block. Do not reconstruct prompt, access,
  runtime, or policy from unrelated display fields.
- Keep runtime commands and prompt transports explicit in the runtime matrix.
- Keep provider-owned identity, relay, authorization, reply, mention, and
  workspace variables non-overridable by user environment.
- Keep Buzz provider deployments `restart: false`; normal
  `hyper-acp plugin buzz` exit must remain terminal for the pod.
- Do not convert ACP activity or thinking output into a final Buzz message.
- Do not replace user-managed files or links under `/home/node`.
- Do not put secrets, raw provider requests, auth tags, private keys, or
  terminal transcripts in logs, fixtures, or documentation.

## Required Verification

At minimum, run the image contract test for every touched runtime. Changes to
provider or lifecycle behavior also require the sanitized provider-wire and
deployment contract tests in the parent repositories. The checks must cover:

1. Exact command, arguments, MCP command, environment, and prompt transport.
2. Native instruction-file seeding from the canonical `AGENTS.md.template`.
3. No prompt delivery over ACP: configured or client-sent system instructions
   are rejected, never injected.
4. Bounded reply-guard behavior.
5. Independent text-mention matching and author authorization.
6. Persistent user-managed workspace files across initialization.
