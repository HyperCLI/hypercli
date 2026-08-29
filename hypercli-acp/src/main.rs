use std::net::SocketAddr;
use std::path::PathBuf;
use std::sync::Arc;

use clap::Parser;
use hypercli_acp::connectors::slack::{
    SlackRelayConfig, SlackRelayConfigError, SlackRelayConnector,
};
use hypercli_acp::{ws, Connector, ConnectorHost, CoreState, StubRuntime, TraceStore};

#[derive(Debug, Parser)]
#[command(author, version, about)]
struct Args {
    #[arg(long, env = "HYPERCLI_ACP_BIND", default_value = "127.0.0.1:8787")]
    bind: SocketAddr,
    #[arg(
        long,
        env = "HYPERCLI_ACP_TRACE_DB",
        default_value = ".hypercli-acp/trace.sqlite3"
    )]
    trace_db: PathBuf,
}

fn main() -> anyhow::Result<()> {
    if should_run_hosted_buzz_mode() {
        return hypercli_buzz_acp::run();
    }

    tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?
        .block_on(run_platform_host())
}

async fn run_platform_host() -> anyhow::Result<()> {
    tracing_subscriber::fmt::init();
    let args = Args::parse();
    let trace = TraceStore::open(&args.trace_db)?;
    let core = Arc::new(CoreState::with_trace(Arc::new(StubRuntime), trace).await?);
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
    tracing::info!(bind = %args.bind, "starting hypercli-acp");
    ws::serve(args.bind, core).await
}

fn should_run_hosted_buzz_mode() -> bool {
    let mut args = std::env::args();
    let _argv0 = args.next();
    if matches!(
        args.next().as_deref(),
        Some("models" | "auth-methods" | "authenticate" | "auth-tag")
    ) {
        return true;
    }

    std::env::var_os("BUZZ_RELAY_URL").is_some()
        || std::env::var_os("BUZZ_PRIVATE_KEY").is_some()
        || std::env::var_os("NOSTR_PRIVATE_KEY").is_some()
        || std::env::var_os("BUZZ_ACP_SETUP_PAYLOAD").is_some()
}
