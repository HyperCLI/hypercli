//! Outbound raw ACP WebSocket transport.

use std::sync::Arc;

use crate::adapter::PromptAdapter;
use crate::capabilities::{AgentFrameAction, ClientFrameAction, PodCapabilities};
use crate::frame::validate_frame;
use crate::prompt::PromptConfig;
use crate::transport::{AcpFrameObserver, Direction};
use anyhow::{Context, Result, bail};
use futures_util::{SinkExt, StreamExt};
use std::env;
use std::time::{Duration, Instant};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;
use tokio::process::Command;
use tokio::sync::mpsc;
use tokio_tungstenite::tungstenite::client::IntoClientRequest;
use tokio_tungstenite::tungstenite::http::header::{AUTHORIZATION, USER_AGENT};
use tokio_tungstenite::tungstenite::protocol::Message;
use tokio_tungstenite::{MaybeTlsStream, WebSocketStream, connect_async};
use url::Url;

const HYPER_AGENTS_API_KEY_ENV: &str = "HYPER_AGENTS_API_KEY";
const WS_KEEPALIVE_INTERVAL: Duration = Duration::from_secs(30);
/// Initial reconnect backoff; doubles per failure up to `WS_RECONNECT_BACKOFF_CAP`.
const WS_RECONNECT_BACKOFF_INITIAL: Duration = Duration::from_secs(1);
const WS_RECONNECT_BACKOFF_CAP: Duration = Duration::from_secs(30);
/// Maximum cumulative time spent disconnected before failing the process. A
/// runtime that cannot re-dial loses its launch-epoch runtime key as it ages
/// anyway; exiting lets the control plane restart the pod with a fresh key
/// instead of sitting unreachable forever.
const WS_MAX_DISCONNECTED: Duration = Duration::from_mins(5);
/// An era that lived this long proves connectivity is fine, so the next
/// failure restarts the backoff from the initial value.
const WS_HEALTHY_ERA: Duration = Duration::from_mins(1);
/// Agent-to-client frames buffered while the socket is down are dropped on
/// reconnect: ACP v1 has no replay, and the reconnecting client re-enters
/// with `initialize`/`session/load`, which must not see dead-era frames.
const CHILD_OUTBOUND_CHANNEL_LIMIT: usize = 256;

type Socket = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// Run an ACP child process over an outbound `/ws` WebSocket.
///
/// Every valid ACP JSON-RPC frame is forwarded unchanged as a WebSocket text
/// frame in one direction and as a newline-delimited stdio frame in the other.
/// The child process is long-lived: it survives WebSocket reconnects, matching
/// ACP v1 semantics where connections are ephemeral and clients re-enter with
/// `initialize` + `session/load`. A re-initializing client is answered from
/// the cached first-era child `initialize` response (see the
/// `crate::capabilities` module doc); the child only ever initializes once.
///
/// # Errors
///
/// Returns an error if the URL is not a `ws` or `wss` `/ws` URL, the child
/// process cannot be spawned, a frame is not JSON-RPC 2.0, the child exits,
/// a persistent transport fails, or the socket stays down past
/// `WS_MAX_DISCONNECTED`.
pub async fn run(ws_url: String, command: Command) -> Result<()> {
    Box::pin(run_with_prompt(ws_url, command, PromptConfig::from_env()?)).await
}

/// Run an ACP child process over an outbound `/ws` WebSocket with prompt injection.
///
/// # Errors
///
/// Returns an error under the same conditions as [`run_with_observer`].
pub async fn run_with_prompt(
    ws_url: String,
    command: Command,
    prompt_config: PromptConfig,
) -> Result<()> {
    Box::pin(run_with_prompt_and_observer(
        ws_url,
        command,
        prompt_config,
        None,
    ))
    .await
}

/// How a socket era ended.
enum EraEnd {
    /// Clean close or connection failure; re-dial after backoff.
    Transient,
    /// Protocol violation or child-side failure; retrying is wrong.
    Fatal(anyhow::Error),
}

/// Run an ACP child over outbound `/ws` with an optional frame observer.
///
/// # Errors
///
/// Returns an error if URL, child process, frame validation, observer delivery,
/// or transport I/O fails.
pub async fn run_with_observer(
    ws_url: String,
    command: Command,
    observer: Option<AcpFrameObserver>,
) -> Result<()> {
    Box::pin(run_with_prompt_and_observer(
        ws_url,
        command,
        PromptConfig::from_env()?,
        observer,
    ))
    .await
}

