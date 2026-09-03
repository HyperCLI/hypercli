//! Standalone Slack plugin lifecycle (ACP core + pool dispatch).
//!
//! Boots as its own process behind `hyper-acp plugin slack`, runs the Slack
//! relay ingress pipeline (relay WS → durable accept → admission → per-scope
//! queue), and dispatches queued envelopes to the buzz-shaped worker pool in
//! [`crate::pool`]: one ACP child per pool slot, per-scope sessions, Slack
//! replies delivered through the existing relay-proxy delivery path. Shuts
//! down cleanly on Ctrl-C/SIGTERM.
//!
//! The legacy frame-splice path in `crates/hyper-acp` is untouched and keeps
//! working in parallel until the cutover phase.

use std::path::PathBuf;
use std::sync::Arc;
use std::time::Duration;

use anyhow::{Context, Result};
use clap::Parser;
use tokio::sync::mpsc;
use tokio::task::JoinHandle;
use tokio_util::sync::CancellationToken;
use tracing_subscriber::EnvFilter;

use crate::config::{CliArgs, Config};
use crate::monitor::ingress::{DurableSlackRelayStore, SharedSlackRelayStore};
use crate::monitor::provider::{
    self, run_slack_relay_to_queue_with_control, ActiveSlackRelayConfig, ActiveSlackRelayControl,
    ActiveSlackRelayError, HYPER_ACP_SLACK_ACCOUNT_ID_ENV, HYPER_ACP_SLACK_DURABLE_LOG_ENV,
    HYPER_ACP_SLACK_GATEWAY_ID_ENV, HYPER_ACP_SLACK_RELAY_API_URL_ENV,
    HYPER_ACP_SLACK_RELAY_URL_ENV,
};
use crate::monitor::relay_source::SlackRelaySourceConfig;
use crate::monitor::replies::SlackRelayHttpSender;
use crate::pool::{
    run_turn, AgentPool, DeliveryTarget, DispatchContext, TurnDisposition, TurnOutcome,
};
use crate::queue::{MultipleEventHandling, QueueFinish, SharedSlackEventQueue, SlackEventQueue};

/// Timeout for the relay task to finish after `ActiveSlackRelayControl::Shutdown`.
const RELAY_SHUTDOWN_TIMEOUT: Duration = Duration::from_secs(5);

/// Interval between pool maintenance / queue flush passes.
const DISPATCH_TICK: Duration = Duration::from_millis(200);

/// Handles for the optional relay ingress + pool dispatch tasks.
#[derive(Debug)]
struct RelayDispatch {
    control_tx: mpsc::Sender<ActiveSlackRelayControl>,
    relay_task: JoinHandle<Result<(), ActiveSlackRelayError>>,
    dispatch_cancel: CancellationToken,
    dispatch_task: JoinHandle<()>,
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

    let cancel = CancellationToken::new();
    let signal_cancel = cancel.clone();
    tokio::spawn(async move {
        shutdown_signal().await;
        tracing::info!("slack-acp: shutdown signal received");
        signal_cancel.cancel();
    });
    run(config, relay, &cancel).await
}

