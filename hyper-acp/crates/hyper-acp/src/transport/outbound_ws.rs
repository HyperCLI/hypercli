//! Outbound raw ACP WebSocket transport.

use crate::plugin::PluginRegistry;
use crate::trace::{Direction, TraceStore};
use crate::transport::AcpFrameObserver;
use anyhow::{Context, Result, bail};
use futures_util::{SinkExt, StreamExt};
use std::env;
use std::sync::Arc;
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio_tungstenite::connect_async;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::header::{AUTHORIZATION, USER_AGENT};
use tokio_tungstenite::tungstenite::protocol::Message;
use url::Url;

const HYPER_AGENTS_API_KEY_ENV: &str = "HYPER_AGENTS_API_KEY";

/// Run an ACP child process over an outbound `/ws` WebSocket.
///
/// Every valid ACP JSON-RPC frame is forwarded unchanged as a WebSocket text
/// frame in one direction and as a newline-delimited stdio frame in the other.
///
/// # Errors
///
/// Returns an error if the URL is not a `ws` or `wss` `/ws` URL, the child
/// process cannot be spawned, a frame is not JSON-RPC 2.0, or either transport
/// fails.
pub async fn run(
    ws_url: String,
    command: Command,
    trace: Option<TraceStore>,
    plugins: Arc<PluginRegistry>,
) -> Result<()> {
    run_with_client_frame_source_and_observer(ws_url, command, trace, plugins, None, None).await
}

/// Run an ACP child over outbound `/ws` with plugin-provided client frames.
///
/// Frames from `client_frames` are validated and forwarded through the same
/// client-to-agent stdio path as websocket client frames.
///
/// # Errors
///
/// Returns an error if URL, child process, frame validation, or transport I/O
/// fails.
pub async fn run_with_client_frame_source(
    ws_url: String,
    command: Command,
    trace: Option<TraceStore>,
    plugins: Arc<PluginRegistry>,
    client_frames: Option<mpsc::Receiver<String>>,
) -> Result<()> {
    run_with_client_frame_source_and_observer(ws_url, command, trace, plugins, client_frames, None)
        .await
}

