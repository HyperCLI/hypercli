#![allow(missing_docs)]

use futures_util::{SinkExt, StreamExt};
use hyper_acp::transport::Direction;
use hyper_acp::transport::outbound_ws;
use hyper_acp::transport::{AcpFrameObserver, ObservedAcpFrame};
use serde_json::{Value, json};
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Command as StdCommand;
use std::process::Stdio;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;
use tokio::process::Command;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::protocol::Message;

const CLIENT_FRAMES: &[&str] = &[
    r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":2,"clientCapabilities":{}}}"#,
    r#"{"jsonrpc":"2.0","method":"initialized"}"#,
    r#"{"jsonrpc":"2.0","id":2,"method":"session/new","params":{"cwd":"/tmp","mcpServers":[]}}"#,
    r#"{"jsonrpc":"2.0","id":"turn-1","method":"session/prompt","params":{"sessionId":"s1","prompt":[{"type":"text","text":"run pwd"}]}}"#,
    r#"{"jsonrpc":"2.0","method":"$/progress","params":{"token":"turn-1","value":{"kind":"started"}}}"#,
    r#"{"jsonrpc":"2.0","id":"agent-request","result":{"ok":true}}"#,
    r#"{"jsonrpc":"2.0","id":99,"error":{"code":-32601,"message":"unknown method"}}"#,
    r#"[{"jsonrpc":"2.0","id":"mixed-request","method":"session/prompt","params":{"sessionId":"s1","prompt":[{"type":"text","text":"batch"}]}},{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"user_message_chunk","content":{"type":"text","text":"hello"}}}}]"#,
    r#"[{"jsonrpc":"2.0","id":"batch-a","result":{}},{"jsonrpc":"2.0","id":"batch-b","error":{"code":-32000,"message":"denied"}}]"#,
    r#"{"jsonrpc":"2.0","id":"perm-1","result":{"outcome":{"outcome":"selected","optionId":"allow_once"}}}"#,
    r#"{"jsonrpc":"2.0","id":"extension","method":"hypercli.experimental/raw","params":{"value":7}}"#,
];

const AGENT_FRAMES: &[&str] = &[
    r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":2,"agentInfo":{"name":"fake-acp"},"agentCapabilities":{}}}"#,
    r#"{"jsonrpc":"2.0","id":2,"result":{"sessionId":"s1"}}"#,
    r#"{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"tool_call","toolCallId":"tc-1","title":"shell","kind":"shell"}}}"#,
    r#"{"jsonrpc":"2.0","id":"perm-1","method":"session/request_permission","params":{"sessionId":"s1","options":[{"optionId":"allow_once","kind":"allow_once"}]}}"#,
    r#"{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s2","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"agent chunk"}}}}"#,
    r#"{"jsonrpc":"2.0","method":"$/progress","params":{"token":"turn-1","value":{"kind":"completed"}}}"#,
    r#"[{"jsonrpc":"2.0","id":"agent-mixed-request","method":"session/prompt","params":{"sessionId":"s2","prompt":[{"type":"text","text":"agent batch"}]}},{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s2","update":{"sessionUpdate":"tool_call_update","toolCallId":"tc-1","content":{"type":"text","text":"stdout"}}}}]"#,
    r#"[{"jsonrpc":"2.0","id":"agent-batch-a","result":{}},{"jsonrpc":"2.0","id":"agent-batch-b","error":{"code":-32000,"message":"agent denied"}}]"#,
    r#"{"jsonrpc":"2.0","id":"turn-1","result":{"stopReason":"end_turn"}}"#,
    r#"{"jsonrpc":"2.0","id":"agent-extension","method":"hypercli.experimental/raw","params":{"value":8}}"#,
];

