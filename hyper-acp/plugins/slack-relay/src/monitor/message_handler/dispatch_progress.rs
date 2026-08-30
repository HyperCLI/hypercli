//! Slack assistant progress/status mapping during ACP dispatch.
//!
//! Provenance:
//! - `openclaw-git/extensions/slack/src/monitor/message-handler/dispatch-progress.ts`
//!   for status updates while work is in flight.
//! - `openclaw-git/extensions/slack/src/monitor/message-handler/dispatch-progress-render.ts`
//!   for reducing detailed runtime updates into short Slack-visible states.
//! - HyperCLI deviation: ACP update variants are observed as JSON-RPC
//!   `session/update` payloads rather than OpenClaw runtime events.

use serde_json::Value;

/// Extracts the ACP session update discriminator.
#[must_use]
pub fn session_update_kind(update: &Value) -> Option<&str> {
    update
        .get("sessionUpdate")
        .or_else(|| update.get("session_update"))
        .and_then(Value::as_str)
}

/// Maps tool/plan/config updates to short Slack assistant status text.
#[must_use]
pub fn status_text_for_update(update: &Value) -> &'static str {
    match session_update_kind(update) {
        Some("tool_call" | "toolCall") => "Working with tools",
        Some("tool_call_update" | "toolCallUpdate") => "Updating tool result",
        Some("plan" | "plan_update" | "planUpdate") => "Planning",
        Some("current_mode_update" | "currentModeUpdate") => "Switching mode",
        Some("notice") => "Notice",
        _ => "Working",
    }
}

/// Maps state-like ACP updates to short Slack assistant status text.
#[must_use]
pub fn status_text_for_state_update(update: &Value) -> &'static str {
    let state = update.get("state").or_else(|| update.get("status"));
    match state.and_then(Value::as_str) {
        Some("idle") => "Idle",
        _ => "Working",
    }
}
