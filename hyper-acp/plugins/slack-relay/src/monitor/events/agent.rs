//! Slack agent event classification.
//!
//! Provenance: `openclaw-git/extensions/slack/src/monitor/events/agent.ts`.

use serde_json::Value;

/// Returns true for Slack agent assistant thread events.
#[must_use]
pub fn is_agent_event(event: &Value) -> bool {
    event
        .get("type")
        .and_then(Value::as_str)
        .is_some_and(|kind| kind == "app_context_changed" || kind.starts_with("agent_"))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn detects_agent_event_family() {
        assert!(super::is_agent_event(
            &json!({"type":"app_context_changed"})
        ));
        assert!(!super::is_agent_event(
            &json!({"type":"assistant_thread_started"})
        ));
    }
}
