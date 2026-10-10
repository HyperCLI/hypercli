# Rust SDK session surfaces

All product ACP clients use vanilla v1. Platform session history and receipts
are separate REST reads, not a second prompt-completion protocol.

| Surface | Rust behavior |
| --- | --- |
| Initialize | Selects ACP v1; no v2 adapter |
| Prompt | Preserves original blocks and waits for the native terminal response |
| Cancel | Sends a notification; does not manufacture completion or resend input |
| New session | Explicit cwd or the platform runtime-path lookup |
| Resume | Exact session identity, with explicit or retained/catalog cwd |
| Native history | Explicit full `session/load`; never an attachment fallback |
| Errors | Preserves peer code, message and opaque optional data |
| Notifications | Independent raw update receiver |
| Platform history | Typed messages, separate platform `message_id`, opaque REST cursors |
| Platform metadata | Catalog, detail, participants, receipts, import/discovery evidence |
| Search | Transcript search and around-message windows |

Rust remains a caller-owned one-shot transport. An interrupted attempted prompt
is uncertain; reconnecting does not resend it. The SDK does not infer completion
from receipts, session state or another caller's result.

Sibling SDKs have additional convenience surfaces. Rust currently defaults
permission callbacks to cancellation and has no configurable permission handler.
Typed model/config/provider conveniences remain limited; raw standard RPC access
is available. The [README](README.md#ACP-and-platform-sessions) describes usage.
