//! Product receive capacity over real loopback sockets, without a model call.
use base64::{engine::general_purpose::STANDARD, Engine};
use futures_util::{SinkExt, StreamExt};
use hypercli_sdk::{AcpClient, AcpError};
use serde_json::{json, Value};
use std::time::Duration;
use tokio::net::{TcpListener, TcpStream};
use tokio_tungstenite::{accept_async, tungstenite::Message, WebSocketStream};

const SMALL_PNG: &str = "iVBORw0KGgoAAAANSUhEUgAAAAIAAAABCAIAAAB7QOjdAAAAD0lEQVR4nGP4z8DA8J8BAAf/Af8Bf4mnAAAAAElFTkSuQmCC";

fn budget_png() -> Vec<u8> {
    let small = STANDARD.decode(SMALL_PNG).unwrap();
    let mut png = small[..small.len() - 12].to_vec();
    let padding = 25_000_000 - small.len() - 12;
    png.extend_from_slice(&(padding as u32).to_be_bytes());
    png.extend_from_slice(b"npAD");
    png.resize(png.len() + padding, 0);
    // CRC32(npAD + 24,999,916 zero bytes). Same valid 2x1 PNG fixture as
    // Python/TS; SHA256 c0e33652298ddd7f7a95429fd3b117bb9c45a45113bfecd965c611b206e58c26.
    png.extend_from_slice(&0xd63aed4d_u32.to_be_bytes());
    png.extend_from_slice(&small[small.len() - 12..]);
    png
}

async fn read(socket: &mut WebSocketStream<TcpStream>) -> Value {
    loop {
        if let Message::Text(text) = socket.next().await.unwrap().unwrap() {
            return serde_json::from_str(&text).unwrap();
        }
    }
}

async fn initialize(socket: &mut WebSocketStream<TcpStream>) {
    let request = read(socket).await;
    assert_eq!(request["method"], "initialize");
    socket
        .send(Message::Text(
            json!({"jsonrpc":"2.0","id":request["id"],
        "result":{"protocolVersion":1,"agentCapabilities":{}}})
            .to_string()
            .into(),
        ))
        .await
        .unwrap();
}

#[tokio::test]
async fn live_png_budget_and_duplicate_tool_survive_product_receive() {
    tokio::time::timeout(Duration::from_secs(30), async {
        let png = budget_png();
        assert_eq!(png.len(), 25_000_000);
        assert_eq!(&png[16..24], &[0, 0, 0, 2, 0, 0, 0, 1]);
        let image = json!({"type":"image","mimeType":"image/png","data":STANDARD.encode(&png)});
        assert_eq!(image["data"].as_str().unwrap().len(), 33_333_336);
        let tool = json!({"sessionUpdate":"tool_call_update","toolCallId":"read-image","status":"completed",
            "content":[{"type":"content","content":image}, {"type":"diff","path":"/tmp/a","oldText":"old","newText":"new"}],
            "rawOutput":{"output":"native output","metadata":{"data":"opaque"},"attachments":[{
                "mime":"image/png","filename":"two.png","url":format!("data:image/png;base64,{}",image["data"].as_str().unwrap())}]}});
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("ws://{}/ws", listener.local_addr().unwrap());
        let native = vec![json!({"sessionUpdate":"agent_message_chunk","content":image}), tool];
        let emitted = native.clone();
        let server = tokio::spawn(async move {
            let mut socket = accept_async(listener.accept().await.unwrap().0).await.unwrap();
            initialize(&mut socket).await;
            let prompt = read(&mut socket).await;
            assert_eq!(prompt["method"], "session/prompt");
            for update in emitted {
                let wire = json!({"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"native","update":update}}).to_string();
                assert!(wire.len() < 100_000_000);
                socket.send(Message::Text(wire.into())).await.unwrap();
            }
            socket.send(Message::Text(json!({"jsonrpc":"2.0","id":prompt["id"],"result":{"stopReason":"end_turn"}}).to_string().into())).await.unwrap();
        });
        let client = AcpClient::connect(&url, "").await.unwrap();
        client.initialize().await.unwrap();
        let mut updates = client.take_updates().unwrap();
        assert_eq!(client.prompt("native", "offline fixture").await.unwrap().stop_reason.as_deref(), Some("end_turn"));
        for expected in native {
            let update = updates.recv().await.unwrap();
            assert!(update["update"] == expected);
            let block = if expected["sessionUpdate"] == "agent_message_chunk" { &update["update"]["content"] } else { &update["update"]["content"][0]["content"] };
            assert!(STANDARD.decode(block["data"].as_str().unwrap()).unwrap() == png);
        }
        client.close();
        server.await.unwrap();
    }).await.expect("bounded media exchange");
}

#[tokio::test]
async fn envelope_overflow_is_not_native_completion_and_new_connection_works() {
    tokio::time::timeout(Duration::from_secs(30), async {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let url = format!("ws://{}/ws", listener.local_addr().unwrap());
        let server = tokio::spawn(async move {
            for oversize in [true, false] {
                let mut socket = accept_async(listener.accept().await.unwrap().0).await.unwrap();
                initialize(&mut socket).await;
                let prompt = read(&mut socket).await;
                if oversize {
                    // Valid JSON text, one byte above the envelope. An attempted
                    // prompt remains ambiguous, never a synthesized ACP error.
                    let wire = format!("\"{}\"", "x".repeat(99_999_999));
                    let _ = socket.send(Message::Text(wire.into())).await;
                } else {
                    socket.send(Message::Text(json!({"jsonrpc":"2.0","method":"session/update","params":{
                        "sessionId":"native","update":{"sessionUpdate":"agent_message_chunk","content":{
                            "type":"image","mimeType":"image/png","data":SMALL_PNG}}}}).to_string().into())).await.unwrap();
                    socket.send(Message::Text(json!({"jsonrpc":"2.0","id":prompt["id"],"result":{"stopReason":"end_turn"}}).to_string().into())).await.unwrap();
                }
            }
        });
        let client = AcpClient::connect(&url, "").await.unwrap();
        client.initialize().await.unwrap();
        let mut updates = client.take_updates().unwrap();
        let error = client.prompt("native", "oversize").await.unwrap_err();
        assert!(matches!(error, AcpError::AmbiguousDelivery { ref detail } if detail.contains("too long")), "{error}");
        assert!(updates.try_recv().is_err());
        client.close();
        let fresh = AcpClient::connect(&url, "").await.unwrap();
        fresh.initialize().await.unwrap();
        let mut updates = fresh.take_updates().unwrap();
        assert_eq!(fresh.prompt("native", "small").await.unwrap().stop_reason.as_deref(), Some("end_turn"));
        assert_eq!(updates.recv().await.unwrap()["update"]["content"]["data"], SMALL_PNG);
        fresh.close();
        server.await.unwrap();
    }).await.expect("bounded overflow and recovery exchange");
}