/// Run an ACP child over outbound `/ws` with prompt injection and an optional frame observer.
///
/// # Errors
///
/// Returns an error if URL, child process, frame validation, prompt injection,
/// observer delivery, or transport I/O fails.
pub async fn run_with_prompt_and_observer(
    ws_url: String,
    command: Command,
    prompt_config: PromptConfig,
    observer: Option<AcpFrameObserver>,
) -> Result<()> {
    validate_ws_url(&ws_url)?;

    let (child_write_tx, mut child_write_rx) = mpsc::channel::<String>(256);
    let (child_outbound_tx, mut child_outbound_rx) =
        mpsc::channel::<String>(CHILD_OUTBOUND_CHANNEL_LIMIT);

    let caps = Arc::new(PodCapabilities::from_env(&child_write_tx));
    let adapter = Arc::new(PromptAdapter::new(prompt_config));

    // The first connection precedes the child spawn so agent startup frames
    // can never race ahead of client frames.
    let mut backoff = WS_RECONNECT_BACKOFF_INITIAL;
    let connect_started = Instant::now();
    let first_socket = loop {
        let connected = connect_socket(&ws_url).await;
        if let Ok(socket) = connected {
            break socket;
        }
        if connect_started.elapsed() >= WS_MAX_DISCONNECTED {
            bail!("ACP WebSocket unavailable for too long");
        }
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(WS_RECONNECT_BACKOFF_CAP);
    };

    let mut child = super::spawn_acp_child(command)?;
    let mut child_stdin = child.stdin.take().context("child stdin unavailable")?;
    let child_stdout = child.stdout.take().context("child stdout unavailable")?;

    // The child writer is persistent: it outlives individual socket eras so a
    // reconnect does not disturb the child's stdin stream.
    let child_writer = tokio::spawn(async move {
        while let Some(text) = child_write_rx.recv().await {
            child_stdin.write_all(text.as_bytes()).await?;
            child_stdin.write_all(b"\n").await?;
        }
        child_stdin.shutdown().await?;
        anyhow::Ok(())
    });

    // The child reader is persistent for the same reason. Between eras nothing
    // drains `child_outbound_rx`, so the channel fills and back-pressures the
    // child's stdout writes instead of failing them.
    let child_reader = tokio::spawn({
        let caps = Arc::clone(&caps);
        let adapter = Arc::clone(&adapter);
        async move {
            let mut lines = BufReader::new(child_stdout).lines();
            while let Some(line) = lines.next_line().await? {
                validate_frame(&line)?;
                // Pod capability termination: fs/(permission) agent→client
                // requests are answered locally, never pumped upstream; the
                // hook also binds session/new cwds to agent-assigned session
                // ids as responses pass through.
                let line = match caps.handle_agent_frame(&line).await {
                    AgentFrameAction::Forward(line) => line,
                    AgentFrameAction::Drop => continue,
                };
                // Per-adapter prompt delivery: capture the agent identity
                // from its initialize response and bind prepend-pending
                // prompts to session ids.
                adapter.observe_agent_frame(&line);
                child_outbound_tx
                    .send(line.into_owned())
                    .await
                    .context("ACP child outbound channel closed")?;
            }
            anyhow::Ok(())
        }
    });

    tokio::pin!(child_writer);
    tokio::pin!(child_reader);

    let mut preconnected = Some(first_socket);
    let mut had_prior_era = false;
    let mut disconnected_since: Option<Instant> = None;
    let mut era_started = Instant::now();
    let mut backoff = WS_RECONNECT_BACKOFF_INITIAL;

    let outcome: Result<()> = loop {
        let era = tokio::select! {
            biased;
            status = child.wait() => {
                let status = status?;
                if !status.success() {
                    break Err(anyhow::anyhow!("ACP child exited with {status}"));
                }
                break Ok(());
            }
            ended = run_socket_era(
                SocketEraContext {
                    ws_url: &ws_url,
                    observer: observer.as_ref(),
                    caps: &caps,
                    adapter: &adapter,
                    child_write_tx: &child_write_tx,
                    had_prior_era,
                    preconnected: preconnected.take(),
                },
                &mut child_outbound_rx,
            ) => ended,
            result = &mut child_writer => {
                result??;
                break Err(anyhow::anyhow!("ACP child stdin closed unexpectedly"));
            }
            result = &mut child_reader => {
                result??;
                break Err(anyhow::anyhow!("ACP child stdout closed unexpectedly"));
            }
        };

        if let EraEnd::Fatal(error) = era {
            break Err(error);
        }
        had_prior_era = true;
        if era_started.elapsed() >= WS_HEALTHY_ERA {
            // The era ran long enough to prove connectivity; treat the next
            // outage as a fresh one.
            disconnected_since = Some(Instant::now());
            backoff = WS_RECONNECT_BACKOFF_INITIAL;
        } else {
            let since = disconnected_since.get_or_insert_with(Instant::now);
            if since.elapsed() >= WS_MAX_DISCONNECTED {
                break Err(anyhow::anyhow!("ACP WebSocket unavailable for too long"));
            }
        }
        era_started = Instant::now();
        tokio::time::sleep(backoff).await;
        backoff = (backoff * 2).min(WS_RECONNECT_BACKOFF_CAP);
    };

    // The child handle kills the process on drop; persistent tasks are
    // aborted rather than joined because their channels may be
    // back-pressured.
    child_reader.abort();
    child_writer.abort();
    outcome
}

