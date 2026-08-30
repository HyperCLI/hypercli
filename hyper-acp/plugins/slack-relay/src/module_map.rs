//! Tests for the OpenClaw-shaped public module map.

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn openclaw_shaped_modules_expose_core_helpers() {
        let normalized = crate::monitor::message_handler::prepare::normalize_slack_event(
            &json!({"type":"app_mention","channel":"C1","text":"hello"}),
            Some("T1"),
        )
        .unwrap();
        assert_eq!(
            normalized.source,
            crate::monitor::message_handler::types::SlackEventSource::AppMention
        );

        let message =
            crate::monitor::message_handler::prepare_content::slack_message_for_content_from_value(
                &json!({"type":"message","channel":"C1","text":"hello","ts":"1.1"}),
            )
            .unwrap();
        let content =
            crate::monitor::message_handler::prepare_content::resolve_slack_message_content(
                &message,
                false,
                &[],
                &std::collections::HashMap::new(),
            )
            .unwrap();
        assert!(content.body_with_metadata.contains("hello"));

        assert_eq!(
            crate::monitor::message_handler::timestamp::slack_ts_to_epoch_ms(Some("1.001")),
            Some(1001)
        );

        let post = crate::send::build_slack_post_message_proxy_request(
            "https://relay.example",
            "key",
            "C1",
            "hello",
            None,
        );
        assert_eq!(post.url, "https://relay.example/slack/api/chat.postMessage");

        assert_eq!(
            crate::monitor::reconnect_policy::SLACK_SOCKET_RECONNECT_POLICY.initial_ms,
            2_000
        );
        assert_eq!(crate::monitor::media::MAX_SLACK_MEDIA_FILES, 8);
        let _store = crate::monitor::ingress::MemorySlackRelayStore::default();
    }
}
