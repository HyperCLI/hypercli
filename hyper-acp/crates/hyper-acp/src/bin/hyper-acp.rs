#![allow(
    clippy::doc_markdown,
    clippy::multiple_crate_versions,
    clippy::struct_field_names
)]

//! `hyper-acp` raw ACP transport binary.
//!
//! License: Apache-2.0. The binary transports canonical ACP JSON-RPC frames
//! unchanged between a local ACP stdio child and either local stdio or an
//! outbound WebSocket `/ws` endpoint.

use anyhow::{Context, Result, bail};
use clap::Parser;
use hyper_acp::plugin::PluginRegistry;
use hyper_acp::trace::{DEFAULT_MAX_TRACE_ROWS, TraceStore};
use hyper_acp::transport::AcpFrameObserver;
#[cfg(feature = "slack-relay")]
use hyper_acp::transport::ObservedAcpFrame;
use hyper_acp_buzz as buzz_plugin;
#[cfg(feature = "slack-relay")]
use hyper_acp_slack_relay::active::{
    ActiveSlackRelayControl, ActiveSlackRelayError,
    run_slack_relay_to_acp_client_frames_with_control,
};
#[cfg(feature = "slack-relay")]
use hyper_acp_slack_relay::output::{
    SlackAcpFrameDirection, SlackAcpObservedFrame, SlackAcpOutputConfig, SlackAcpOutputError,
    run_slack_acp_output_to_replies,
};
use std::env;
use std::path::PathBuf;
use std::sync::Arc;
#[cfg(feature = "slack-relay")]
use std::time::Duration;
use tokio::process::Command;
use tokio::sync::mpsc;
#[cfg(feature = "slack-relay")]
use tokio::task::JoinHandle;
use tracing_subscriber::EnvFilter;

#[derive(Debug, Parser)]
#[command(name = "hyper-acp")]
#[command(about = "Raw canonical ACP JSON-RPC transport")]
struct Args {
    /// Optional outbound raw ACP WebSocket URL. The path must be /ws.
    #[arg(long, env = "HYPER_ACP_WS_URL")]
    ws_url: Option<String>,

    /// ACP-speaking child command to launch over stdio.
    #[arg(long, env = "HYPER_ACP_AGENT_COMMAND")]
    agent_command: String,

    /// Arguments passed to the ACP-speaking child command.
    #[arg(
        long = "agent-arg",
        env = "HYPER_ACP_AGENT_ARGS",
        value_delimiter = ' '
    )]
    agent_args: Vec<String>,

    /// Optional metadata-only SQLite trace database.
    #[arg(long, env = "HYPER_ACP_TRACE_DB")]
    trace_db: Option<PathBuf>,

    /// Maximum trace rows retained when tracing is enabled.
    #[arg(
        long,
        env = "HYPER_ACP_TRACE_MAX_ROWS",
        default_value_t = DEFAULT_MAX_TRACE_ROWS
    )]
    trace_max_rows: usize,
}

fn main() -> Result<()> {
    install_rustls_crypto_provider();

    let raw_args: Vec<String> = env::args().collect();
    match (
        raw_args.get(1).map(String::as_str),
        raw_args.get(2).map(String::as_str),
    ) {
        (Some("plugin"), Some("buzz")) => return run_buzz_plugin(&raw_args[3..]),
        (Some("plugin"), Some("models" | "auth-methods" | "authenticate" | "auth-tag")) => {
            return run_buzz_plugin(&raw_args[2..]);
        }
        (Some("plugin"), _) => {
            print_plugin_help();
            return Ok(());
        }
        _ => {}
    }

    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(run_host())
}

fn install_rustls_crypto_provider() {
    drop(rustls::crypto::ring::default_provider().install_default());
}

async fn run_host() -> Result<()> {
    tracing_subscriber::fmt()
        .with_env_filter(EnvFilter::from_default_env())
        .with_writer(std::io::stderr)
        .init();

    let args = Args::parse();
    let trace = args
        .trace_db
        .as_deref()
        .map(|path| {
            TraceStore::open(path, args.trace_max_rows)
                .with_context(|| format!("open trace db {}", path.display()))
        })
        .transpose()?;

    let child = child_command(&args)?;
    let plugins = Arc::new(PluginRegistry::new());
    let frame_sources = start_client_frame_sources()?;
    let result = if let Some(ws_url) = args.ws_url {
        hyper_acp::transport::outbound_ws::run_with_client_frame_source_and_observer(
            ws_url,
            child,
            trace,
            plugins,
            frame_sources.client_frames,
            frame_sources.observer,
        )
        .await
    } else {
        hyper_acp::transport::stdio::run_with_client_frame_source_and_observer(
            child,
            trace,
            plugins,
            frame_sources.client_frames,
            frame_sources.observer,
        )
        .await
    };
    shutdown_client_frame_sources(frame_sources.shutdown).await;
    result
}

fn print_plugin_help() {
    println!(
        "Usage: hyper-acp plugin <COMMAND> [ARGS]\n\nCommands:\n  buzz           Run the full Buzz ACP plugin\n  models         Delegate to Buzz plugin models\n  auth-methods   Delegate to Buzz plugin auth-methods\n  authenticate   Delegate to Buzz plugin authenticate\n  auth-tag       Delegate to Buzz plugin auth-tag"
    );
}

