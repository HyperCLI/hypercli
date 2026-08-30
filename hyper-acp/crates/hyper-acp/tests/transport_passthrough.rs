#![allow(missing_docs)]

use futures_util::{SinkExt, StreamExt};
use hyper_acp::plugin::PluginRegistry;
use hyper_acp::transport::outbound_ws;
use std::fs;
use std::path::{Path, PathBuf};
use std::process::Stdio;
use std::sync::Arc;
use std::time::{SystemTime, UNIX_EPOCH};
use tokio::io::AsyncWriteExt;
use tokio::net::TcpListener;
use tokio::process::Command;
use tokio_tungstenite::accept_async;
use tokio_tungstenite::tungstenite::protocol::Message;

const CLIENT_FRAMES: &[&str] = &[
    r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}"#,
    r#"{"jsonrpc":"2.0","id":"response","result":{"ok":true}}"#,
    r#"{"jsonrpc":"2.0","method":"initialized"}"#,
    r#"[{"jsonrpc":"2.0","id":"mixed-request","method":"session/prompt","params":{"sessionId":"s1"}},{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1"}}]"#,
    r#"[{"jsonrpc":"2.0","id":"batch-a","result":{}},{"jsonrpc":"2.0","id":"batch-b","result":{"ok":true}}]"#,
    r#"{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"chunk"}}}}"#,
    r#"{"jsonrpc":"2.0","id":"extension","method":"hypercli.experimental/raw","params":{"value":7}}"#,
];

const AGENT_FRAMES: &[&str] = &[
    r#"{"jsonrpc":"2.0","id":2,"method":"initialize","params":{"protocolVersion":1}}"#,
    r#"{"jsonrpc":"2.0","id":"agent-response","result":{"ok":true}}"#,
    r#"{"jsonrpc":"2.0","method":"initialized"}"#,
    r#"[{"jsonrpc":"2.0","id":"agent-mixed-request","method":"session/prompt","params":{"sessionId":"s2"}},{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s2"}}]"#,
    r#"[{"jsonrpc":"2.0","id":"agent-batch-a","result":{}},{"jsonrpc":"2.0","id":"agent-batch-b","result":{"ok":true}}]"#,
    r#"{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s2","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"agent chunk"}}}}"#,
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
        for _ in AGENT_FRAMES {
            let Some(message) = socket.next().await else {
                panic!("missing agent frame");
            };
            match message.unwrap() {
                Message::Text(text) => received.push(text.to_string()),
                other => panic!("unexpected websocket message {other:?}"),
            }
        }
        socket.close(None).await.unwrap();
        received
    });

    let mut command = Command::new("sh");
    command.arg(&child_script);
    command.stdin(Stdio::piped()).stdout(Stdio::piped());
    outbound_ws::run(ws_url, command, None, Arc::new(PluginRegistry::new()))
        .await
        .unwrap();

    assert_eq!(server.await.unwrap(), AGENT_FRAMES);
    assert_eq!(read_jsonl(&child_input_path), CLIENT_FRAMES);
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