#[tokio::test]
async fn outbound_ws_reconnects_and_child_survives_socket_close() {
    let temp = TestTemp::new("outbound-ws-reconnect");
    let child_input_path = temp.path("child-input.jsonl");
    let child_script = write_child_script(temp.path("agent-child.sh"), &child_input_path);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let ws_url = format!("ws://{}/ws", listener.local_addr().unwrap());

    let first_frame = CLIENT_FRAMES[0];
    let second_frame = CLIENT_FRAMES[1];
    let server = tokio::spawn(async move {
        // Era one: send one frame, then close.
        let (stream, _) = listener.accept().await.unwrap();
        let mut socket = accept_async(stream).await.unwrap();
        socket
            .send(Message::Text(first_frame.into()))
            .await
            .unwrap();
        socket.close(None).await.unwrap();
        drop(socket);

        // Era two: the transport must re-dial on its own; the same child must
        // receive the next frame.
        let (stream, _) = listener.accept().await.unwrap();
        let mut socket = accept_async(stream).await.unwrap();
        socket
            .send(Message::Text(second_frame.into()))
            .await
            .unwrap();
        socket.close(None).await.unwrap();
    });

    let mut command = Command::new("sh");
    command.arg(&child_script);
    command.stdin(Stdio::piped()).stdout(Stdio::piped());
    let transport = tokio::spawn(outbound_ws::run(ws_url, command));

    server.await.unwrap();
    // Wait for the reconnected era to deliver the second frame to the child.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    while !read_jsonl(&child_input_path).contains(&second_frame.to_owned()) {
        assert!(
            std::time::Instant::now() < deadline,
            "child never received the post-reconnect frame"
        );
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    let received: Vec<Value> = read_jsonl(&child_input_path)
        .iter()
        .map(|line| parse_json(line))
        .collect();
    assert_eq!(
        received,
        vec![
            rewritten_initialize_frame(first_frame),
            parse_json(second_frame)
        ]
    );
    transport.abort();
}

#[tokio::test]
async fn outbound_ws_replays_cached_initialize_response_on_later_eras() {
    let temp = TestTemp::new("outbound-ws-reinitialize");
    let child_input_path = temp.path("child-input.jsonl");
    let initialize = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1,"clientCapabilities":{}}}"#;
    let initialize_response = r#"{"jsonrpc":"2.0","id":1,"result":{"protocolVersion":1,"agentInfo":{"name":"counting-acp","version":"0"},"agentCapabilities":{"loadSession":true}}}"#;
    // The child errors on a second `initialize`, like real children that
    // treat it as once-per-connection (codex-acp's app-server answers
    // "Already initialized").
    let mut script = String::from("#!/bin/sh\nset -eu\ninitialize_count=0\n");
    script.push_str("while IFS= read -r line; do\n");
    script.push_str("  printf '%s\\n' \"$line\" >> '");
    script.push_str(child_input_path.to_str().unwrap());
    script.push_str("'\n");
    script.push_str("  case \"$line\" in\n");
    script.push_str("    *'\"initialize\"'*)\n");
    script.push_str("      initialize_count=$((initialize_count + 1))\n");
    script.push_str("      if [ \"$initialize_count\" -gt 1 ]; then\n");
    script.push_str(
        "        printf '%s\\n' '{\"jsonrpc\":\"2.0\",\"id\":1,\"error\":{\"code\":-32600,\"message\":\"Already initialized\"}}'\n",
    );
    script.push_str("      else\n");
    script.push_str("        printf '%s\\n' '");
    script.push_str(initialize_response);
    script.push_str("'\n");
    script.push_str("      fi\n");
    script.push_str("      ;;\n");
    script.push_str("  esac\n");
    script.push_str("done\n");
    let child_script = temp.path("agent-child.sh");
    fs::write(&child_script, script).unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let ws_url = format!("ws://{}/ws", listener.local_addr().unwrap());

    let server = tokio::spawn(async move {
        // Era one: initialize, read the child's response, then hang up.
        let (stream, _) = listener.accept().await.unwrap();
        let mut socket = accept_async(stream).await.unwrap();
        socket.send(Message::Text(initialize.into())).await.unwrap();
        let era_one_response = loop {
            match socket.next().await.unwrap().unwrap() {
                Message::Text(text) => break text.to_string(),
                Message::Ping(payload) => socket.send(Message::Pong(payload)).await.unwrap(),
                _ => {}
            }
        };
        socket.close(None).await.unwrap();
        drop(socket);

        // Era two: the client reconnects and re-initializes (same request id,
        // as a fresh client connection does). The transport must answer from
        // cache — byte-identical — and the child must never see it.
        let (stream, _) = listener.accept().await.unwrap();
        let mut socket = accept_async(stream).await.unwrap();
        socket.send(Message::Text(initialize.into())).await.unwrap();
        let era_two_response = loop {
            match socket.next().await.unwrap().unwrap() {
                Message::Text(text) => break text.to_string(),
                Message::Ping(payload) => socket.send(Message::Pong(payload)).await.unwrap(),
                _ => {}
            }
        };
        // Post-initialize era traffic still flows to the child.
        let load =
            r#"{"jsonrpc":"2.0","id":2,"method":"session/load","params":{"sessionId":"s1"}}"#;
        socket.send(Message::Text(load.into())).await.unwrap();
        tokio::time::sleep(std::time::Duration::from_millis(500)).await;
        socket.close(None).await.unwrap();
        (era_one_response, era_two_response)
    });

    let mut command = Command::new("sh");
    command.arg(&child_script);
    command.stdin(Stdio::piped()).stdout(Stdio::piped());
    let transport = tokio::spawn(outbound_ws::run(ws_url, command));

    let (era_one_response, era_two_response) = server.await.unwrap();
    assert_eq!(era_one_response, initialize_response);
    // The replay is verbatim: identical bytes from the cache.
    assert_eq!(era_two_response, era_one_response);

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(30);
    loop {
        let frames = read_jsonl(&child_input_path);
        let initializes = frames
            .iter()
            .filter(|line| parse_json(line)["method"].as_str() == Some("initialize"))
            .count();
        let loads = frames
            .iter()
            .filter(|line| parse_json(line)["method"].as_str() == Some("session/load"))
            .count();
        if initializes == 1 && loads == 1 {
            break;
        }
        assert!(
            std::time::Instant::now() < deadline,
            "child frames wrong: {frames:?}"
        );
        tokio::time::sleep(std::time::Duration::from_millis(50)).await;
    }
    transport.abort();
}

