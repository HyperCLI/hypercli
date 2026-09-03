//! Raw ACP transports.

use anyhow::{Context, Result};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

pub mod outbound_ws;
pub mod stdio;

/// ACP frame direction through the host.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    /// Client-to-agent ACP frame.
    ClientToAgent,
    /// Agent-to-client ACP frame.
    AgentToClient,
}

/// Validated raw ACP frame observed by a transport.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct ObservedAcpFrame {
    /// Frame direction through the host.
    pub direction: Direction,
    /// Raw newline-delimited JSON-RPC frame text.
    pub text: String,
}

/// Optional sink for validated raw ACP frames.
#[derive(Debug, Clone)]
pub struct AcpFrameObserver {
    tx: mpsc::Sender<ObservedAcpFrame>,
}

impl AcpFrameObserver {
    /// Build an observer from a channel sender.
    #[must_use]
    pub fn new(tx: mpsc::Sender<ObservedAcpFrame>) -> Self {
        Self { tx }
    }

    /// Forward one validated raw frame to the observer task.
    ///
    /// # Errors
    ///
    /// Returns an error if the observer task has stopped.
    pub async fn observe(&self, direction: Direction, text: &str) -> Result<()> {
        self.tx
            .send(ObservedAcpFrame {
                direction,
                text: text.to_owned(),
            })
            .await
            .context("ACP frame observer closed")
    }
}

pub(crate) fn spawn_acp_child(mut command: Command) -> Result<Child> {
    command
        .stdin(std::process::Stdio::piped())
        .stdout(std::process::Stdio::piped())
        .stderr(std::process::Stdio::inherit())
        // The child must not outlive the host on error paths that return
        // without an explicit kill (tokio does not kill dropped children).
        .kill_on_drop(true)
        .spawn()
        .context("spawn ACP child process")
}
