//! `buzz` MCP stdio shim — a *dumb pipe* between the agent-spawned MCP
//! server process and the plugin's in-process MCP bridge (`mcp_bridge.rs`).
//!
//! The agent spawns this process as a session MCP server via
//! `session/new mcpServers`. It speaks MCP (newline-delimited JSON-RPC) on
//! stdin/stdout and forwards every frame untouched to the plugin's loopback
//! MCP bridge over TCP, where the real tool handling, channel-scope
//! enforcement, signing, and relay publishing happen.
//!
//! Secrets never enter this process: its only env is a loopback address and
//! a per-session capability token ([`ENV_ADDR`], [`ENV_TOKEN`]) injected by
//! the plugin through `mcpServers` env entries. The token authorizes
//! "publish into the channel this session is bound to", nothing more.

use anyhow::{Context, Result};
use tokio::io::{AsyncBufReadExt, AsyncWriteExt, BufReader};
use tokio::net::TcpStream;

use std::sync::OnceLock;

/// Hidden argv[1] marker that routes the re-executed harness binary into
/// shim mode before any clap parsing (`lib::tokio_main`).
pub(crate) const SHIM_MARKER: &str = "__buzz-mcp-shim";

/// Shim env: loopback address (`host:port`) of the plugin's MCP bridge.
pub(crate) const ENV_ADDR: &str = "BUZZ_MCP_SHIM_ADDR";

/// Shim env: per-session capability token binding the connection to a channel.
pub(crate) const ENV_TOKEN: &str = "BUZZ_MCP_SHIM_TOKEN";

/// Auth frame the shim sends as the first line after connecting. The bridge
/// replies with `{"ok":true}` (or `{"ok":false}` and closes).
const AUTH_FRAME_FIELD: &str = "buzzMcpAuth";

/// Leading argv tokens needed to re-enter the buzz plugin on the harness
/// binary: `["plugin", "buzz"]` when launched via `hyper-acp plugin buzz`,
/// `[]` for the `buzz-acp` compat binary. Set once by the entry points in
/// `lib.rs` before any session is created.
static LAUNCH_ARGV_PREFIX: OnceLock<Vec<String>> = OnceLock::new();

/// Record how this process was launched so the bridge can build a shim
/// command that re-enters the plugin on the same binary.
pub(crate) fn set_launch_argv_prefix(prefix: Vec<String>) {
    // Idempotent: both entry points run before concurrency exists, and a
    // double-set uses identical semantics either way.
    let _ = LAUNCH_ARGV_PREFIX.set(prefix);
}

/// Command args that re-exec the harness binary into shim mode:
/// launch prefix + [`SHIM_MARKER`].
pub(crate) fn shim_command_args() -> Vec<String> {
    let mut args = LAUNCH_ARGV_PREFIX.get().cloned().unwrap_or_default();
    args.push(SHIM_MARKER.to_string());
    args
}

/// Run shim mode: connect to the bridge, authenticate, then pump
/// stdin→socket and socket→stdout until either side closes.
pub(crate) async fn run_shim() -> Result<()> {
    let addr = std::env::var(ENV_ADDR).context("shim: BUZZ_MCP_SHIM_ADDR unset")?;
    let token = std::env::var(ENV_TOKEN).context("shim: BUZZ_MCP_SHIM_TOKEN unset")?;

    let stream = TcpStream::connect(&addr)
        .await
        .with_context(|| format!("shim: bridge connect failed ({addr})"))?;
    let (reader, mut writer) = stream.into_split();

    // Authenticate before any MCP traffic. The token is read from env only
    // here and never echoed anywhere besides the auth frame to the bridge.
    let auth = serde_json::json!({ AUTH_FRAME_FIELD: token });
    writer
        .write_all(serde_json::to_string(&auth)?.as_bytes())
        .await?;
    writer.write_all(b"\n").await?;

    let mut reader = BufReader::new(reader);
    let mut ack = String::new();
    let accepted = match tokio::time::timeout(
        std::time::Duration::from_secs(10),
        reader.read_line(&mut ack),
    )
    .await
    {
        Ok(Ok(_)) => serde_json::from_str::<serde_json::Value>(&ack)
            .ok()
            .and_then(|v| v.get("ok").and_then(serde_json::Value::as_bool))
            .unwrap_or(false),
        Ok(Err(e)) => return Err(e).context("shim: bridge auth read failed"),
        Err(_) => anyhow::bail!("shim: bridge auth timed out"),
    };
    if !accepted {
        anyhow::bail!("shim: bridge rejected the session token");
    }

    // Byte-pump both directions. MCP stdio and the bridge protocol are both
    // newline-delimited JSON; raw copy suffices — the bridge owns all of the
    // protocol semantics.
    let mut stdin = tokio::io::stdin();
    let mut stdout = tokio::io::stdout();
    let to_bridge = async {
        let result = tokio::io::copy(&mut stdin, &mut writer).await;
        // Closing stdin means the agent is done; half-close the socket so the
        // bridge can flush any in-flight response back.
        let _ = writer.shutdown().await;
        result
    };
    let to_agent = tokio::io::copy(&mut reader, &mut stdout);

    // Whichever copy ends first ends the shim: a closed bridge socket means
    // the plugin is gone, and a closed stdin means the agent is gone. Any
    // response still in flight after stdin closes is intentionally abandoned.
    to_bridge.await?;
    drop(tokio::time::timeout(std::time::Duration::from_millis(200), to_agent).await);
    Ok(())
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn shim_args_end_with_marker_and_carry_prefix() {
        // Default (unset) prefix: bare marker — the buzz-acp compat-binary
        // form.
        assert_eq!(shim_command_args(), vec![SHIM_MARKER.to_string()]);

        set_launch_argv_prefix(vec!["plugin".into(), "buzz".into()]);
        assert_eq!(
            shim_command_args(),
            vec![
                "plugin".to_string(),
                "buzz".to_string(),
                SHIM_MARKER.to_string(),
            ]
        );
    }
}
