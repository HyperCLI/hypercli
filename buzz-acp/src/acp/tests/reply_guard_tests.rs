use super::*;

async fn spawn_script(script: &str) -> AcpClient {
    AcpClient::spawn("bash", &["-c".into(), script.into()], &[], false)
        .await
        .expect("failed to spawn test script")
}

#[test]
fn recognizes_direct_and_codex_mcp_command_shapes() {
    for update in [
        serde_json::json!({
            "sessionUpdate": "tool_call",
            "rawInput": {"command": "buzz messages send --channel abc --text hello"}
        }),
        serde_json::json!({
            "sessionUpdate": "tool_call_update",
            "rawInput": {
                "server": "buzz-dev",
                "tool": "shell",
                "arguments": {"command": "buzz reactions add event-id 👍"}
            }
        }),
    ] {
        assert!(update_is_buzz_publish_attempt(&update));
    }

    assert!(!update_is_buzz_publish_attempt(&serde_json::json!({
        "sessionUpdate": "tool_call",
        "rawInput": {"command": "unrelated-placeholder"}
    })));
    assert!(!update_is_buzz_publish_attempt(&serde_json::json!({
        "sessionUpdate": "agent_message_chunk",
        "content": {"text": "buzz messages send"}
    })));
}

#[tokio::test]
async fn reprompts_same_session_until_publish_attempt() {
    let script = r#"
        read -t 2 FIRST
        echo '{"jsonrpc":"2.0","id":0,"result":{"stopReason":"end_turn"}}'
        read -t 2 SECOND
        case "$SECOND" in *"about to end this turn without calling"*) ;; *) exit 2 ;; esac
        echo '{"jsonrpc":"2.0","id":1,"result":{"stopReason":"end_turn"}}'
        read -t 2 THIRD
        case "$THIRD" in *"about to end this turn without calling"*) ;; *) exit 3 ;; esac
        echo '{"jsonrpc":"2.0","method":"session/update","params":{"update":{"sessionUpdate":"tool_call","toolCallId":"publish-1","rawInput":{"command":"buzz messages send --channel abc --text hello"}}}}'
        echo '{"jsonrpc":"2.0","id":2,"result":{"stopReason":"end_turn"}}'
    "#;
    let mut client = spawn_script(script).await;
    let result = client
        .session_prompt_blocks_with_reply_guard(
            "session-1",
            &["hello"],
            std::time::Duration::from_secs(2),
            std::time::Duration::from_secs(5),
            true,
        )
        .await;
    assert_eq!(result.unwrap(), StopReason::EndTurn);
    assert!(client.reply_publish_attempted);
    assert_eq!(client.next_id, 3, "initial prompt plus two reminders");
}

#[tokio::test]
async fn allows_silence_after_two_reminders() {
    let script = r#"
        read -t 2 FIRST
        echo '{"jsonrpc":"2.0","id":0,"result":{"stopReason":"end_turn"}}'
        read -t 2 SECOND
        echo '{"jsonrpc":"2.0","id":1,"result":{"stopReason":"end_turn"}}'
        read -t 2 THIRD
        echo '{"jsonrpc":"2.0","id":2,"result":{"stopReason":"end_turn"}}'
    "#;
    let mut client = spawn_script(script).await;
    let result = client
        .session_prompt_blocks_with_reply_guard(
            "session-1",
            &["hello"],
            std::time::Duration::from_secs(2),
            std::time::Duration::from_secs(5),
            true,
        )
        .await;
    assert_eq!(result.unwrap(), StopReason::EndTurn);
    assert!(!client.reply_publish_attempted);
    assert_eq!(client.next_id, 3, "guard must stop after two reminders");
}
