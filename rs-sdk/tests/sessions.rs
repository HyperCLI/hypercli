//! Platform HTTP contract tests. Construct/drop the blocking parent transport
//! outside Tokio; session operations themselves use its injected async client.
use hypercli_sdk::{
    ClientConfig, HyperCliClient, SessionListOptions, SessionMessagesOptions, SessionRecord,
    SessionSearchOptions,
};
use mockito::Matcher;
use reqwest::header::{HeaderMap, HeaderValue};
use secrecy::SecretString;
use serde_json::json;
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
        .with_body(
            json!({"items":[{"session_id":"s", "seq":4, "message_id":"platform-tool",
            "role":"tool", "acp":{"type":"session/update", "params":{"update":{
                "sessionUpdate":"tool_call_update", "toolCallId":"native", "content":[]}}}}],
            "has_more":false,"import_outcome":null})
            .to_string(),
        )
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
        let page = sessions
            .get_messages(
                "s",
                &SessionMessagesOptions {
                    cursor: Some("opaque+/=".into()),
                    limit: None,
                },
            )
            .await
            .unwrap();
        assert_eq!(
            page.page.items[0].message_id.as_deref(),
            Some("platform-tool")
        );
        assert_eq!(
            page.page.items[0].acp["params"]["update"]["sessionUpdate"],
            "tool_call_update"
        );
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
