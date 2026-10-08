//! Platform HTTP contract tests. Construct/drop the blocking parent transport
//! outside Tokio; session operations themselves use its injected async client.
use std::time::Duration;

use hypercli_sdk::{
    AcpPromptAcceptance, ClientConfig, HyperCliClient, SessionCompletionError, SessionListOptions,
    SessionMessagesOptions, SessionRecord, SessionSearchOptions,
};
use mockito::Matcher;
use reqwest::header::{HeaderMap, HeaderValue};
use secrecy::SecretString;
use serde_json::{json, Value};
use url::Url;

fn client(server: &mockito::ServerGuard) -> HyperCliClient {
    let mut headers = HeaderMap::new();
    headers.insert("x-caller-transport", HeaderValue::from_static("injected"));
    HyperCliClient::with_http_clients(
        ClientConfig {
            api_base: Url::parse(&format!("{}/agents", server.url())).unwrap(),
            api_key: SecretString::from("test-key"),
            trace_file: None,
            timeout: None,
        },
        Url::parse(&server.url()).unwrap(),
        reqwest::blocking::Client::builder()
            .no_proxy()
            .build()
            .unwrap(),
        reqwest::Client::builder()
            .no_proxy()
            .default_headers(headers)
            .build()
            .unwrap(),
    )
    .unwrap()
}

fn input() -> Value {
    json!({"session_id":"s", "seq":4, "role":"user",
        "acp":{"type":"user_message", "messageId":"accepted", "agentId":"agent"},
        "completed_at":"2026-10-08T12:00:00Z"})
}

fn terminal() -> Value {
    json!({"session_id":"s", "seq":8, "role":"assistant",
        "participant_kind":"agent", "participant_id":"agent",
        "acp":{"type":"turn_result", "messageSeq":4},
        "completed_at":"2026-10-08T12:00:00Z", "stop_reason":"end_turn"})
}

#[test]
fn detail_preserves_platform_metadata_and_uses_injected_authenticated_transport() {
    let mut server = mockito::Server::new();
    let detail = server.mock("GET", "/agents/sessions/platform%2Fodd%20id%3F%23%25")
        .match_header("authorization", "Bearer test-key")
        .match_header("x-caller-transport", "injected")
        .with_status(200)
        .with_body(json!({"id":"platform/odd id?#%", "source":"future-source",
            "summary_text":"Title", "summary_keywords":null,
            "participants":[{"kind":"agent","participant_id":"agent","internal_session_id":"native", "cursor_pos":9}],
            "last_message_id":"accepted", "message_count":2, "head_seq":9,
            "agentState":"archived", "receipts":[{"message_id":"accepted", "role":"user", "completed_at":null}]
        }).to_string()).create();
    let client = client(&server);
    let runtime = tokio::runtime::Runtime::new().unwrap();
    let state = runtime
        .block_on(client.sessions().get_session("platform/odd id?#%"))
        .unwrap();
    assert_eq!(state.source.as_deref(), Some("future-source"));
    assert_eq!(state.agent_state.as_deref(), Some("archived"));
    assert_eq!(state.head_seq, Some(9));
    assert_eq!(
        state.participants[0].internal_session_id.as_deref(),
        Some("native")
    );
    assert!(state.summary_keywords.is_empty());
    assert_eq!(state.receipts[0].completed_at, None);
    detail.assert();

    let old: SessionRecord = serde_json::from_value(json!({"id":"old"})).unwrap();
    assert_eq!(old.agent_state, None);
    assert_eq!(old.message_count, None);
    assert!(old.receipts.is_empty());
    let future: SessionRecord =
        serde_json::from_value(json!({"id":"s","agent_state":"future"})).unwrap();
    assert_eq!(future.agent_state.as_deref(), Some("future"));
}