#[tokio::test]
async fn outbound_ws_drops_child_frames_emitted_while_disconnected() {
    let temp = TestTemp::new("outbound-ws-drop-offline-frames");
    let child_input_path = temp.path("child-input.jsonl");
    let offline_frame = AGENT_FRAMES[2];
    // Child prints one frame immediately (before the first connection), then
    // reads stdin. The transport connects, then the server closes the socket;
    // anything else the child prints while disconnected must not leak into
    // the next era.
    let mut script = String::from("#!/bin/sh\nset -eu\n");
    script.push_str("printf '%s\\n' '");
    script.push_str(offline_frame);
    script.push_str("'\n");
    script.push_str("printf '%s\\n' '");
    script.push_str(AGENT_FRAMES[3]);
    script.push_str("'\n");
    script.push_str("while IFS= read -r line; do\n");
    script.push_str("  printf '%s\\n' \"$line\" >> '");
    script.push_str(child_input_path.to_str().unwrap());
    script.push_str("'\n");
    script.push_str("done\n");
    let child_script = temp.path("agent-child.sh");
    fs::write(&child_script, script).unwrap();

    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let ws_url = format!("ws://{}/ws", listener.local_addr().unwrap());

    let server = tokio::spawn(async move {
        let mut received_first_era = Vec::new();
        let (stream, _) = listener.accept().await.unwrap();
        let mut socket = accept_async(stream).await.unwrap();
        while let Some(message) = socket.next().await {
            match message.unwrap() {
                Message::Text(text) => received_first_era.push(text.to_string()),
                Message::Ping(payload) => socket.send(Message::Pong(payload)).await.unwrap(),
                Message::Close(_) => break,
                _ => {}
            }
            if received_first_era.len() == 2 {
                break;
            }
        }
        socket.close(None).await.unwrap();
        drop(socket);

        // Era two: no dead-era frames may appear; just close.
        let (stream, _) = listener.accept().await.unwrap();
        let socket = accept_async(stream).await.unwrap();
        drop(socket);
        received_first_era
    });

    let mut command = Command::new("sh");
    command.arg(&child_script);
    command.stdin(Stdio::piped()).stdout(Stdio::piped());
    let transport = tokio::spawn(outbound_ws::run(ws_url, command));

    assert_eq!(server.await.unwrap(), vec![offline_frame, AGENT_FRAMES[3]]);
    transport.abort();
}

