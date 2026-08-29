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

#[tokio::main]
async fn main() -> anyhow::Result<()> {
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
