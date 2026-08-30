//! Slack app home event classification.
//!
//! Provenance: `openclaw-git/extensions/slack/src/monitor/events/home.ts`.

use serde_json::Value;

/// Returns true for app home opened events handled by OpenClaw.
#[must_use]
pub fn is_app_home_opened(event: &Value) -> bool {
    event.get("type").and_then(Value::as_str) == Some("app_home_opened")
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn detects_app_home_opened() {
        assert!(super::is_app_home_opened(
            &json!({"type":"app_home_opened","user":"U1"})
        ));
    }
}
