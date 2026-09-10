//! In-process MCP bridge: the plugin's half of the `buzz` MCP server.
//!
//! Each ACP session gets a `buzz` MCP server injected via
//! `session/new mcpServers` whose command re-execs this harness binary in
//! shim mode (`mcp_shim.rs`). The shim is a byte pipe; this bridge, running
//! inside the plugin process, implements the MCP protocol and does the real
//! work: binding each connection to its session's channel via a per-session
//! capability token, then validating, signing, and relaying publishes
//! (`publish.rs`). The agent process and the shim only ever see a loopback
//! address and that token — never `BUZZ_PRIVATE_KEY`.
//!
//! Transport: newline-delimited JSON-RPC over a `127.0.0.1` TCP listener.
//! MCP stdio framing is newline-delimited JSON-RPC, so the shim's raw byte
//! copy lands protocol-complete frames here. One authenticated connection
//! per session MCP server process.

use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::{Arc, Mutex};

use futures_util::StreamExt;
use serde_json::{json, Value};
use tokio::io::AsyncWriteExt;
use tokio::net::{TcpListener, TcpStream};
use tokio_util::codec::{FramedRead, LinesCodec};
use uuid::Uuid;

use crate::acp::{EnvVar, McpServer};
use crate::mcp_shim;
use crate::publish::{self, PublisherHandle};
use crate::relay::RelayEventPublisher;

/// Max MCP frame size accepted from a shim. Covers maximum-size publish
/// contents with generous headroom.
const MAX_FRAME_BYTES: usize = 256 * 1024;

/// Name of the MCP server as injected into `session/new` and of the single
/// tool it exposes.
const SERVER_NAME: &str = "buzz";
const PUBLISH_TOOL: &str = "publish";

/// The `buzz` MCP server as advertised by `tools/list`.
fn publish_tool_definition() -> Value {
    json!({
        "name": PUBLISH_TOOL,
        "description": "Publish a message to this session's Buzz channel. \
            The harness blind-signs and relays it as you — you hold no keys. \
            Use reply_to (64-char hex event id) to keep the reply threaded; \
            omit it for a channel-root post. Pass notify recipients as hex or \
            npub strings in mentions.",
        "inputSchema": {
            "type": "object",
            "properties": {
                "content": {
                    "type": "string",
                    "description": "Message body (GitHub-flavored Markdown).",
                },
                "reply_to": {
                    "type": "string",
                    "description": "Optional 64-char hex event id to reply to.",
                },
                "mentions": {
                    "type": "array",
                    "items": {"type": "string"},
                    "description": "Optional hex or npub pubkeys to notify.",
                },
            },
            "required": ["content"],
            "additionalProperties": false,
        },
    })
}

/// Plugin-side MCP bridge handle. Lives in `PromptContext`; the accept task
/// runs for the process lifetime and is aborted on drop (tests).
pub(crate) struct McpBridge {
    addr: SocketAddr,
    registry: Arc<Mutex<HashMap<String, Uuid>>>,
    accept_task: tokio::task::JoinHandle<()>,
}

impl Drop for McpBridge {
    fn drop(&mut self) {
        self.accept_task.abort();
    }
}

impl McpBridge {
    /// Bind the loopback listener and spawn the accept loop.
    ///
    /// `handle` supplies the signing keys and relay publisher used for every
    /// authenticated publish; neither ever leaves this process.
    pub(crate) async fn start(
        keys: nostr::Keys,
        publisher: RelayEventPublisher,
    ) -> std::io::Result<Self> {
        let listener = TcpListener::bind(("127.0.0.1", 0)).await?;
        let addr = listener.local_addr()?;
        let registry: Arc<Mutex<HashMap<String, Uuid>>> = Arc::new(Mutex::new(HashMap::new()));
        let handle = PublisherHandle { keys, publisher };
        let accept_registry = Arc::clone(&registry);
        let accept_task = tokio::spawn(async move {
            loop {
                match listener.accept().await {
                    Ok((stream, _)) => {
                        tokio::spawn(serve_connection(
                            stream,
                            Arc::clone(&accept_registry),
                            handle.clone(),
                        ));
                    }
                    Err(e) => {
                        tracing::warn!("mcp_bridge: accept failed: {e}");
                        tokio::time::sleep(std::time::Duration::from_millis(100)).await;
                    }
                }
            }
        });
        Ok(Self {
            addr,
            registry,
            accept_task,
        })
    }

