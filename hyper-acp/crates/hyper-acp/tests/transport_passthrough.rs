#![allow(missing_docs)]

use futures_util::{SinkExt, StreamExt};
use hyper_acp::transport::Direction;
use hyper_acp::transport::outbound_ws;
use hyper_acp::transport::{AcpFrameObserver, ObservedAcpFrame};
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
async fn outbound_ws_forwards_raw_acp_frames_byte_for_byte() {
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
    outbound_ws::run_with_client_frame_source_and_observer(
        ws_url,
        command,
        None,
        Some(frame_observer),
    )
    .await
    .unwrap();

    assert_eq!(server.await.unwrap(), AGENT_FRAMES);
    assert_eq!(read_jsonl(&child_input_path), CLIENT_FRAMES);
    assert_observed_frames(&mut observed_frames);
}

#[tokio::test]
async fn binary_local_stdio_launch_forwards_raw_acp_frames_byte_for_byte() {
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
    assert_eq!(read_jsonl(&child_input_path), CLIENT_FRAMES);
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

    let expected = CLIENT_FRAMES
        .iter()
        .map(|frame| (Direction::ClientToAgent, *frame))
        .chain(
            AGENT_FRAMES
                .iter()
                .map(|frame| (Direction::AgentToClient, *frame)),
        )
        .collect::<Vec<_>>();

    assert_eq!(frames.len(), expected.len());
    for (actual, (direction, text)) in frames.iter().zip(expected) {
        assert_eq!(actual.direction, direction);
        assert_eq!(actual.text, text);
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