#[test]
fn session_routes_keep_cursors_and_filters_in_rest() {
    let mut server = mockito::Server::new();
    let catalog = server
        .mock("GET", "/agents/sessions")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("agent_id".into(), "a/b".into()),
            Matcher::UrlEncoded("cursor".into(), "opaque+/=".into()),
            Matcher::UrlEncoded("limit".into(), "7".into()),
        ]))
        .with_status(200)
        .with_body(r#"{"items":[],"has_more":false,"next_cursor":null}"#)
        .create();
    let messages = server
        .mock("GET", "/agents/sessions/s/messages")
        .match_query(Matcher::UrlEncoded("cursor".into(), "opaque+/=".into()))
        .with_status(200)
        .with_body(r#"{"items":[],"has_more":false,"import_outcome":null}"#)
        .create();
    let search = server
        .mock("GET", "/agents/sessions/search")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("q".into(), "words & more".into()),
            Matcher::UrlEncoded("session_id".into(), "s".into()),
        ]))
        .with_status(200)
        .with_body(r#"{"items":[],"has_more":false}"#)
        .create();
    let around = server
        .mock("GET", "/agents/sessions/s/messages/around")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("seq".into(), "4".into()),
            Matcher::UrlEncoded("radius".into(), "2".into()),
        ]))
        .with_status(200)
        .with_body(r#"{"session_id":"s","focus_seq":4,"items":[]}"#)
        .create();
    let discovery = server
        .mock("GET", "/agents/sessions/discovery")
        .match_query(Matcher::UrlEncoded("agent_id".into(), "a".into()))
        .with_status(200)
        .with_body(r#"{"status":"unsupported","history_status":"unsupported"}"#)
        .create();
    let request = server
        .mock("POST", "/agents/sessions/discovery")
        .match_query(Matcher::UrlEncoded("agent_id".into(), "a".into()))
        .with_status(200)
        .with_body(r#"{"status":"pending"}"#)
        .create();
    let client = client(&server);
    tokio::runtime::Runtime::new().unwrap().block_on(async {
        let sessions = client.sessions();
        sessions
            .list_sessions(&SessionListOptions {
                agent_id: Some("a/b".into()),
                cursor: Some("opaque+/=".into()),
                limit: Some(7),
            })
            .await
            .unwrap();
        sessions
            .get_messages(
                "s",
                &SessionMessagesOptions {
                    cursor: Some("opaque+/=".into()),
                    limit: None,
                },
            )
            .await
            .unwrap();
        sessions
            .search_transcript(
                "words & more",
                &SessionSearchOptions {
                    session_id: Some("s".into()),
                    ..Default::default()
                },
            )
            .await
            .unwrap();
        assert_eq!(
            sessions
                .get_messages_around("s", 4, Some(2))
                .await
                .unwrap()
                .focus_seq,
            4
        );
        assert_eq!(
            sessions.get_discovery_status("a").await.unwrap().status,
            "unsupported"
        );
        assert_eq!(
            sessions.request_discovery("a").await.unwrap().status,
            "pending"
        );
    });
    for mock in [catalog, messages, search, around, discovery, request] {
        mock.assert();
    }
}

#[test]
fn completion_matches_exact_admission_across_history_pages() {
    let mut server = mockito::Server::new();
    let newest = server
        .mock("GET", "/agents/sessions/s/messages")
        .match_query(Matcher::UrlEncoded("limit".into(), "100".into()))
        .with_status(200)
        .with_body(
            json!({"items":[terminal()], "has_more":true,"next_cursor":"older+/="}).to_string(),
        )
        .create();
    let older = server
        .mock("GET", "/agents/sessions/s/messages")
        .match_query(Matcher::AllOf(vec![
            Matcher::UrlEncoded("limit".into(), "100".into()),
            Matcher::UrlEncoded("cursor".into(), "older+/=".into()),
        ]))
        .with_status(200)
        .with_body(json!({"items":[input()], "has_more":false}).to_string())
        .create();
    let client = client(&server);
    let accepted = AcpPromptAcceptance {
        session_id: "s".into(),
        message_id: "accepted".into(),
        raw: json!({"messageId":"accepted"}),
    };
    let completion = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(client.sessions().wait_prompt_completion(
            &accepted,
            "agent",
            Duration::from_secs(5),
        ))
        .unwrap();
    assert_eq!(completion.message_id, "accepted");
    assert_eq!(completion.stop_reason, "end_turn");
    newest.assert();
    older.assert();
}

#[test]
fn completion_uses_newest_retry_and_rejects_cross_attempt_pages() {
    for same_attempt in [true, false] {
        let mut server = mockito::Server::new();
        let mut newest = terminal();
        newest["seq"] = json!(12);
        newest["completed_at"] = json!("2026-10-08T12:01:00Z");
        let mut older = terminal();
        older["stop_reason"] = json!("cancelled");
        let mut original = input();
        original["completed_at"] = json!(if same_attempt {
            "2026-10-08T12:01:00Z"
        } else {
            "2026-10-08T12:02:00Z"
        });
        let first = server
            .mock("GET", "/agents/sessions/s/messages")
            .match_query(Matcher::UrlEncoded("limit".into(), "100".into()))
            .with_status(200)
            .with_body(json!({"items":[newest],"has_more":true,"next_cursor":"older"}).to_string())
            .create();
        let second = server
            .mock("GET", "/agents/sessions/s/messages")
            .match_query(Matcher::AllOf(vec![
                Matcher::UrlEncoded("limit".into(), "100".into()),
                Matcher::UrlEncoded("cursor".into(), "older".into()),
            ]))
            .with_status(200)
            .with_body(json!({"items":[older,original],"has_more":false}).to_string())
            .create();
        let client = client(&server);
        let result = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(
                client
                    .sessions()
                    .get_prompt_completion("s", "accepted", "agent"),
            )
            .unwrap();
        if same_attempt {
            assert_eq!(result.unwrap().stop_reason, "end_turn");
        } else {
            assert_eq!(result, None);
        }
        first.assert();
        second.assert();
    }
}

#[test]
fn completion_never_uses_foreign_stale_or_missing_evidence() {
    let mut cases = Vec::new();
    for field in [
        "session_id",
        "participant_id",
        "participant_kind",
        "completed_at",
    ] {
        let mut wrong = terminal();
        wrong[field] = json!("other");
        cases.push(vec![wrong, input()]);
    }
    let mut wrong_seq = terminal();
    wrong_seq["acp"]["messageSeq"] = json!(3);
    cases.push(vec![wrong_seq, input()]);
    let mut pending = input();
    pending["completed_at"] = Value::Null;
    cases.push(vec![terminal(), pending]);
    let mut foreign_input = input();
    foreign_input["acp"]["agentId"] = json!("other");
    cases.push(vec![terminal(), foreign_input]);
    let mut neighboring_input = input();
    neighboring_input["acp"]["messageId"] = json!("another-admission");
    cases.push(vec![terminal(), neighboring_input]);
    cases.push(vec![input()]); // A detail-style completion stamp alone is insufficient.
    let mut idle = terminal();
    idle["acp"] = json!({"type":"session/update", "params":{"sessionId":"s",
        "update":{"sessionUpdate":"state_update","state":"idle","stopReason":"end_turn"}}});
    cases.push(vec![idle, input()]); // Idle is not message-level completion evidence.
    let mut retry = terminal();
    retry["seq"] = json!(9);
    retry["completed_at"] = Value::Null;
    cases.push(vec![retry, terminal(), input()]); // Never fall back to an older result.
    for items in cases {
        let mut server = mockito::Server::new();
        let page = server
            .mock("GET", "/agents/sessions/s/messages")
            .match_query(Matcher::Any)
            .with_status(200)
            .with_body(json!({"items":items,"has_more":false}).to_string())
            .create();
        let client = client(&server);
        let result = tokio::runtime::Runtime::new()
            .unwrap()
            .block_on(
                client
                    .sessions()
                    .get_prompt_completion("s", "accepted", "agent"),
            )
            .unwrap();
        assert_eq!(result, None);
        page.assert();
    }
}

#[test]
fn observation_errors_preserve_identity_and_http_status() {
    let mut server = mockito::Server::new();
    let denied = server
        .mock("GET", "/agents/sessions/s/messages")
        .match_query(Matcher::Any)
        .with_status(403)
        .create();
    let client = client(&server);
    let accepted = AcpPromptAcceptance {
        session_id: "s".into(),
        message_id: "accepted".into(),
        raw: json!({"messageId":"accepted"}),
    };
    let error = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(client.sessions().wait_prompt_completion(
            &accepted,
            "agent",
            Duration::from_secs(5),
        ))
        .unwrap_err();
    match error {
        SessionCompletionError::Read {
            session_id,
            message_id,
            source,
        } => {
            assert_eq!(session_id, "s");
            assert_eq!(message_id, "accepted");
            assert_eq!(source.status(), Some(reqwest::StatusCode::FORBIDDEN));
        }
        other => panic!("unexpected: {other:?}"),
    }
    denied.assert();
}

#[test]
fn repeated_history_cursor_is_an_error_not_an_end_or_infinite_loop() {
    let mut server = mockito::Server::new();
    let pages = server
        .mock("GET", "/agents/sessions/s/messages")
        .match_query(Matcher::Any)
        .with_status(200)
        .expect(2)
        .with_body(r#"{"items":[],"has_more":true,"next_cursor":"loop"}"#)
        .create();
    let client = client(&server);
    let error = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(
            client
                .sessions()
                .get_prompt_completion("s", "accepted", "agent"),
        )
        .unwrap_err();
    assert!(error.to_string().contains("repeated a cursor"));
    pages.assert();
}

#[test]
fn observation_timeout_retains_admission_without_claiming_execution_stopped() {
    let mut server = mockito::Server::new();
    let _history = server
        .mock("GET", "/agents/sessions/s/messages")
        .match_query(Matcher::Any)
        .with_status(200)
        .with_body(r#"{"items":[],"has_more":false}"#)
        .create();
    let client = client(&server);
    let accepted = AcpPromptAcceptance {
        session_id: "s".into(),
        message_id: "accepted".into(),
        raw: json!({"messageId":"accepted"}),
    };
    let error = tokio::runtime::Runtime::new()
        .unwrap()
        .block_on(
            client
                .sessions()
                .wait_prompt_completion(&accepted, "agent", Duration::ZERO),
        )
        .unwrap_err();
    match error {
        SessionCompletionError::Timeout {
            session_id,
            message_id,
        } => {
            assert_eq!(session_id, "s");
            assert_eq!(message_id, "accepted");
        }
        other => panic!("unexpected: {other:?}"),
    }
}
