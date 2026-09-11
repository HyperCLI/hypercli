//! Raw ACP transports.

use anyhow::{Context, Result};
use tokio::process::{Child, Command};
use tokio::sync::mpsc;

pub mod outbound_ws;
pub mod stdio;
pub mod turn_log;

pub use turn_log::TurnLog;

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
    sink: ObserverSink,
}

#[derive(Debug, Clone)]
enum ObserverSink {
    /// Raw frames forwarded to an external consumer task.
    Channel(mpsc::Sender<ObservedAcpFrame>),
    /// Frames tallied in place by the per-session turn log.
    TurnLog(TurnLog),
}

impl AcpFrameObserver {
    /// Build an observer from a channel sender.
    #[must_use]
    pub fn new(tx: mpsc::Sender<ObservedAcpFrame>) -> Self {
        Self {
            sink: ObserverSink::Channel(tx),
        }
    }

    pub(crate) fn turn_log(turn_log: TurnLog) -> Self {
        Self {
            sink: ObserverSink::TurnLog(turn_log),
        }
    }

    /// Forward one validated raw frame to the observer task.
    ///
    /// # Errors
    ///
    /// Returns an error if the observer task has stopped.
    pub async fn observe(&self, direction: Direction, text: &str) -> Result<()> {
        match &self.sink {
            ObserverSink::Channel(tx) => tx
                .send(ObservedAcpFrame {
                    direction,
                    text: text.to_owned(),
                })
                .await
                .context("ACP frame observer closed"),
            ObserverSink::TurnLog(turn_log) => {
                turn_log.observe(direction, text);
                Ok(())
            }
        }
    }

    /// Signal that the transport dropped a dead socket era: in-flight turns
    /// from it can never end cleanly and must be forgotten.
    pub(crate) fn reset_in_flight_turns(&self) {
        if let ObserverSink::TurnLog(turn_log) = &self.sink {
            turn_log.reset_in_flight();
        }
    }
}

pub(crate) fn spawn_acp_child(mut command: Command) -> Result<Child> {
    let agent_program = command
        .as_std()
        .get_program()
        .to_string_lossy()
        .into_owned();
    let permissions_raw = std::env::var(crate::capabilities::HYPER_ACP_PERMISSIONS_ENV).ok();
    crate::capabilities::apply_spawn_permission_env(
        &mut command,
        &agent_program,
        permissions_raw.as_deref(),
    );
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
