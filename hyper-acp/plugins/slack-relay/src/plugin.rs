//! Standalone Slack plugin lifecycle (phase-2/3 ingress skeleton).
//!
//! Boots as its own process behind `hyper-acp plugin slack`, spawns its own
//! ACP child via the official `agent-client-protocol` SDK, initializes with
//! protocol V1, and optionally runs the Slack relay ingress pipeline:
//! relay WS → durable accept → admission → per-scope queue, with a log-only
//! flush consumer until phase 4 wires the agent pool. Shuts down cleanly on
//! Ctrl-C/SIGTERM.
//!
//! The legacy frame-splice path in `crates/hyper-acp` is untouched and keeps
//! working in parallel until the cutover phase.

use std::path::PathBuf;
use std::time::Duration;

use agent_client_protocol::schema::v1::{
    InitializeRequest, RequestPermissionOutcome, RequestPermissionRequest,
    RequestPermissionResponse, SelectedPermissionOutcome, SessionNotification,
};
use agent_client_protocol::schema::ProtocolVersion;
use agent_client_protocol::{AcpAgent, AcpAgentConfig, Agent, Client, ConnectionTo};
use anyhow::{Context, Result};
use clap::Parser;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tracing_subscriber::EnvFilter;

use crate::config::{CliArgs, Config};
use crate::monitor::provider::{
    self, run_slack_relay_to_queue_with_control, ActiveSlackRelayConfig, ActiveSlackRelayControl,
    ActiveSlackRelayError, HYPER_ACP_SLACK_ACCOUNT_ID_ENV, HYPER_ACP_SLACK_DURABLE_LOG_ENV,
    HYPER_ACP_SLACK_GATEWAY_ID_ENV, HYPER_ACP_SLACK_RELAY_API_URL_ENV,
    HYPER_ACP_SLACK_RELAY_URL_ENV,
};
use crate::monitor::relay_source::SlackRelaySourceConfig;
use crate::queue::{SharedSlackEventQueue, SlackEventQueue};

/// Placeholder session id for the skeleton relay sink.
///
/// The re-parent deletes the global `HYPER_ACP_SLACK_SESSION_ID`; per-scope
/// sessions land in a later phase. This value only feeds the durable log path
/// and the legacy frame path inside the sink.
const PLUGIN_OWNED_SESSION_ID: &str = "plugin-owned";

/// Timeout for the relay task to finish after `ActiveSlackRelayControl::Shutdown`.
const RELAY_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

/// Handles for the optional relay ingress task and its queue flush consumer.
#[derive(Debug)]
struct RelayIngress {
    control_tx: mpsc::Sender<ActiveSlackRelayControl>,
    relay_task: JoinHandle<Result<(), ActiveSlackRelayError>>,
    flush_task: JoinHandle<()>,
}

/// Run the Slack plugin from `hyper-acp plugin slack`.
///
/// Prepends the synthetic argv[0] (`slack-acp`) so clap sees the same shape
/// as a standalone binary invocation.
///
/// # Errors
///
/// Returns an error when configuration, agent spawn/initialize, or the relay
/// loop fails.
pub fn run_from_hyper_acp<I, T>(args: I) -> Result<()>
where
    I: IntoIterator<Item = T>,
    T: Into<String>,
{
    let args = std::iter::once(String::from("slack-acp")).chain(args.into_iter().map(Into::into));
    run_plugin(args)
}

/// Shared Slack plugin entrypoint: build the tokio runtime and run.
///
/// # Errors
///
/// Returns an error when the runtime cannot be built or the plugin fails.
pub fn run_plugin<I, T>(args: I) -> Result<()>
where
    I: IntoIterator<Item = T>,
    T: Into<String>,
{
    let args = args.into_iter().map(Into::into).collect();
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(tokio_main(args))
}