/// Run the plugin against validated config + optional relay config until
/// `cancel` fires. Factored out of CLI/env plumbing for integration tests.
///
/// # Errors
///
/// Returns an error when the relay loop fails.
pub async fn run(
    config: Config,
    relay: Option<ActiveSlackRelayConfig>,
    cancel: &CancellationToken,
) -> Result<()> {
    let Some(relay_config) = relay else {
        tracing::warn!(
            "no Slack relay configured (set {HYPER_ACP_SLACK_RELAY_URL_ENV}); idling until shutdown"
        );
        cancel.cancelled().await;
        return Ok(());
    };

    let harness = Arc::new(config);
    // One shared JSONL store for the relay loop (claims/dispatches) and the
    // pool (turn-terminal commits).
    let store = SharedSlackRelayStore::open(provider::relay_durable_log_path(&relay_config))?;
    let dispatch = start_relay_dispatch(relay_config, harness, store, cancel);
    run_until_shutdown(dispatch, cancel).await
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
        session_id: relay.gateway_id.clone(),
        relay,
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
/// and the dispatch loop (queue flush → pool claim → turn → Slack delivery).
fn start_relay_dispatch(
    config: ActiveSlackRelayConfig,
    harness: Arc<Config>,
    store: SharedSlackRelayStore,
    cancel: &CancellationToken,
) -> RelayDispatch {
    let queue: SharedSlackEventQueue = Arc::new(tokio::sync::Mutex::new(SlackEventQueue::new(
        harness.dedup_mode,
    )));
    let ctx = Arc::new(DispatchContext {
        cwd: std::env::current_dir().unwrap_or_else(|_| PathBuf::from("/")),
        delivery: config
            .policy
            .relay_api_base_url
            .as_ref()
            .map(|base| DeliveryTarget {
                relay_api_base_url: base.clone(),
                hyper_agents_api_key: config.relay.auth_token.clone(),
                sender: SlackRelayHttpSender::new(),
            }),
        store: store.clone(),
        config: harness.clone(),
    });

    let (control_tx, control_rx) = mpsc::channel(1);
    let relay_task = tokio::spawn(run_slack_relay_to_queue_with_control(
        config,
        queue.clone(),
        harness.session_policy,
        store,
        Some(control_rx),
    ));
    let dispatch_cancel = cancel.child_token();
    let dispatch_task = tokio::spawn(dispatch_loop(queue, ctx, harness, dispatch_cancel.clone()));
    RelayDispatch {
        control_tx,
        relay_task,
        dispatch_cancel,
        dispatch_task,
    }
}

/// Dispatch loop: per tick, respawn dead slots (circuit-breaker aware), poke
/// interrupts for in-flight scopes with queued events (interrupt mode), then
/// flush the queue claiming workers per batch. Turn outcomes arrive over an
/// unbounded channel and drive queue requeue/complete bookkeeping here (single
/// owner of the queue's consumer side).
async fn dispatch_loop(
    queue: SharedSlackEventQueue,
    ctx: Arc<DispatchContext>,
    harness: Arc<Config>,
    cancel: CancellationToken,
) {
    let mut pool = AgentPool::new(usize::try_from(harness.agents).unwrap_or(1).max(1));
    let (turn_tx, mut turn_rx) = mpsc::unbounded_channel::<TurnOutcome>();
    let mut tick = tokio::time::interval(DISPATCH_TICK);

    loop {
        tokio::select! {
            () = cancel.cancelled() => break,
            Some(outcome) = turn_rx.recv() => {
                handle_turn_outcome(&queue, &mut pool, &ctx.store, outcome).await;
            }
            _ = tick.tick() => {
                pool.respawn_needed_slots(&ctx).await;

                if harness.mode == MultipleEventHandling::Interrupt {
                    for scope in pool.in_flight_scopes() {
                        let pending = queue.lock().await.queued_event_count(&scope);
                        if pending > 0 && pool.interrupt(&scope) {
                            tracing::info!(
                                scope = %scope.telemetry_label(),
                                pending,
                                "interrupting in-flight turn: new events queued"
                            );
                        }
                    }
                }

                loop {
                    let Some(batch) = queue.lock().await.flush_next() else {
                        break;
                    };
                    let Some(worker) = pool.claim(&batch.scope) else {
                        // Owner busy / no idle slot: hold the batch (no retry
                        // penalty) and stop the pass (buzz held-batch parity).
                        let scope = batch.scope.clone();
                        let mut guard = queue.lock().await;
                        guard.requeue_preserve_timestamps(batch);
                        guard.mark_complete(&scope);
                        break;
                    };
                    let turn_tx = turn_tx.clone();
                    let ctx = ctx.clone();
                    tokio::spawn(async move {
                        let outcome = run_turn(worker, batch, ctx).await;
                        let _ignored = turn_tx.send(outcome);
                    });
                }
            }
        }
    }

    pool.shutdown_all().await;
    tracing::info!("slack-acp: dispatch loop stopped");
}

/// Apply one finished turn to the queue, durable store, and pool.
///
/// Durable `Commit` records are written exactly at terminal outcomes (turn
/// success, dead-letter); transient releases (retry backoff, interrupt-merge)
/// stay uncommitted so a crash replays them (at-least-once).
async fn handle_turn_outcome(
    queue: &SharedSlackEventQueue,
    pool: &mut AgentPool,
    store: &SharedSlackRelayStore,
    outcome: TurnOutcome,
) {
    let TurnOutcome {
        slot,
        worker,
        disposition,
        batch,
    } = outcome;
    let scope = batch.scope.clone();
    pool.clear_in_flight(&scope);

    let mut guard = queue.lock().await;
    match disposition {
        TurnDisposition::Completed(stop_reason) => {
            tracing::info!(
                scope = %scope.telemetry_label(),
                stop_reason = ?stop_reason,
                slot,
                "turn completed"
            );
            commit_batch_events(store, &batch.events);
            let _finished = guard.finish(batch, QueueFinish::Complete);
        }
        TurnDisposition::Interrupted => {
            let _finished = guard.finish(batch, QueueFinish::Preserve);
        }
        TurnDisposition::Failed(kind) => {
            tracing::warn!(scope = %scope.telemetry_label(), slot, failure = ?kind, "turn failed");
            let dead = guard.finish(batch, QueueFinish::Retry);
            if let Some(dead) = dead {
                tracing::error!(
                    scope = %scope.telemetry_label(),
                    events = dead.events.len(),
                    "batch dead-lettered: retry budget exhausted"
                );
                // Poison-pill protection: dead-lettered events commit durably
                // so they do not retry forever across restarts.
                commit_batch_events(store, &dead.events);
            }
        }
    }
    drop(guard);

    match worker {
        Some(worker) => pool.checkin(worker),
        None => pool.record_failure(slot),
    }
}

/// Best-effort durable `Commit` write per batch event; a store failure here
/// only widens the replay window (at-least-once), never loses events.
fn commit_batch_events(store: &SharedSlackRelayStore, events: &[crate::queue::QueuedSlackEvent]) {
    let mut store = store.clone();
    for event in events {
        let Some(record) = event.to_terminal_commit_record() else {
            continue;
        };
        if let Err(error) = store.accept(&record) {
            tracing::warn!(
                delivery_id = %event.delivery_id,
                "durable terminal commit failed (event may replay once on restart): {error}"
            );
        }
    }
}

/// Why the main wait loop ended.
#[derive(Debug)]
enum RelayExit {
    Finished(std::result::Result<Result<(), ActiveSlackRelayError>, tokio::task::JoinError>),
    Shutdown,
}

/// Park until the relay task ends or `cancel` fires. On cancel the relay is
/// asked to stop and awaited with a bounded timeout, then the dispatch loop is
/// cancelled and awaited (pool shutdown kills worker children).
async fn run_until_shutdown(dispatch: RelayDispatch, cancel: &CancellationToken) -> Result<()> {
    let RelayDispatch {
        control_tx,
        mut relay_task,
        dispatch_cancel,
        dispatch_task,
    } = dispatch;

    let exit = tokio::select! {
        result = &mut relay_task => RelayExit::Finished(result),
        () = cancel.cancelled() => RelayExit::Shutdown,
    };

    match exit {
        RelayExit::Finished(result) => {
            dispatch_cancel.cancel();
            let _ignored = tokio::time::timeout(RELAY_SHUTDOWN_TIMEOUT, dispatch_task).await;
            match result {
                Ok(Ok(())) => Ok(()),
                Ok(Err(error)) => Err(anyhow::anyhow!("slack relay task failed: {error}")),
                Err(join_error) => Err(anyhow::anyhow!(
                    "slack relay task join failed: {join_error}"
                )),
            }
        }
        RelayExit::Shutdown => {
            tracing::info!("slack-acp: stopping relay");
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
            dispatch_cancel.cancel();
            let _ignored = tokio::time::timeout(RELAY_SHUTDOWN_TIMEOUT, dispatch_task).await;
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
