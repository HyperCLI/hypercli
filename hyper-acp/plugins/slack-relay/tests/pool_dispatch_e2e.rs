//! End-to-end: fake relay (WS + HTTP proxy on one port) + fake NDJSON ACP
//! child against the real plugin dispatch path (`plugin::run`).
//!
//! Drives: relay WS connect → `slack_event` mention → ack → pool spawn →
//! `initialize` → `session/new` → `session/prompt` → two `agent_message_chunk`
//! updates → `end_turn` → `chat.postMessage` POST containing the reply.

use std::io::Write as _;
use std::path::PathBuf;
use std::time::Duration;

use clap::Parser;
use futures_util::{SinkExt, StreamExt};
use hyper_acp_slack_relay::config::{CliArgs, Config};
use hyper_acp_slack_relay::monitor::provider::{ActiveSlackRelayConfig, ActiveSlackRelayPolicy};
use hyper_acp_slack_relay::monitor::relay_source::SlackRelaySourceConfig;
use hyper_acp_slack_relay::plugin;
use serde_json::json;
use tokio::io::{AsyncBufReadExt as _, AsyncReadExt as _, AsyncWriteExt as _, BufReader};
use tokio::net::TcpListener;
use tokio::sync::mpsc;
use tokio_util::sync::CancellationToken;

const FAKE_AGENT_SCRIPT: &str = r#"
import sys, json

for line in sys.stdin:
    line = line.strip()
    if not line:
        continue
    try:
        req = json.loads(line)
    except Exception:
        continue
    method = req.get("method")
    rid = req.get("id")
    if method is None or rid is None:
        continue
    if method == "initialize":
        resp = {"jsonrpc": "2.0", "id": rid, "result": {
            "protocolVersion": 1,
            "agentCapabilities": {},
            "agentInfo": {"name": "fake-agent", "version": "0.0.0"},
        }}
    elif method == "session/new":
        resp = {"jsonrpc": "2.0", "id": rid, "result": {"sessionId": "fake-session-1"}}
    elif method == "session/prompt":
        sid = req["params"]["sessionId"]
        for text in ("fake-agent-reply-A", "fake-agent-reply-B"):
            print(json.dumps({"jsonrpc": "2.0", "method": "session/update", "params": {
                "sessionId": sid,
                "update": {"sessionUpdate": "agent_message_chunk",
                           "content": {"type": "text", "text": text}},
            }}), flush=True)
        resp = {"jsonrpc": "2.0", "id": rid, "result": {"stopReason": "end_turn"}}
    else:
        resp = {"jsonrpc": "2.0", "id": rid,
                "error": {"code": -32601, "message": "not implemented"}}
    print(json.dumps(resp), flush=True)
"#;

