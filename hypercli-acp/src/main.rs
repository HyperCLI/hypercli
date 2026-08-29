use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use clap::{Parser, Subcommand};
use hypercli_acp::connectors::slack::{
    SlackRelayConfig, SlackRelayConfigError, SlackRelayConnector,
};
use hypercli_acp::{
    CanonicalAcpRuntimePlugin, Connector, ConnectorHost, CoreState, PlatformWsControlPlane,
    TraceStore,
};

#[derive(Debug, Parser)]
#[command(author, version, about)]
struct Args {
    #[command(subcommand)]
    command: Option<Command>,

    #[arg(long, env = "HYPERCLI_ACP_BIND", default_value = "127.0.0.1:8787")]
    bind: SocketAddr,
    #[arg(long, env = "HYPERCLI_ACP_CALLBACK_URL")]
    callback_url: Option<url::Url>,
    #[arg(
        long,
        env = "HYPERCLI_ACP_TRACE_DB",
        default_value = ".hypercli-acp/trace.sqlite3"
    )]
    trace_db: PathBuf,
}

#[derive(Debug, Subcommand)]
enum Command {
    /// Run the canonical HyperCLI ACP host and optional platform /ws control plane.
    Host,
    /// Run the Buzz compatibility plugin as a standalone relay-backed process.
    Buzz,
    /// Query available models from an ACP child runtime.
    Models,
    /// Query ACP child runtime authentication methods.
    AuthMethods,
    /// Start an ACP child runtime authentication flow.
    Authenticate,
    /// Compute a Buzz owner attestation tag.
    AuthTag,
}

fn main() -> anyhow::Result<()> {
    let command = std::env::args().nth(1);
    match command.as_deref() {
        Some("buzz") => return run_buzz_compat_with_wrapper_arg_removed(),
        Some("models" | "auth-methods" | "authenticate" | "auth-tag") => {
            return hypercli_buzz_acp::run();
        }
        Some("host") => return run_platform_host_with_wrapper_arg_removed(),
        None => {}
        Some(_) => {
            // Let clap render the authoritative error/help for unknown flags or commands.
            let _ = Args::parse();
        }
    }
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(run_platform_host_from_args(std::env::args()))
}

fn run_platform_host_with_wrapper_arg_removed() -> anyhow::Result<()> {
    let filtered = std::env::args()
        .enumerate()
        .filter_map(|(index, arg)| (index != 1).then_some(arg))
        .collect::<Vec<_>>();
    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(run_platform_host_from_args(filtered))
}

async fn run_platform_host_from_args<I, S>(args: I) -> anyhow::Result<()>
where
    I: IntoIterator<Item = S>,
    S: Into<std::ffi::OsString> + Clone,
{
    tracing_subscriber::fmt::init();
    let mut args = Args::parse_from(args);
    if matches!(args.command, Some(Command::Host)) {
        args.command = None;
    }
    let trace = TraceStore::open(&args.trace_db)?;
    let runtime = Arc::new(CanonicalAcpRuntimePlugin::new());
    let core = Arc::new(CoreState::with_trace(runtime, trace).await?);
    match SlackRelayConfig::from_env() {
        Ok(config) => {
            let mut connector = SlackRelayConnector::new(config);
            core.register_connector(Arc::new(connector.clone())).await;
            connector
                .start(ConnectorHost::new(Arc::clone(&core)))
                .await?;
            tracing::info!("enabled hosted Slack relay connector");
        }
        Err(SlackRelayConfigError::Disabled) => {}
        Err(error) => return Err(error.into()),
    }
    if let Some(callback_url) = args.callback_url {
        tracing::info!(url = %callback_url, "starting hypercli-acp outbound callback");
        PlatformWsControlPlane::outbound(callback_url)
            .run(core)
            .await
    } else {
        tracing::info!(bind = %args.bind, "starting hypercli-acp inbound listener");
        PlatformWsControlPlane::inbound(args.bind).run(core).await
    }
}

fn run_buzz_compat_with_wrapper_arg_removed() -> anyhow::Result<()> {
    let filtered = std::env::args()
        .enumerate()
        .filter_map(|(index, arg)| (index != 1).then_some(arg))
        .collect::<Vec<_>>();
    hypercli_buzz_acp::run_with_args(filtered)
}