/// Run an ACP child over outbound `/ws` with plugin-provided frames and observers.
///
/// # Errors
///
/// Returns an error if URL, child process, frame validation, observer delivery,
/// or transport I/O fails.
pub async fn run_with_client_frame_source_and_observer(
    ws_url: String,
    command: Command,
    trace: Option<TraceStore>,
    plugins: Arc<PluginRegistry>,
    client_frames: Option<mpsc::Receiver<String>>,
    observer: Option<AcpFrameObserver>,
) -> Result<()> {
    validate_ws_url(&ws_url)?;
    let mut request = ws_url
        .into_client_request()
        .context("build ACP WebSocket request")?;
    request
        .headers_mut()
        .insert(USER_AGENT, "hyper-acp/0.1".parse().unwrap());
    if let Some(token) = outbound_auth_token() {
        request.headers_mut().insert(
            AUTHORIZATION,
            format!("Bearer {token}")
                .parse()
                .context("build ACP WebSocket authorization header")?,
        );
    }

    let (socket, _) = connect_async(request)
        .await
        .context("connect ACP WebSocket")?;
    let (mut ws_write, mut ws_read) = socket.split();

    let mut child = super::spawn_acp_child(command)?;
    let mut child_stdin = child.stdin.take().context("child stdin unavailable")?;
    let child_stdout = child.stdout.take().context("child stdout unavailable")?;

    let (child_write_tx, mut child_write_rx) = mpsc::channel::<String>(256);

    let ws_to_child = {
        let trace = trace.clone();
        let plugins = Arc::clone(&plugins);
        let child_write_tx = child_write_tx.clone();
        let observer = observer.clone();
        tokio::spawn(async move {
            while let Some(message) = ws_read.next().await {
                match message? {
                    Message::Text(text) => {
                        let text = text.to_string();
                        validate_stdio_text_frame(&text)?;
                        super::observe_frame(
                            Direction::ClientToAgent,
                            &text,
                            trace.as_ref(),
                            &plugins,
                        )?;
                        if let Some(observer) = &observer {
                            observer.observe(Direction::ClientToAgent, &text).await?;
                        }
                        child_write_tx
                            .send(text)
                            .await
                            .context("ACP child writer closed")?;
                    }
                    Message::Binary(_) => {
                        bail!("ACP WebSocket transport accepts text frames only");
                    }
                    Message::Close(_) => break,
                    Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => {}
                }
            }
            anyhow::Ok(())
        })
    };

    let plugin_to_child = client_frames.map(|mut client_frames| {
        let trace = trace.clone();
        let plugins = Arc::clone(&plugins);
        let child_write_tx = child_write_tx.clone();
        let observer = observer.clone();
        tokio::spawn(async move {
            while let Some(text) = client_frames.recv().await {
                validate_stdio_text_frame(&text)?;
                super::observe_frame(Direction::ClientToAgent, &text, trace.as_ref(), &plugins)?;
                if let Some(observer) = &observer {
                    observer.observe(Direction::ClientToAgent, &text).await?;
                }
                child_write_tx
                    .send(text)
                    .await
                    .context("ACP child writer closed")?;
            }
            anyhow::Ok(())
        })
    });

    drop(child_write_tx);

    let child_writer = tokio::spawn(async move {
        while let Some(text) = child_write_rx.recv().await {
            child_stdin.write_all(text.as_bytes()).await?;
            child_stdin.write_all(b"\n").await?;
        }
        child_stdin.shutdown().await?;
        anyhow::Ok(())
    });

    let child_to_ws = {
        let plugins = Arc::clone(&plugins);
        let observer = observer.clone();
        tokio::spawn(async move {
            let mut lines = BufReader::new(child_stdout).lines();
            while let Some(line) = lines.next_line().await? {
                super::observe_frame(Direction::AgentToClient, &line, trace.as_ref(), &plugins)?;
                if let Some(observer) = &observer {
                    observer.observe(Direction::AgentToClient, &line).await?;
                }
                ws_write.send(Message::Text(line.into())).await?;
            }
            ws_write.close().await?;
            anyhow::Ok(())
        })
    };

    tokio::pin!(ws_to_child);
    tokio::pin!(child_to_ws);
    tokio::pin!(child_writer);
    let mut plugin_to_child = plugin_to_child;

    tokio::select! {
        biased;
        status = child.wait() => {
            ws_to_child.abort();
            if let Some(task) = &plugin_to_child {
                task.abort();
            }
            child_writer.abort();
            let status = status?;
            let output_result = child_to_ws.await;
            if !status.success() {
                bail!("ACP child exited with {status}");
            }
            output_result??;
        }
        result = &mut ws_to_child => {
            result??;
            drop(child.kill().await);
            child_to_ws.abort();
            if let Some(task) = &plugin_to_child {
                task.abort();
            }
            child_writer.abort();
        }
        result = &mut child_to_ws => {
            result??;
            drop(child.kill().await);
            ws_to_child.abort();
            if let Some(task) = &plugin_to_child {
                task.abort();
            }
            child_writer.abort();
        }
        result = &mut child_writer => {
            result??;
            drop(child.kill().await);
            ws_to_child.abort();
            child_to_ws.abort();
            if let Some(task) = &plugin_to_child {
                task.abort();
            }
        }
        result = async {
            match &mut plugin_to_child {
                Some(task) => Some(task.await),
                None => std::future::pending().await,
            }
        } => {
            if let Some(result) = result {
                result??;
            }
        }
    }

    Ok(())
}

fn validate_ws_url(ws_url: &str) -> Result<()> {
    let url = Url::parse(ws_url).context("parse ACP WebSocket URL")?;
    match url.scheme() {
        "ws" | "wss" => {}
        scheme => bail!("ACP WebSocket URL must use ws:// or wss://, got {scheme}://"),
    }
    if url.path() != "/ws" {
        bail!("ACP WebSocket URL path must be /ws");
    }
    Ok(())
}

fn validate_stdio_text_frame(text: &str) -> Result<()> {
    if text.contains('\n') {
        bail!("ACP WebSocket text frames must not contain embedded newlines");
    }
    crate::frame::RawAcpFrame::parse(text)?;
    Ok(())
}

fn outbound_auth_token() -> Option<String> {
    env::var(HYPER_AGENTS_API_KEY_ENV)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn ws_url_must_target_ws_path() {
        assert!(validate_ws_url("ws://localhost:8080/ws").is_ok());
        assert!(validate_ws_url("wss://example.com/ws?agent=a").is_ok());
        assert!(validate_ws_url("https://example.com/ws").is_err());
        assert!(validate_ws_url("ws://localhost:8080/acp").is_err());
    }

    #[test]
    fn outbound_text_frames_must_be_single_json_rpc_frames() {
        assert!(validate_stdio_text_frame(r#"{"jsonrpc":"2.0","method":"initialized"}"#).is_ok());
        assert!(validate_stdio_text_frame("{}").is_err());
        assert!(validate_stdio_text_frame("{}\n{}").is_err());
    }

    #[test]
    fn blank_outbound_auth_token_is_ignored() {
        unsafe {
            env::set_var(HYPER_AGENTS_API_KEY_ENV, "   ");
        }
        assert_eq!(outbound_auth_token(), None);
        unsafe {
            env::remove_var(HYPER_AGENTS_API_KEY_ENV);
        }
    }
}
