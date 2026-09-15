//! ACP prompt correlation setup for Slack dispatches.
//!
//! Provenance:
//! - `openclaw-git/extensions/slack/src/monitor/message-handler/dispatch-setup.ts`
//!   for per-turn setup responsibilities.
//! - HyperCLI deviation: setup reads Slack correlation metadata from canonical
//!   ACP `_meta["hypercli.slack"]` on `session/prompt` params or prompt blocks.

use serde_json::Value;

/// Reads HyperCLI Slack dispatch metadata from an ACP prompt request.
#[must_use]
pub fn read_hypercli_slack_meta(params: &Value) -> Option<&Value> {
    params
        .get("_meta")
        .and_then(|meta| meta.get("hypercli.slack"))
        .or_else(|| {
            params
                .get("prompt")
                .and_then(Value::as_array)
                .and_then(|blocks| blocks.first())
                .and_then(|block| block.get("_meta"))
                .and_then(|meta| meta.get("hypercli.slack"))
        })
}