/// Connect one outbound `/ws` socket with the runtime auth header.
async fn connect_socket(ws_url: &str) -> Result<Socket> {
    // The bridge accepts the token as a `Bearer` header or a `?token=` query
    // parameter; send both so either bridge build registers this runtime.
    let token = outbound_auth_token();
    let request_url = authenticated_request_url(ws_url, token.as_deref())?;
    let mut request = request_url
        .into_client_request()
        .context("build ACP WebSocket request")?;
    request
        .headers_mut()
        .insert(USER_AGENT, "hyper-acp/0.1".parse().unwrap());
    if let Some(token) = token {
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
    Ok(socket)
}

/// Era failure classification. Transient failures are transport-level and
/// worth re-dialing; fatal failures mean the peer or the child violated the
/// protocol and re-dialing would repeat them.
enum EraError {
    Transient,
    Fatal(anyhow::Error),
}

/// Run one connected socket era.
///
/// On a re-dialed era (no `preconnected` socket), frames the child emitted
/// while the socket was down are dropped: ACP v1 has no replay, and the
/// reconnecting client re-enters with `initialize`/`session/load`, which must
/// not see dead-era frames.
struct SocketEraContext<'a> {
    ws_url: &'a str,
    observer: Option<&'a AcpFrameObserver>,
    caps: &'a Arc<PodCapabilities>,
    adapter: &'a Arc<PromptAdapter>,
    child_write_tx: &'a mpsc::Sender<String>,
    had_prior_era: bool,
    preconnected: Option<Socket>,
}

async fn run_socket_era(
    context: SocketEraContext<'_>,
    child_outbound_rx: &mut mpsc::Receiver<String>,
) -> EraEnd {
    let socket = match context.preconnected {
        Some(socket) => socket,
        None => match connect_socket(context.ws_url).await {
            Ok(socket) => socket,
            Err(_) => return EraEnd::Transient,
        },
    };
    if context.had_prior_era {
        while child_outbound_rx.try_recv().is_ok() {}
        // Turns started on the dead era can never see their responses; the
        // observer must drop them along with the dead-era frames above.
        if let Some(observer) = context.observer {
            observer.reset_in_flight_turns();
        }
    }
    match pump_socket(
        socket,
        context.observer,
        context.caps,
        context.adapter,
        context.child_write_tx,
        child_outbound_rx,
    )
    .await
    {
        Ok(()) | Err(EraError::Transient) => EraEnd::Transient,
        Err(EraError::Fatal(error)) => EraEnd::Fatal(error),
    }
}