    /// Register a fresh per-session token and build the `buzz` MCP server
    /// entry for `session/new`. Returns `None` when this binary cannot be
    /// re-executed (no `current_exe`), in which case the session proceeds
    /// without the publish tool.
    pub(crate) fn session_mcp_server(&self, channel_id: Uuid) -> Option<McpServer> {
        let command = match std::env::current_exe() {
            Ok(exe) => exe.to_string_lossy().into_owned(),
            Err(e) => {
                tracing::warn!("mcp_bridge: current_exe unavailable ({e}); publish tool disabled");
                return None;
            }
        };
        // 256 bits of unguessability: two v4 UUIDs. The token maps to exactly
        // one channel and nothing else.
        let token = format!("{}{}", Uuid::new_v4().simple(), Uuid::new_v4().simple());
        self.registry
            .lock()
            .expect("registry poisoned")
            .insert(token.clone(), channel_id);
        Some(McpServer {
            name: SERVER_NAME.to_string(),
            command,
            args: mcp_shim::shim_command_args(),
            env: vec![
                EnvVar {
                    name: mcp_shim::ENV_ADDR.to_string(),
                    value: self.addr.to_string(),
                },
                EnvVar {
                    name: mcp_shim::ENV_TOKEN.to_string(),
                    value: token,
                },
            ],
        })
    }
}

/// Serve one shim connection: authenticate, then answer MCP frames until EOF.
async fn serve_connection(
    stream: TcpStream,
    registry: Arc<Mutex<HashMap<String, Uuid>>>,
    handle: PublisherHandle,
) {
    let (reader, mut writer) = stream.into_split();
    let mut frames = FramedRead::new(reader, LinesCodec::new_with_max_length(MAX_FRAME_BYTES));

    // First frame must be the auth handshake.
    let channel_id: Uuid = match next_frame(&mut frames).await {
        Some(line) => match authenticate(&line, &registry) {
            Some(channel_id) => {
                if write_line(&mut writer, &json!({"ok": true})).await.is_err() {
                    return;
                }
                channel_id
            }
            None => {
                let _ = write_line(&mut writer, &json!({"ok": false})).await;
                return;
            }
        },
        None => return,
    };

    while let Some(line) = next_frame(&mut frames).await {
        let msg: Value = match serde_json::from_str(&line) {
            Ok(v) => v,
            Err(e) => {
                tracing::debug!("mcp_bridge: dropping unparseable frame: {e}");
                continue;
            }
        };
        let Some(method) = msg.get("method").and_then(Value::as_str) else {
            continue;
        };
        // Notifications carry no id and get no response (MCP stdio semantics).
        let Some(id) = msg.get("id").cloned() else {
            continue;
        };
        let response = match method {
            "initialize" => {
                let protocol_version = msg
                    .pointer("/params/protocolVersion")
                    .and_then(Value::as_str)
                    .unwrap_or("2024-11-05");
                json!({
                    "jsonrpc": "2.0",
                    "id": id,
                    "result": {
                        "protocolVersion": protocol_version,
                        "capabilities": {"tools": {"listChanged": false}},
                        "serverInfo": {
                            "name": SERVER_NAME,
                            "version": env!("CARGO_PKG_VERSION"),
                        },
                    },
                })
            }
            "ping" => json!({"jsonrpc": "2.0", "id": id, "result": {}}),
            "tools/list" => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {"tools": [publish_tool_definition()]},
            }),
            "tools/call" => handle_tools_call(&handle, id, &msg["params"], channel_id).await,
            other => json!({
                "jsonrpc": "2.0",
                "id": id,
                "error": {"code": -32601, "message": format!("method not found: {other}")},
            }),
        };
        if write_line(&mut writer, &response).await.is_err() {
            return;
        }
    }
}

/// Read the next complete frame; EOF and codec failures both end the session.
async fn next_frame(
    frames: &mut FramedRead<tokio::net::tcp::OwnedReadHalf, LinesCodec>,
) -> Option<String> {
    match frames.next().await {
        Some(Ok(line)) => Some(line),
        _ => None,
    }
}

/// Write one NDJSON frame.
async fn write_line(
    writer: &mut tokio::net::tcp::OwnedWriteHalf,
    value: &Value,
) -> std::io::Result<()> {
    writer.write_all(value.to_string().as_bytes()).await?;
    writer.write_all(b"\n").await?;
    writer.flush().await
}

