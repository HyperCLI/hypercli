//! Slack assistant event classification.
//!
//! Provenance: `openclaw-git/extensions/slack/src/monitor/events/assistant.ts`.

use serde_json::Value;

/// Returns true for Slack assistant event payloads.
#[must_use]
pub fn is_assistant_event(event: &Value) -> bool {
    event
        .get("type")
        .and_then(Value::as_str)
        .is_some_and(|kind| kind.starts_with("assistant_"))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn detects_assistant_event_family() {
        assert!(super::is_assistant_event(
            &json!({"type":"assistant_thread_context_changed"})
        ));
    }
}