fn child_command(args: &Args) -> Result<Command> {
    if args.agent_command.is_empty() {
        bail!("missing ACP child command");
    }
    let mut child = Command::new(&args.agent_command);
    child.args(&args.agent_args);
    Ok(child)
}

fn run_buzz_plugin(plugin_args: &[String]) -> Result<()> {
    buzz_plugin::run_from_hyper_acp(plugin_args.iter().cloned())
}

#[cfg(feature = "slack-relay")]
#[derive(Debug)]
struct SlackRelayShutdown {
    control_tx: mpsc::Sender<ActiveSlackRelayControl>,
    task: JoinHandle<Result<(), ActiveSlackRelayError>>,
}

#[cfg(feature = "slack-relay")]
#[derive(Debug)]
struct SlackOutputShutdown {
    adapter_task: JoinHandle<()>,
    task: JoinHandle<Result<(), SlackAcpOutputError>>,
}

#[cfg(feature = "slack-relay")]
#[derive(Debug)]
struct FrameSourceShutdown {
    slack_relay: Option<SlackRelayShutdown>,
    slack_output: Option<SlackOutputShutdown>,
}

#[cfg(not(feature = "slack-relay"))]
type FrameSourceShutdown = ();

#[derive(Debug)]
struct ClientFrameSources {
    client_frames: Option<mpsc::Receiver<String>>,
    observer: Option<AcpFrameObserver>,
    shutdown: FrameSourceShutdown,
}

#[cfg(feature = "slack-relay")]
fn start_client_frame_sources() -> Result<ClientFrameSources> {
    let active_config = hyper_acp_slack_relay::active::ActiveSlackRelayConfig::from_env()?;
    let relay_url = active_config
        .as_ref()
        .map(|config| config.relay.url.as_str());
    let slack_output_config = SlackAcpOutputConfig::from_env(relay_url)?;
    let (observer, slack_output) =
        slack_output_config.map_or((None, None), start_slack_output_processor);
    let (client_frames, slack_relay) = if let Some(config) = active_config {
        let (client_frames_tx, client_frames_rx) = mpsc::channel(256);
        let (control_tx, control_rx) = mpsc::channel(1);
        let task = tokio::spawn(run_slack_relay_to_acp_client_frames_with_control(
            config,
            client_frames_tx,
            Some(control_rx),
        ));
        (
            Some(client_frames_rx),
            Some(SlackRelayShutdown { control_tx, task }),
        )
    } else {
        (None, None)
    };
    Ok(ClientFrameSources {
        client_frames,
        observer,
        shutdown: FrameSourceShutdown {
            slack_relay,
            slack_output,
        },
    })
}

#[cfg(not(feature = "slack-relay"))]
fn start_client_frame_sources() -> Result<ClientFrameSources> {
    Ok(ClientFrameSources {
        client_frames: None,
        observer: None,
        shutdown: (),
    })
}

#[cfg(feature = "slack-relay")]
fn start_slack_output_processor(
    config: SlackAcpOutputConfig,
) -> (Option<AcpFrameObserver>, Option<SlackOutputShutdown>) {
    let (observed_tx, mut observed_rx) = mpsc::channel::<ObservedAcpFrame>(256);
    let (slack_tx, slack_rx) = mpsc::channel::<SlackAcpObservedFrame>(256);
    let adapter_task = tokio::spawn(async move {
        while let Some(frame) = observed_rx.recv().await {
            let direction = match frame.direction {
                hyper_acp::trace::Direction::ClientToAgent => SlackAcpFrameDirection::ClientToAgent,
                hyper_acp::trace::Direction::AgentToClient => SlackAcpFrameDirection::AgentToClient,
            };
            if slack_tx
                .send(SlackAcpObservedFrame {
                    direction,
                    text: frame.text,
                })
                .await
                .is_err()
            {
                break;
            }
        }
    });
    let task = tokio::spawn(run_slack_acp_output_to_replies(config, slack_rx));
    (
        Some(AcpFrameObserver::new(observed_tx)),
        Some(SlackOutputShutdown { adapter_task, task }),
    )
}

#[cfg(feature = "slack-relay")]
async fn shutdown_client_frame_sources(shutdown: FrameSourceShutdown) {
    if let Some(slack_relay) = shutdown.slack_relay {
        let _send_result = slack_relay
            .control_tx
            .send(ActiveSlackRelayControl::Shutdown)
            .await;
        if let Ok(joined) = tokio::time::timeout(Duration::from_secs(5), slack_relay.task).await {
            match joined {
                Ok(Ok(())) => {}
                Ok(Err(error)) => eprintln!("Slack relay shutdown completed with error: {error}"),
                Err(error) => eprintln!("Slack relay task join failed: {error}"),
            }
        }
    }
    if let Some(slack_output) = shutdown.slack_output {
        if let Ok(Err(error)) =
            tokio::time::timeout(Duration::from_secs(5), slack_output.adapter_task).await
        {
            eprintln!("Slack output adapter task join failed: {error}");
        }
        if let Ok(joined) = tokio::time::timeout(Duration::from_secs(5), slack_output.task).await {
            match joined {
                Ok(Ok(())) => {}
                Ok(Err(error)) => eprintln!("Slack output delivery completed with error: {error}"),
                Err(error) => eprintln!("Slack output task join failed: {error}"),
            }
        }
    }
}

#[cfg(not(feature = "slack-relay"))]
async fn shutdown_client_frame_sources(_shutdown: FrameSourceShutdown) {}
