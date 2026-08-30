# Slack Relay Parity Boundary

This crate is the active HyperCLI ACP Slack relay plugin boundary. It ports the
OpenClaw Slack relay semantics that are relevant on the agent/client side of the
HyperCLI relay:

## Module Map

The public Rust module tree now mirrors the OpenClaw Slack responsibility map
where feasible:

- `monitor::relay_source` -> `monitor/relay-source.ts`
- `monitor::context` -> `monitor/context.ts`
- `monitor::dm_auth` -> `monitor/dm-auth.ts`
- `monitor::message_dispatch_dedupe` -> `monitor/message-dispatch-dedupe.ts`
- `monitor::reconnect_policy` -> `monitor/reconnect-policy.ts`
- `monitor::ingress` -> `monitor/ingress.ts`
- `monitor::thread` -> `monitor/thread.ts`
- `monitor::media` -> `monitor/media.ts` and `monitor/media-types.ts`
- `monitor::replies` -> `monitor/replies.ts`
- `monitor::message_handler::prepare` -> `monitor/message-handler/prepare.ts`
- `monitor::message_handler::prepare_content` ->
  `monitor/message-handler/prepare-content.ts`
- `monitor::message_handler::prepare_thread_context` ->
  `monitor/message-handler/prepare-thread-context.ts`
- `monitor::message_handler::dispatch` -> `monitor/message-handler/dispatch.ts`
- `send` -> `send.ts`
- `client_delivery` -> `client-delivery.ts`

The facades intentionally re-export the tested implementation helpers rather
than duplicating logic. Relay-specific websocket frame parsing and ack handling
remain isolated in `relay_source` and `active`; raw Slack Events API
normalization lives in `event` so a direct Slack connector can feed the same
admission/content/history/reply helpers later.

- Relay URL conversion, localhost-only plaintext safety, bearer auth,
  websocket connect/reconnect, hello/event parsing, durable-before-ack:
  `openclaw-git/extensions/slack/src/monitor/relay-source.ts` lines 16-20,
  24-25, 37-91, 93-134, 136-228, and 230-375.
- Reconnect constants and terminal auth-error classification:
  `openclaw-git/extensions/slack/src/monitor/reconnect-policy.ts` lines 5-14
  and 161-167. The active relay loop treats those auth failures as terminal
  instead of retrying forever.
- Channel, DM, sender, mention, bot, and bot-loop admission facts:
  `openclaw-git/extensions/slack/src/monitor/policy.ts` lines 2-14,
  `monitor/message-handler/prepare.ts` lines 553-638 and 1243-1305, and
  `monitor/message-handler/dispatch-helpers.ts` lines 19-46. HyperCLI also
  mirrors the HyperClaw relay-generated defaults in
  `hyperclaw-backend/slack-relay/app/routing.py` lines 105-148, including
  `dmPolicy=open` and `replyToModeByChatType.direct=off`.
- Allowlist normalization/matching:
  `openclaw-git/extensions/slack/src/monitor/allow-list.ts` lines 42-109.
- Command mention stripping and slash command matching:
  `openclaw-git/extensions/slack/src/monitor/commands.ts` lines 5-39.
- Thread timestamp, thread history seed decision, history unroll formatting:
  `openclaw-git/extensions/slack/src/thread-ts.ts` lines 4-23,
  `monitor/message-handler/timestamp.ts` lines 4-16, and
  `monitor/message-handler/prepare-thread-context.ts` lines 176-200 and
  368-395.
- File references, attachment fallback, mention rendering cap, inherited parent
  file filtering, and Slack message id/channel/thread footer:
  `openclaw-git/extensions/slack/src/file-reference.ts` lines 5-16,
  `monitor/message-handler/prepare-content.ts` lines 18-217, and
  `monitor/message-handler/prepare.ts` lines 1412-1416.
- Dedupe key and constants:
  `openclaw-git/extensions/slack/src/monitor/message-dispatch-dedupe.ts`
  lines 1-42.
- Reply thread timestamp resolution:
  `openclaw-git/extensions/slack/src/monitor/replies.ts` lines 58-67. The
  active path carries per-chat reply mode into ACP metadata so DM replies can
  be `off` while channel replies stay `all`.
- HyperCLI relay routing, frame ids, relay config, queue, ack, and shutdown:
  `hyperclaw-backend/slack-relay/app/routing.py` lines 9-59 and 75-148,
  `app/relay.py` lines 25-196 and 201-252, and `app/schemas.py` lines 8-43
  and 178-205.
- Outbound Slack delivery planning follows OpenClaw's reply delivery shape in
  `openclaw-git/extensions/slack/src/monitor/replies.ts` lines 69-336 and
  delivery metadata/reconciliation markers from
  `openclaw-git/extensions/slack/src/send.ts` lines 557-618 and 735-854,
  while staying behind the HyperCLI relay API proxy and
  `HYPER_AGENTS_API_KEY`.
- Active runtime wiring:
  `hyper-acp/plugins/slack-relay/src/active.rs` connects the relay source to
  admission gates, logical Slack dedupe, durable-before-ack recording,
  thread-history unroll, file/message metadata, reply-thread metadata,
  reconnect backoff, shutdown control, and canonical ACP `session/prompt`
  JSON-RPC frames.

Parity tests live with each helper module and in `src/active.rs`. The active
tests cover canonical ACP frame shape, durable-before-dispatch recording,
default-open DMs, DM reply mode override, DM allowlist drops, explicit disabled
channels, logical Slack twin dedupe, duplicate-pending ack behavior for the
HyperClaw relay, subteam/custom mention admission, bot-loop metadata,
thread-history unroll with file-only messages and inherited parent file
filtering, reply metadata, terminal auth retry stop, and no-ack/no-dispatch on
durable accept failure.

Intentionally outside this crate:

- Slack OAuth install, request signature verification, static bot token mode,
  and Slack Events API ingress are owned by `hyperclaw-backend/slack-relay`
  rather than the ACP client plugin. The runtime plugin authenticates to that
  relay with `HYPER_AGENTS_API_KEY`.
- Direct Slack bot-token ownership, reactions, native Block Kit rendering, and
  message_sent hooks require OpenClaw's plugin SDK runtime and Slack client
  scopes. The Rust plugin does not invent a separate Slack bot-token client; it
  builds relay-proxy `chat.postMessage`, `files.getUploadURLExternal`, and
  `files.completeUploadExternal` request shapes and preserves OpenClaw delivery
  metadata where the HyperCLI caller supplies a durable delivery queue id.
- Live Slack thread history fetches require the OpenClaw Slack client path in
  `monitor/message-handler/prepare-thread-context.ts` lines 176-200 and
  368-395. The active HyperCLI relay plugin cannot call Slack Web API directly
  without adding bot-token scope ownership, so it unrolls thread history when
  the relay payload provides `thread_history`/`threadHistory` and preserves the
  full payload in ACP metadata.
- Persistent OpenClaw session stores and channel history windows are owned by
  OpenClaw's plugin SDK runtime. The active HyperCLI transport sends canonical
  ACP `session/prompt` frames and leaves long-lived session persistence to the
  ACP agent/session implementation.