#[tokio::test]
async fn outbound_ws_forwards_raw_acp_frames_semantically() {
    let temp = TestTemp::new("outbound-ws");
    let child_input_path = temp.path("child-input.jsonl");
    let child_script = write_child_script(temp.path("agent-child.sh"), &child_input_path);
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let ws_url = format!("ws://{}/ws", listener.local_addr().unwrap());

    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut socket = accept_async(stream).await.unwrap();

        for frame in CLIENT_FRAMES {
            socket.send(Message::Text((*frame).into())).await.unwrap();
        }

        let mut received = Vec::new();
        while received.len() < AGENT_FRAMES.len() {
            let Some(message) = socket.next().await else {
                panic!("missing agent frame");
            };
            match message.unwrap() {
                Message::Text(text) => received.push(text.to_string()),
                Message::Ping(payload) => socket.send(Message::Pong(payload)).await.unwrap(),
                Message::Pong(_) => {}
                other => panic!("unexpected websocket message {other:?}"),
            }
        }
        socket.close(None).await.unwrap();
        received
    });

    let mut command = Command::new("sh");
    command.arg(&child_script);
    command.stdin(Stdio::piped()).stdout(Stdio::piped());
    let (frame_observer, mut observed_frames) = frame_observer();
    // The transport is long-lived: it survives the server closing the socket
    // and re-dials, so the run never returns here. Run it as a task and
    // assert against what the era delivered.
    let transport = tokio::spawn(outbound_ws::run_with_observer(
        ws_url,
        command,
        Some(frame_observer),
    ));

    assert_eq!(server.await.unwrap(), AGENT_FRAMES);
    assert_eq!(
        read_jsonl(&child_input_path)
            .iter()
            .map(|line| parse_json(line))
            .collect::<Vec<_>>(),
        expected_client_frames(),
    );
    assert_observed_frames(&mut observed_frames);
    transport.abort();
}

#[tokio::test]
async fn binary_local_stdio_launch_forwards_raw_acp_frames_semantically() {
    let temp = TestTemp::new("local-stdio");
    let child_input_path = temp.path("child-input.jsonl");
    let child_script = write_child_script(temp.path("agent-child.sh"), &child_input_path);

    let mut host = Command::new(env!("CARGO_BIN_EXE_hyper-acp"));
    host.arg("--agent-command")
        .arg("sh")
        .arg("--agent-arg")
        .arg(&child_script)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped());

    let mut child = host.spawn().unwrap();
    let mut stdin = child.stdin.take().unwrap();
    for frame in CLIENT_FRAMES {
        stdin.write_all(frame.as_bytes()).await.unwrap();
        stdin.write_all(b"\n").await.unwrap();
    }
    drop(stdin);

    let output = child.wait_with_output().await.unwrap();
    assert!(
        output.status.success(),
        "hyper-acp exited with {:?}: {}",
        output.status,
        String::from_utf8_lossy(&output.stderr),
    );
    assert_eq!(
        split_lines(&String::from_utf8(output.stdout).unwrap()),
        AGENT_FRAMES
    );
    assert_eq!(
        read_jsonl(&child_input_path)
            .iter()
            .map(|line| parse_json(line))
            .collect::<Vec<_>>(),
        expected_client_frames(),
    );
}

#[tokio::test]
async fn outbound_ws_rejects_host_protocol_envelopes() {
    let temp = TestTemp::new("outbound-ws-rejects-host-envelopes");
    let child_input_path = temp.path("child-input.jsonl");
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let ws_url = format!("ws://{}/ws", listener.local_addr().unwrap());

    let server = tokio::spawn(async move {
        let (stream, _) = listener.accept().await.unwrap();
        let mut socket = accept_async(stream).await.unwrap();
        socket
            .send(Message::Text(
                r#"{"event":"turn.submit","payload":{"text":"not ACP"}}"#.into(),
            ))
            .await
            .unwrap();
    });

    let mut command = Command::new("sleep");
    command.arg("10");
    command.stdin(Stdio::piped()).stdout(Stdio::piped());

    let error = outbound_ws::run(ws_url, command)
        .await
        .unwrap_err()
        .to_string();
    server.await.unwrap();

    assert!(error.contains("ACP frame"), "{error}");
    assert_eq!(read_jsonl(&child_input_path), Vec::<String>::new());
}

#[test]
fn binary_buzz_plugin_help_uses_in_process_library() {
    let output = StdCommand::new(env!("CARGO_BIN_EXE_hyper-acp"))
        .arg("plugin")
        .arg("buzz")
        .arg("--help")
        .env(
            "HYPER_ACP_AGENT_COMMAND",
            "/definitely/not/a/buzz-acp-binary",
        )
        .output()
        .unwrap();

    assert!(
        output.status.success(),
        "hyper-acp plugin buzz --help exited with {:?}: {}",
        output.status,
        String::from_utf8_lossy(&output.stderr),
    );
    let stdout = String::from_utf8(output.stdout).unwrap();
    assert!(stdout.contains("ACP harness that bridges Buzz events to AI agents"));
    assert!(stdout.contains("--private-key"));
}

