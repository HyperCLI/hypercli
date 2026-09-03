# Hyper ACP Slack Relay

Slack connector boundary for HyperCLI ACP. The crate ports OpenClaw Slack
semantics into Rust and runs as a standalone plugin that owns its own ACP
session pool: one conversation scope (`team:channel:thread`, or the DM
conversation) maps to one `new_session` on the plugin-spawned ACP child.

## Running

The plugin is bundled into the `hyper-acp` binary as the `slack` subcommand:

```sh
hyper-acp plugin slack
```

## Ingress → dispatch

`run_slack_relay_with_control` connects to the HyperCLI Slack relay (WebSocket),
admits events through dedupe/DM-auth/admission gates, durably logs claims and
dispatches, and enqueues per-scope envelopes onto the plugin's event queue.
`plugin.rs` flushes batches into the pool (`pool.rs`), and the pool runs turns
against the spawned ACP agent via the official `agent-client-protocol` SDK,
delivering replies through the relay HTTP API. Durable `Commit` records are
written only at a turn's terminal state (success/dead-letter); on restart,
uncommitted dispatches replay back into the queue.

Required env:

- `HYPER_ACP_SLACK_RELAY_URL`
- `HYPER_ACP_SLACK_GATEWAY_ID`
- `HYPER_AGENTS_API_KEY`

Plus the ACP agent command env (`HYPER_ACP_AGENT_COMMAND` /
`HYPER_ACP_AGENT_ARGS`), see the plugin CLI `--help`.

Optional env:

- `HYPER_ACP_SLACK_DURABLE_LOG`: JSONL durable accept log path. Defaults to a
  deterministic file under the OS temp directory.
- `HYPER_ACP_SLACK_ACCOUNT_ID`: logical account id for Slack message dedupe.
- `HYPER_ACP_SLACK_BOT_USER_ID`, `HYPER_ACP_SLACK_BOT_ID`: self/bot mention
  detection.
- `HYPER_ACP_SLACK_DM_POLICY`: `open`, `disabled`, `allowlist`, or `pairing`.
- `HYPER_ACP_SLACK_GROUP_POLICY`: `open`, `disabled`, or `allowlist`.
- `HYPER_ACP_SLACK_ALLOW_FROM`: comma-separated Slack sender allowlist.
- `HYPER_ACP_SLACK_CHANNELS`: comma-separated Slack channel allowlist.
- `HYPER_ACP_SLACK_CHANNELS_JSON`: channel allowlist in JSON form —
  either a plain array (`["C1","C2"]`) or the launcher object form
  (`{"C1": {"allow": true, ...}}`); wins over the comma-separated form when
  both are set. Entries with `"allow": false` or `"enabled": false` are
  excluded.
- `HYPER_ACP_SLACK_REQUIRE_MENTION`: boolean room mention gate.
- `HYPER_ACP_SLACK_IGNORE_OTHER_MENTIONS`: boolean other-mention gate.
- `HYPER_ACP_SLACK_ALLOW_BOTS`: `off`, `all`, or `mentions`.
- `HYPER_ACP_SLACK_REPLY_TO_MODE`: `off`, `first`, `all`, or `batched`.
- `HYPER_ACP_SLACK_ACP_MODE`: `spawn` (own child) or `connect` (existing
  `SteamSocket`); `HYPER_ACP_SLACK_ACP_MAX_TURNS_PER_SESSION`: session rotation
  threshold.

The ingress loop records relay payload/action metadata before returning/sending
an ack. Accepted events are deduped by OpenClaw's logical Slack
`[account, team, channel, ts]` key, passed through admission gates, enriched
with portable file/message metadata, and scoped/enqueued for the pool. When the
relay supplies `thread_history`/`threadHistory` and
`thread_starter`/`threadStarter`, the plugin unrolls that context into the
prompt text with the same portable role/id formatting used by OpenClaw.