async fn pump_socket(
    socket: Socket,
    observer: Option<&AcpFrameObserver>,
    caps: &Arc<PodCapabilities>,
    adapter: &Arc<PromptAdapter>,
    child_write_tx: &mpsc::Sender<String>,
    child_outbound_rx: &mut mpsc::Receiver<String>,
) -> Result<(), EraError> {
    let (mut ws_write, mut ws_read) = socket.split();

    let (ws_send_tx, mut ws_send_rx) = mpsc::channel::<Message>(256);

    let ws_writer = tokio::spawn(async move {
        while let Some(message) = ws_send_rx.recv().await {
            if ws_write.send(message).await.is_err() {
                return Err(EraError::Transient);
            }
        }
        drop(ws_write.close().await);
        Ok(())
    });

    let ws_keepalive = {
        let ws_send_tx = ws_send_tx.clone();
        tokio::spawn(async move {
            let mut interval = tokio::time::interval(WS_KEEPALIVE_INTERVAL);
            interval.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            loop {
                interval.tick().await;
                if ws_send_tx
                    .send(Message::Ping(Vec::new().into()))
                    .await
                    .is_err()
                {
                    return Ok(());
                }
            }
        })
    };

    let ws_to_child = {
        let child_write_tx = child_write_tx.clone();
        let observer = observer.cloned();
        let caps = Arc::clone(caps);
        let adapter = Arc::clone(adapter);
        let ws_send_tx = ws_send_tx.clone();
        tokio::spawn(async move {
            while let Some(message) = ws_read.next().await {
                let message = message.map_err(|_| EraError::Transient)?;
                match message {
                    Message::Text(text) => {
                        let text = text.to_string();
                        validate_stdio_text_frame(&text).map_err(EraError::Fatal)?;
                        let text = adapter
                            .process_client_frame(&text)
                            .await
                            .map_err(EraError::Fatal)?;
                        // Pod capability termination: `initialize` capability
                        // rewrite + `session/new` cwd jail tracking. A
                        // re-initializing client on a later era is answered
                        // from the cached first-era child response; the child
                        // never sees a second `initialize`.
                        match caps.handle_client_frame(text.as_ref()).await {
                            ClientFrameAction::Forward(text) => {
                                if let Some(observer) = &observer {
                                    observer
                                        .observe(Direction::ClientToAgent, &text)
                                        .await
                                        .map_err(EraError::Fatal)?;
                                }
                                child_write_tx.send(text.into_owned()).await.map_err(|_| {
                                    EraError::Fatal(anyhow::anyhow!("ACP child writer closed"))
                                })?;
                            }
                            ClientFrameAction::Respond(response) => {
                                if let Some(observer) = &observer {
                                    observer
                                        .observe(Direction::AgentToClient, &response)
                                        .await
                                        .map_err(EraError::Fatal)?;
                                }
                                if ws_send_tx
                                    .send(Message::Text(response.into()))
                                    .await
                                    .is_err()
                                {
                                    return Err(EraError::Transient);
                                }
                            }
                            ClientFrameAction::ForwardAndRespond { forward, response } => {
                                if let Some(observer) = &observer {
                                    observer
                                        .observe(Direction::ClientToAgent, &forward)
                                        .await
                                        .map_err(EraError::Fatal)?;
                                }
                                child_write_tx.send(forward).await.map_err(|_| {
                                    EraError::Fatal(anyhow::anyhow!("ACP child writer closed"))
                                })?;
                                if let Some(observer) = &observer {
                                    observer
                                        .observe(Direction::AgentToClient, &response)
                                        .await
                                        .map_err(EraError::Fatal)?;
                                }
                                if ws_send_tx
                                    .send(Message::Text(response.into()))
                                    .await
                                    .is_err()
                                {
                                    return Err(EraError::Transient);
                                }
                            }
                        }
                    }
                    Message::Binary(_) => {
                        return Err(EraError::Fatal(anyhow::anyhow!(
                            "ACP WebSocket transport accepts text frames only"
                        )));
                    }
                    Message::Close(_) => break,
                    Message::Ping(_) | Message::Pong(_) | Message::Frame(_) => {}
                }
            }
            Ok(())
        })
    };

    let child_to_ws = async {
        while let Some(line) = child_outbound_rx.recv().await {
            if let Some(observer) = observer {
                observer
                    .observe(Direction::AgentToClient, &line)
                    .await
                    .map_err(EraError::Fatal)?;
            }
            if ws_send_tx.send(Message::Text(line.into())).await.is_err() {
                return Err(EraError::Transient);
            }
        }
        Ok(())
    };

    tokio::pin!(ws_to_child);
    tokio::pin!(child_to_ws);
    tokio::pin!(ws_writer);
    tokio::pin!(ws_keepalive);

    let result: Result<(), EraError> = tokio::select! {
        biased;
        result = &mut ws_to_child => {
            result.map_err(|error| EraError::Fatal(error.into()))?
        }
        result = &mut child_to_ws => {
            // The receiver only closes when the persistent child reader is
            // gone; that surfaces as the child_reader arm of the outer select.
            result?;
            Err(EraError::Fatal(anyhow::anyhow!(
                "ACP child outbound channel closed during socket era"
            )))
        }
        result = &mut ws_writer => {
            result.map_err(|error| EraError::Fatal(error.into()))?
        }
        result = &mut ws_keepalive => {
            result.map_err(|error| EraError::Fatal(error.into()))?
        }
    };

    // child_to_ws is a borrowed future over child_outbound_rx; it is dropped
    // at scope end along with its borrows.
    ws_writer.abort();
    ws_keepalive.abort();
    result
}

fn authenticated_request_url(ws_url: &str, token: Option<&str>) -> Result<String> {
    match token {
        Some(token) => {
            let mut url = Url::parse(ws_url).context("parse ACP WebSocket URL")?;
            url.query_pairs_mut().append_pair("token", token);
            Ok(url.into())
        }
        None => Ok(ws_url.to_owned()),
    }
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
    validate_frame(text)?;
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
    fn token_is_added_as_query_param_without_touching_path() {
        assert_eq!(
            authenticated_request_url("wss://api.example.com/ws", Some("secret")).unwrap(),
            "wss://api.example.com/ws?token=secret"
        );
        assert_eq!(
            authenticated_request_url("wss://api.example.com/ws?agent_id=a", Some("se cret"))
                .unwrap(),
            "wss://api.example.com/ws?agent_id=a&token=se+cret"
        );
        assert_eq!(
            authenticated_request_url("wss://api.example.com/ws", None).unwrap(),
            "wss://api.example.com/ws"
        );
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