async fn tokio_main(args: Vec<String>) -> Result<()> {
    // Install the ring crypto provider for rustls (required for wss:// relay connections).
    drop(rustls::crypto::ring::default_provider().install_default());

    tracing_subscriber::fmt()
        .with_env_filter(
            EnvFilter::try_from_default_env()
                .unwrap_or_else(|_| EnvFilter::new("hyper_acp_slack_relay=info")),
        )
        .with_writer(std::io::stderr)
        .init();

    let cli_args = CliArgs::parse_from(args);
    let config = Config::from_args(cli_args)
        .map_err(|error| anyhow::anyhow!("configuration error: {error}"))?;
    tracing::info!("slack-acp starting: {}", config.summary());

    let relay = relay_config_from_env().context("failed to build Slack relay config")?;
    if relay.is_some() {
        eprintln!(
            "slack plugin skeleton: dispatch to agent not wired; events are durably queued — do not point at a live relay"
        );
    }

    let agent =
        AcpAgent::new(AcpAgentConfig::new(&config.agent_command).args(config.agent_args.clone()));

    Client
        .builder()
        .on_receive_notification(
            async move |notification: SessionNotification, _cx| {
                tracing::debug!(update = ?notification.update, "session/update (skeleton sink)");
                Ok(())
            },
            agent_client_protocol::on_receive_notification!(),
        )
        .on_receive_request(
            async move |request: RequestPermissionRequest, responder, _connection| {
                // YOLO: auto-approve by selecting the first option (buzz parity).
                if let Some(option) = request.options.first() {
                    responder.respond(RequestPermissionResponse::new(
                        RequestPermissionOutcome::Selected(SelectedPermissionOutcome::new(
                            option.option_id.clone(),
                        )),
                    ))
                } else {
                    tracing::warn!("permission request carried no options; cancelling");
                    responder.respond(RequestPermissionResponse::new(
                        RequestPermissionOutcome::Cancelled,
                    ))
                }
            },
            agent_client_protocol::on_receive_request!(),
        )
        .connect_with(agent, |connection: ConnectionTo<Agent>| async move {
            let initialize = connection
                .send_request(InitializeRequest::new(ProtocolVersion::V1))
                .block_task()
                .await?;
            tracing::info!(agent_info = ?initialize.agent_info, "slack-acp: agent initialized");

            let relay = relay.map(|relay_config| {
                start_relay_ingress(relay_config, config.session_policy, config.dedup_mode)
            });
            run_until_shutdown(relay).await.map_err(|error| {
                agent_client_protocol::Error::internal_error().data(error.to_string())
            })
        })
        .await
        .context("slack plugin agent connection failed")
}

/// Build the relay config directly from env, bypassing
/// `ActiveSlackRelayConfig::from_env` (which hard-requires the deleted global
/// `HYPER_ACP_SLACK_SESSION_ID`).
fn relay_config_from_env() -> Result<Option<ActiveSlackRelayConfig>> {
    let Some(url) = env_var_with_legacy(HYPER_ACP_SLACK_RELAY_URL_ENV) else {
        return Ok(None);
    };
    let gateway_id = env_var_with_legacy(HYPER_ACP_SLACK_GATEWAY_ID_ENV).ok_or_else(|| {
        anyhow::anyhow!("{HYPER_ACP_SLACK_GATEWAY_ID_ENV} is required when Slack relay is enabled")
    })?;
    let relay = SlackRelaySourceConfig::from_hyper_agents_env(url, gateway_id)?;
    let account_id = env_var_with_legacy(HYPER_ACP_SLACK_ACCOUNT_ID_ENV)
        .unwrap_or_else(|| relay.gateway_id.clone());
    let policy = provider::build_policy_from_env(
        account_id,
        env_var_with_legacy(HYPER_ACP_SLACK_RELAY_API_URL_ENV)
            .or_else(|| provider::derive_relay_api_base_url(&relay.url)),
    );
    let durable_log_path = env_var_with_legacy(HYPER_ACP_SLACK_DURABLE_LOG_ENV).map(PathBuf::from);
    Ok(Some(ActiveSlackRelayConfig {
        relay,
        session_id: PLUGIN_OWNED_SESSION_ID.to_owned(),
        policy,
        durable_log_path,
    }))
}

/// Read a `HYPER_ACP_SLACK_*` env var with `HYPER_SLACK_*` legacy fallback,
/// mirroring the env resolution in `monitor::provider`.
fn env_var_with_legacy(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            let legacy = name.strip_prefix("HYPER_ACP_SLACK_")?;
            std::env::var(format!("HYPER_SLACK_{legacy}"))
                .ok()
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty())
        })
}