/// Validate the auth frame and resolve its token to the bound channel.
fn authenticate(line: &str, registry: &Arc<Mutex<HashMap<String, Uuid>>>) -> Option<Uuid> {
    let frame = serde_json::from_str::<Value>(line).ok()?;
    let token = frame.get("buzzMcpAuth")?.as_str()?;
    registry
        .lock()
        .expect("registry poisoned")
        .get(token)
        .copied()
}

/// Implement `tools/call`. Handler errors become an MCP `isError` result —
/// the model gets a readable tool failure, not a dropped transport.
async fn handle_tools_call(
    handle: &PublisherHandle,
    id: Value,
    params: &Value,
    channel_id: Uuid,
) -> Value {
    let tool_error = |id: Value, message: String| {
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": {
                "content": [{"type": "text", "text": message}],
                "isError": true,
            },
        })
    };

    if params.get("name").and_then(Value::as_str) != Some(PUBLISH_TOOL) {
        return json!({
            "jsonrpc": "2.0",
            "id": id,
            "error": {"code": -32602, "message": format!(
                "unknown tool: {}",
                params.get("name").and_then(Value::as_str).unwrap_or("<absent>")
            )},
        });
    }

    let args = params
        .get("arguments")
        .cloned()
        .unwrap_or_else(|| json!({}));
    match publish::parse_params(&args).map_err(|e| e.to_string()) {
        Err(message) => tool_error(id, message),
        Ok(parsed) => match publish::publish(handle, &parsed, channel_id).await {
            Err(e) => tool_error(id, e.to_string()),
            Ok(outcome) => json!({
                "jsonrpc": "2.0",
                "id": id,
                "result": {
                    "content": [{"type": "text", "text": outcome.to_string()}],
                    "structuredContent": outcome,
                    "isError": false,
                },
            }),
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use tokio::io::{AsyncBufReadExt, BufReader};

    /// Start a bridge backed by the fake relay and return
    /// `(bridge, published-events receiver)`.
    async fn test_bridge() -> (McpBridge, tokio::sync::mpsc::Receiver<nostr::Event>) {
        let (publisher, rx) = RelayEventPublisher::test_pair();
        let bridge = McpBridge::start(nostr::Keys::generate(), publisher)
            .await
            .expect("bridge binds");
        (bridge, rx)
    }

    /// Connect, authenticate, and return buffered halves for frame I/O.
    async fn authed_conn(
        bridge: &McpBridge,
        channel_id: Uuid,
    ) -> (
        BufReader<tokio::net::tcp::OwnedReadHalf>,
        tokio::net::tcp::OwnedWriteHalf,
    ) {
        let server = bridge.session_mcp_server(channel_id).expect("server entry");
        let token = server
            .env
            .iter()
            .find(|e| e.name == mcp_shim::ENV_TOKEN)
            .expect("token env")
            .value
            .clone();
        let stream = TcpStream::connect(bridge.addr).await.unwrap();
        let (reader, mut writer) = stream.into_split();
        writer
            .write_all(format!("{{\"buzzMcpAuth\":\"{token}\"}}\n").as_bytes())
            .await
            .unwrap();
        let mut reader = BufReader::new(reader);
        let mut ack = String::new();
        reader.read_line(&mut ack).await.unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&ack).unwrap()["ok"],
            json!(true)
        );
        (reader, writer)
    }

    async fn rpc(
        reader: &mut BufReader<tokio::net::tcp::OwnedReadHalf>,
        writer: &mut tokio::net::tcp::OwnedWriteHalf,
        frame: Value,
    ) -> Value {
        writer
            .write_all(format!("{}\n", frame).as_bytes())
            .await
            .unwrap();
        let mut line = String::new();
        reader.read_line(&mut line).await.unwrap();
        serde_json::from_str(&line).unwrap()
    }

    #[tokio::test]
    async fn bad_token_is_rejected_and_closed() {
        let (bridge, _rx) = test_bridge().await;
        let stream = TcpStream::connect(bridge.addr).await.unwrap();
        let (reader, mut writer) = stream.into_split();
        writer
            .write_all(b"{\"buzzMcpAuth\":\"bogus\"}\n")
            .await
            .unwrap();
        let mut reader = BufReader::new(reader);
        let mut ack = String::new();
        reader.read_line(&mut ack).await.unwrap();
        assert_eq!(
            serde_json::from_str::<Value>(&ack).unwrap()["ok"],
            json!(false)
        );
        // Connection is closed after rejection.
        let mut buf = String::new();
        let n = reader.read_line(&mut buf).await.unwrap();
        assert_eq!(n, 0, "bridge must close the socket after auth failure");
    }

    #[tokio::test]
    async fn initialize_and_tools_list_advertise_publish() {
        let (bridge, _rx) = test_bridge().await;
        let (mut reader, mut writer) = authed_conn(&bridge, Uuid::new_v4()).await;

        let init = rpc(
            &mut reader,
            &mut writer,
            json!({"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2025-03-26","capabilities":{},"clientInfo":{"name":"test","version":"0"}}}),
        )
        .await;
        assert_eq!(
            init["result"]["protocolVersion"],
            json!("2025-03-26"),
            "bridge echoes the client's protocol version"
        );
        assert_eq!(init["result"]["serverInfo"]["name"], json!("buzz"));

        let list = rpc(
            &mut reader,
            &mut writer,
            json!({"jsonrpc":"2.0","id":2,"method":"tools/list"}),
        )
        .await;
        let tools = list["result"]["tools"].as_array().unwrap();
        assert_eq!(tools.len(), 1);
        assert_eq!(tools[0]["name"], json!("publish"));
        assert_eq!(tools[0]["inputSchema"]["required"], json!(["content"]));
    }

    #[tokio::test]
    async fn publish_tool_signs_and_relays() {
        let (bridge, mut published) = test_bridge().await;
        let channel = Uuid::new_v4();
        let (mut reader, mut writer) = authed_conn(&bridge, channel).await;

        let reply = "c".repeat(64);
        let resp = rpc(
            &mut reader,
            &mut writer,
            json!({
                "jsonrpc": "2.0",
                "id": 3,
                "method": "tools/call",
                "params": {
                    "name": "publish",
                    "arguments": {"content": "done", "reply_to": reply},
                },
            }),
        )
        .await;
        assert_eq!(resp["result"]["isError"], json!(false));
        let outcome: Value =
            serde_json::from_str(resp["result"]["content"][0]["text"].as_str().unwrap()).unwrap();
        assert_eq!(outcome["channelId"], json!(channel.to_string()));

        let event = published.recv().await.expect("event relayed");
        assert_eq!(event.content, "done");
        assert_eq!(event.id.to_hex(), outcome["eventId"].as_str().unwrap());
        event.verify().unwrap();
    }

    #[tokio::test]
    async fn publish_tool_reports_validation_errors_as_tool_errors() {
        let (bridge, mut published) = test_bridge().await;
        let (mut reader, mut writer) = authed_conn(&bridge, Uuid::new_v4()).await;

        let resp = rpc(
            &mut reader,
            &mut writer,
            json!({
                "jsonrpc": "2.0",
                "id": 4,
                "method": "tools/call",
                "params": {"name": "publish", "arguments": {"content": ""}},
            }),
        )
        .await;
        assert_eq!(resp["result"]["isError"], json!(true));
        assert!(resp["result"]["content"][0]["text"]
            .as_str()
            .unwrap()
            .contains("invalid params"));
        tokio::time::timeout(std::time::Duration::from_millis(100), published.recv())
            .await
            .expect_err("invalid publish must not reach the relay");
    }

    #[tokio::test]
    async fn unknown_tool_and_unknown_method_get_jsonrpc_errors() {
        let (bridge, _rx) = test_bridge().await;
        let (mut reader, mut writer) = authed_conn(&bridge, Uuid::new_v4()).await;

        let resp = rpc(
            &mut reader,
            &mut writer,
            json!({"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"nope"}}),
        )
        .await;
        assert_eq!(resp["error"]["code"], json!(-32602));

        let resp = rpc(
            &mut reader,
            &mut writer,
            json!({"jsonrpc":"2.0","id":6,"method":"resources/list"}),
        )
        .await;
        assert_eq!(resp["error"]["code"], json!(-32601));
    }

    #[tokio::test]
    async fn notifications_get_no_response() {
        let (bridge, _rx) = test_bridge().await;
        let (mut reader, mut writer) = authed_conn(&bridge, Uuid::new_v4()).await;
        writer
            .write_all(b"{\"jsonrpc\":\"2.0\",\"method\":\"notifications/initialized\"}\n")
            .await
            .unwrap();
        // A following request must get the FIRST response — proving the
        // notification produced none.
        let resp = rpc(
            &mut reader,
            &mut writer,
            json!({"jsonrpc":"2.0","id":7,"method":"ping"}),
        )
        .await;
        assert_eq!(resp["id"], json!(7));
    }
}