/// Facts observed by the fake relay server.
#[derive(Debug)]
enum RelayObservation {
    /// WS connected and was sent the `slack_event`; carries whether an ack frame
    /// arrived back.
    WsAck(#[allow(dead_code)] serde_json::Value),
    /// A `chat.postMessage` proxy POST body.
    ChatPost(serde_json::Value),
    /// Any other HTTP proxy POST (status updates etc.), method name included.
    OtherPost(#[allow(dead_code)] String),
}

fn fixture_dir(name: &str) -> PathBuf {
    let dir = std::env::temp_dir().join(format!("slack-plugin-e2e-{name}-{}", std::process::id()));
    std::fs::create_dir_all(&dir).expect("fixture dir");
    dir
}

/// Start the fake relay: one TCP listener, WS upgrade requests become a slack
/// event feed, HTTP POSTs are acknowledged (captured for assertions).
async fn start_fake_relay() -> (
    u16,
    tokio::task::JoinHandle<()>,
    mpsc::UnboundedReceiver<RelayObservation>,
) {
    let listener = TcpListener::bind("127.0.0.1:0")
        .await
        .expect("bind fake relay");
    let port = listener.local_addr().expect("local addr").port();
    let (observed_tx, observed_rx) = mpsc::unbounded_channel();

    let task = tokio::spawn(async move {
        loop {
            let Ok((stream, _)) = listener.accept().await else {
                break;
            };
            let observed_tx = observed_tx.clone();
            tokio::spawn(async move {
                let _ignored = handle_connection(stream, observed_tx).await;
            });
        }
    });
    (port, task, observed_rx)
}

#[allow(clippy::too_many_lines)]
async fn handle_connection(
    stream: tokio::net::TcpStream,
    observed: mpsc::UnboundedSender<RelayObservation>,
) -> Result<(), Box<dyn std::error::Error + Send + Sync>> {
    let mut reader = BufReader::new(stream);
    let mut request_line = String::new();
    reader.read_line(&mut request_line).await?;
    let mut headers = Vec::new();
    loop {
        let mut line = String::new();
        reader.read_line(&mut line).await?;
        let trimmed = line.trim();
        if trimmed.is_empty() {
            break;
        }
        headers.push(trimmed.to_owned());
    }
    let is_ws = request_line.starts_with("GET");
    if is_ws {
        // Hand-complete the upgrade, then adopt the raw stream as a websocket.
        let key = headers
            .iter()
            .find_map(|line| {
                let (name, value) = line.split_once(':')?;
                name.trim()
                    .eq_ignore_ascii_case("sec-websocket-key")
                    .then(|| value.trim().to_owned())
            })
            .expect("upgrade request carries a key");
        let accept = tokio_tungstenite::tungstenite::handshake::derive_accept_key(key.as_bytes());
        let stream = reader.get_mut();
        stream
            .write_all(
                format!(
                    "HTTP/1.1 101 Switching Protocols\r\nUpgrade: websocket\r\nConnection: Upgrade\r\nSec-WebSocket-Accept: {accept}\r\n\r\n"
                )
                .as_bytes(),
            )
            .await?;
        stream.flush().await?;
        let stream = reader.into_inner();
        let mut ws = tokio_tungstenite::WebSocketStream::from_raw_socket(
            stream,
            tokio_tungstenite::tungstenite::protocol::Role::Server,
            None,
        )
        .await;
        let frame = json!({
            "type": "slack_event",
            "delivery_id": "e2e-delivery-1",
            "route": {"kind": "channel_default", "key": "agent:test"},
            "payload": {
                "team_id": "T1",
                "event": {
                    "type": "message",
                    "channel": "C1",
                    "user": "U1",
                    "text": "<@UBOT> hello",
                    "ts": "105.000",
                    "thread_ts": "100.000",
                },
            },
        });
        ws.send(tokio_tungstenite::tungstenite::Message::Text(
            frame.to_string().into(),
        ))
        .await?;
        // Expect an ack frame back, then keep the socket until close.
        while let Some(message) = ws.next().await {
            match message {
                Ok(tokio_tungstenite::tungstenite::Message::Text(text)) => {
                    if let Ok(value) = serde_json::from_str::<serde_json::Value>(&text) {
                        if value.get("type").and_then(serde_json::Value::as_str) == Some("ack") {
                            let _ignored = observed.send(RelayObservation::WsAck(value));
                        }
                    }
                }
                Ok(tokio_tungstenite::tungstenite::Message::Ping(bytes)) => {
                    ws.send(tokio_tungstenite::tungstenite::Message::Pong(bytes))
                        .await?;
                }
                Ok(tokio_tungstenite::tungstenite::Message::Close(_)) | Err(_) => break,
                Ok(_) => {}
            }
        }
        return Ok(());
    }

    // HTTP path: read body per Content-Length, acknowledge JSON {ok:true}.
    let content_length = headers
        .iter()
        .find_map(|line| {
            let (name, value) = line.split_once(':')?;
            name.trim()
                .eq_ignore_ascii_case("content-length")
                .then(|| value.trim().parse::<usize>().ok())?
        })
        .unwrap_or(0);
    let mut body = vec![0u8; content_length];
    reader.read_exact(&mut body).await?;
    let body: serde_json::Value = serde_json::from_slice(&body).unwrap_or(json!({}));
    if request_line.contains("chat.postMessage") {
        let _ignored = observed.send(RelayObservation::ChatPost(body));
    } else {
        let method = request_line
            .split_whitespace()
            .nth(1)
            .unwrap_or("")
            .rsplit('/')
            .next()
            .unwrap_or("")
            .to_owned();
        let _ignored = observed.send(RelayObservation::OtherPost(method));
    }
    let response_body = json!({"ok": true, "ts": "1700000000.0001"}).to_string();
    let stream = reader.get_mut();
    stream
        .write_all(
            format!(
                "HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{}",
                response_body.len(),
                response_body
            )
            .as_bytes(),
        )
        .await?;
    stream.flush().await?;
    Ok(())
}

#[tokio::test]
async fn slack_event_flows_to_agent_reply_and_slack_post() {
    if std::process::Command::new("python3")
        .arg("--version")
        .output()
        .is_err()
    {
        eprintln!("skipping e2e: python3 unavailable");
        return;
    }

    tokio::time::timeout(Duration::from_secs(25), async {
        let fixtures = fixture_dir("run");
        let script = fixtures.join("fake_agent.py");
        let mut file = std::fs::File::create(&script).expect("script file");
        file.write_all(FAKE_AGENT_SCRIPT.as_bytes())
            .expect("script write");

        let (port, server_task, mut observed) = start_fake_relay().await;

        let cli = CliArgs::try_parse_from([
            "slack-acp",
            "--agent-command",
            "python3",
            "--agent-args",
            script.to_str().expect("utf8 path"),
            "--idle-timeout",
            "5",
        ])
        .expect("args parse");
        let config = Config::from_args(cli).expect("config validates");
        let relay = ActiveSlackRelayConfig {
            relay: SlackRelaySourceConfig {
                url: format!("http://127.0.0.1:{port}/slack/ws"),
                auth_token: "test-key".to_owned(),
                gateway_id: "agent:test".to_owned(),
            },
            session_id: "agent:test".to_owned(),
            policy: ActiveSlackRelayPolicy {
                relay_api_base_url: Some(format!("http://127.0.0.1:{port}")),
                ..ActiveSlackRelayPolicy::default()
            },
            durable_log_path: Some(fixtures.join("durable.jsonl")),
        };

        let cancel = CancellationToken::new();
        // The run future needs 'static: own a token clone inside the task.
        let run_token = cancel.clone();
        let plugin_task =
            tokio::spawn(async move { plugin::run(config, Some(relay), &run_token).await });

        let mut saw_ack = false;
        let mut posted_reply = String::new();
        while !saw_ack || posted_reply.is_empty() {
            let Some(observation) = tokio::time::timeout(Duration::from_secs(20), observed.recv())
                .await
                .expect("relay observation within timeout")
            else {
                break;
            };
            match observation {
                RelayObservation::WsAck(_) => saw_ack = true,
                RelayObservation::ChatPost(body) => {
                    let text = body
                        .get("text")
                        .and_then(serde_json::Value::as_str)
                        .unwrap_or("");
                    if text.contains("fake-agent-reply") {
                        posted_reply = text.to_owned();
                    }
                }
                RelayObservation::OtherPost(_) => {}
            }
        }
        cancel.cancel();
        let result = tokio::time::timeout(Duration::from_secs(5), plugin_task)
            .await
            .expect("plugin shutdown within timeout")
            .expect("plugin task join");
        server_task.abort();

        assert!(saw_ack, "relay ack observed");
        assert!(
            posted_reply.contains("fake-agent-reply-A")
                && posted_reply.contains("fake-agent-reply-B"),
            "both chunks delivered: {posted_reply:?}"
        );
        result.expect("plugin run clean");
    })
    .await
    .expect("e2e within 25s budget");
}