/// Spawn the relay ingress loop (durable accept → admission → scope → queue)
/// plus the phase-3 flush consumer, which dequeues envelopes, logs them, and
/// immediately marks them complete. Phase 4 replaces the log with pool dispatch.
fn start_relay_ingress(
    config: ActiveSlackRelayConfig,
    session_policy: crate::scope::SessionPolicy,
    dedup_mode: crate::config::DedupMode,
) -> RelayIngress {
    let queue: SharedSlackEventQueue =
        std::sync::Arc::new(tokio::sync::Mutex::new(SlackEventQueue::new(dedup_mode)));
    let (control_tx, control_rx) = mpsc::channel(1);
    let relay_task = tokio::spawn(run_slack_relay_to_queue_with_control(
        config,
        queue.clone(),
        session_policy,
        Some(control_rx),
    ));
    let flush_task = tokio::spawn(run_flush_logger(queue));
    RelayIngress {
        control_tx,
        relay_task,
        flush_task,
    }
}

/// Phase-3 queue consumer: dequeue + log + complete. The log line carries
/// only the truncated scope label + text length (never full ids/prompts).
async fn run_flush_logger(queue: SharedSlackEventQueue) {
    let mut tick = tokio::time::interval(Duration::from_millis(200));
    loop {
        tick.tick().await;
        loop {
            let flushed = queue.lock().await.flush_next();
            let Some(batch) = flushed else { break };
            let text_bytes: usize = batch
                .events
                .iter()
                .map(|event| event.prompt_text.len())
                .sum();
            tracing::info!(
                scope = %batch.scope.telemetry_label(),
                events = batch.events.len(),
                text_bytes,
                "slack plugin: dequeued envelope (dispatch to agent not wired)"
            );
            queue.lock().await.mark_complete(&batch.scope);
        }
    }
}

/// Why the main wait loop ended.
#[derive(Debug)]
enum RelayExit {
    Finished(std::result::Result<Result<(), ActiveSlackRelayError>, tokio::task::JoinError>),
    Shutdown,
}

/// Park until the relay task ends or a shutdown signal fires. On shutdown the
/// relay is asked to stop and awaited with a bounded timeout; returning ends
/// the ACP connection (and kills the child) in the caller.
async fn run_until_shutdown(relay: Option<RelayIngress>) -> Result<()> {
    let Some(RelayIngress {
        control_tx,
        mut relay_task,
        flush_task,
    }) = relay
    else {
        shutdown_signal().await;
        tracing::info!("slack-acp: shutdown signal received");
        return Ok(());
    };

    let exit = tokio::select! {
        result = &mut relay_task => RelayExit::Finished(result),
        () = shutdown_signal() => RelayExit::Shutdown,
    };

    match exit {
        RelayExit::Finished(result) => {
            flush_task.abort();
            match result {
                Ok(Ok(())) => Ok(()),
                Ok(Err(error)) => Err(anyhow::anyhow!("slack relay task failed: {error}")),
                Err(join_error) => Err(anyhow::anyhow!(
                    "slack relay task join failed: {join_error}"
                )),
            }
        }
        RelayExit::Shutdown => {
            tracing::info!("slack-acp: shutdown signal received; stopping relay");
            let _ignored = control_tx.send(ActiveSlackRelayControl::Shutdown).await;
            match tokio::time::timeout(RELAY_SHUTDOWN_TIMEOUT, relay_task).await {
                Ok(Ok(Ok(()))) => {}
                Ok(Ok(Err(error))) => {
                    tracing::warn!("slack relay shutdown completed with error: {error}");
                }
                Ok(Err(join_error)) => {
                    tracing::warn!("slack relay task join failed: {join_error}");
                }
                Err(_) => tracing::warn!("timed out waiting for slack relay shutdown"),
            }
            flush_task.abort();
            Ok(())
        }
    }
}

/// Wait for Ctrl-C or (on unix) SIGTERM.
async fn shutdown_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{signal, SignalKind};
        let mut sigterm = match signal(SignalKind::terminate()) {
            Ok(sigterm) => sigterm,
            Err(error) => {
                tracing::warn!(
                    "failed to install SIGTERM handler ({error}); only Ctrl-C will shut down"
                );
                let _ignored = tokio::signal::ctrl_c().await;
                return;
            }
        };
        tokio::select! {
            result = tokio::signal::ctrl_c() => {
                if let Err(error) = result {
                    tracing::warn!("failed to listen for Ctrl-C: {error}");
                }
            }
            _ignored = sigterm.recv() => {}
        }
    }
    #[cfg(not(unix))]
    {
        let _ignored = tokio::signal::ctrl_c().await;
    }
}
