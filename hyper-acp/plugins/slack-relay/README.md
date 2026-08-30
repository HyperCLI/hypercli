# Hyper ACP Slack Relay

Slack relay plugin boundary for HyperCLI ACP. The crate ports OpenClaw Slack
relay semantics into Rust without adding direct Slack bot-token delivery.

## Active Runtime

`active::run_slack_relay_to_acp_client_frames` connects to the HyperCLI Slack
relay and emits canonical ACP JSON-RPC `session/prompt` request frames. It never
emits `turn.submit`.

Required env:

- `HYPER_ACP_SLACK_RELAY_URL`
- `HYPER_ACP_SLACK_GATEWAY_ID`
- `HYPER_ACP_SLACK_SESSION_ID`
- `HYPER_AGENTS_API_KEY`

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
- `HYPER_ACP_SLACK_REQUIRE_MENTION`: boolean room mention gate.
- `HYPER_ACP_SLACK_IGNORE_OTHER_MENTIONS`: boolean other-mention gate.
- `HYPER_ACP_SLACK_ALLOW_BOTS`: `off`, `all`, or `mentions`.
- `HYPER_ACP_SLACK_REPLY_TO_MODE`: `off`, `first`, `all`, or `batched`.

The active loop records relay payload/action metadata before returning/sending
an ack. Accepted events are deduped by OpenClaw's logical Slack
`[account, team, channel, ts]` key, passed through admission gates, enriched with
portable file/message metadata, and then serialized as ACP `session/prompt`.
When the relay supplies `thread_history`/`threadHistory` and
`thread_starter`/`threadStarter`, the plugin unrolls that context with the same
portable role/id formatting used by OpenClaw.
