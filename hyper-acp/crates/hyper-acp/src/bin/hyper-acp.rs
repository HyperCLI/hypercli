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

use anyhow::{Result, bail};
use clap::Parser;
use hyper_acp_buzz as buzz_plugin;
use std::env;
use tokio::process::Command;
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
}

fn main() -> Result<()> {
    install_rustls_crypto_provider();

    let raw_args: Vec<String> = env::args().collect();
    match (
        raw_args.get(1).map(String::as_str),
        raw_args.get(2).map(String::as_str),
    ) {
        (Some("plugin"), Some("buzz")) => return run_buzz_plugin(&raw_args[3..]),
        (Some("plugin"), Some("slack")) => return run_slack_plugin(&raw_args[3..]),
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
    let child = child_command(&args)?;
    if let Some(ws_url) = args.ws_url {
        Box::pin(hyper_acp::transport::outbound_ws::run(ws_url, child)).await
    } else {
        hyper_acp::transport::stdio::run(child).await
    }
}

fn print_plugin_help() {
    println!(
        "Usage: hyper-acp plugin <COMMAND> [ARGS]\n\nCommands:\n  buzz           Run the full Buzz ACP plugin\n  slack          Run the standalone Slack ACP plugin\n  models         Delegate to Buzz plugin models\n  auth-methods   Delegate to Buzz plugin auth-methods\n  authenticate   Delegate to Buzz plugin authenticate\n  auth-tag       Delegate to Buzz plugin auth-tag"
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

fn run_slack_plugin(plugin_args: &[String]) -> Result<()> {
    hyper_acp_slack_relay::plugin::run_from_hyper_acp(plugin_args.iter().cloned())
}