#[test]
fn binary_buzz_helper_help_uses_in_process_library() {
    for (subcommand, expected) in [
        (
            "auth-methods",
            "Query adapter-advertised ACP authentication methods",
        ),
        ("auth-tag", "Compute a NIP-OA owner attestation auth tag"),
    ] {
        let output = StdCommand::new(env!("CARGO_BIN_EXE_hyper-acp"))
            .arg("plugin")
            .arg(subcommand)
            .arg("--help")
            .env(
                "HYPER_ACP_AGENT_COMMAND",
                "/definitely/not/a/buzz-acp-binary",
            )
            .output()
            .unwrap();

        assert!(
            output.status.success(),
            "hyper-acp plugin {subcommand} --help exited with {:?}: {}",
            output.status,
            String::from_utf8_lossy(&output.stderr),
        );
        let stdout = String::from_utf8(output.stdout).unwrap();
        assert!(stdout.contains(expected));
    }
}

fn write_child_script(path: PathBuf, child_input_path: &Path) -> PathBuf {
    let mut script = String::from("#!/bin/sh\nset -eu\n");
    for frame in AGENT_FRAMES {
        script.push_str("printf '%s\\n' '");
        script.push_str(frame);
        script.push_str("'\n");
    }
    script.push_str("while IFS= read -r line; do\n");
    script.push_str("  printf '%s\\n' \"$line\" >> '");
    script.push_str(child_input_path.to_str().unwrap());
    script.push_str("'\n");
    script.push_str("done\n");
    fs::write(&path, script).unwrap();
    path
}

fn read_jsonl(path: &Path) -> Vec<String> {
    split_lines(&fs::read_to_string(path).unwrap_or_default())
}

fn split_lines(text: &str) -> Vec<String> {
    text.lines().map(str::to_owned).collect()
}

fn parse_json(text: &str) -> Value {
    serde_json::from_str(text).unwrap()
}

/// Client frames as the child actually receives them: the transport rewrites
/// `initialize` `clientCapabilities` to advertise fs read/write so pod-side
/// capability termination can serve them. Terminal stays not advertised.
fn rewritten_initialize_frame(frame: &str) -> Value {
    let mut value = parse_json(frame);
    let capabilities = value["params"]["clientCapabilities"]
        .as_object_mut()
        .unwrap();
    capabilities.insert(
        "fs".to_owned(),
        json!({"readTextFile": true, "writeTextFile": true}),
    );
    value
}

fn expected_client_frames() -> Vec<Value> {
    CLIENT_FRAMES
        .iter()
        .map(|frame| {
            let value = parse_json(frame);
            if value["method"].as_str() == Some("initialize") {
                rewritten_initialize_frame(frame)
            } else {
                value
            }
        })
        .collect()
}

fn frame_observer() -> (
    AcpFrameObserver,
    tokio::sync::mpsc::Receiver<ObservedAcpFrame>,
) {
    let (tx, rx) = tokio::sync::mpsc::channel(64);
    (AcpFrameObserver::new(tx), rx)
}

fn assert_observed_frames(observed: &mut tokio::sync::mpsc::Receiver<ObservedAcpFrame>) {
    let mut frames = Vec::new();
    while let Ok(frame) = observed.try_recv() {
        frames.push(frame);
    }

    // The observed text is post-rewrite: the initialize frame expectation
    // must match what the transport sent to the child.
    let client_frames = expected_client_frames()
        .into_iter()
        .map(|value| value.to_string());
    let agent_frames = AGENT_FRAMES.iter().map(|frame| (*frame).to_owned());
    let expected = client_frames
        .map(|frame| (Direction::ClientToAgent, frame))
        .chain(agent_frames.map(|frame| (Direction::AgentToClient, frame)))
        .collect::<Vec<_>>();

    assert_eq!(frames.len(), expected.len());
    for (actual, (direction, text)) in frames.iter().zip(expected) {
        assert_eq!(actual.direction, direction);
        assert_eq!(parse_json(&actual.text), parse_json(&text));
        assert!(!actual.text.contains("turn.submit"));
        assert!(!actual.text.contains("agent_shell"));
        assert!(!actual.text.contains(r#""event""#));
        assert!(!actual.text.contains(r#""payload""#));
    }
}

struct TestTemp {
    root: PathBuf,
}

impl TestTemp {
    fn new(name: &str) -> Self {
        let now = SystemTime::now()
            .duration_since(UNIX_EPOCH)
            .unwrap()
            .as_nanos();
        let root = std::env::temp_dir().join(format!("hyper-acp-{name}-{now}"));
        fs::create_dir_all(&root).unwrap();
        Self { root }
    }

    fn path(&self, name: &str) -> PathBuf {
        self.root.join(name)
    }
}

impl Drop for TestTemp {
    fn drop(&mut self) {
        drop(fs::remove_dir_all(&self.root));
    }
}
