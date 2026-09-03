//! Durable Slack relay ingress and replay adoption.
//!
//! Provenance:
//! - `openclaw-git/extensions/slack/src/monitor/ingress.ts` durable ingress
//!   ownership and replay/adoption boundary.
//! - `openclaw-git/extensions/slack/src/monitor/relay-source.ts` lines
//!   202-228 for durable-before-ack semantics.
//!
//! HyperCLI deviation: ingress is a local JSONL store under
//! `.hyper-acp/slack-relay` by default because this Rust relay runs outside
//! OpenClaw's shared channel queue. `HYPER_ACP_SLACK_DURABLE_LOG` still owns
//! explicit path selection.

use std::collections::{HashMap, HashSet};
use std::fs::{File, OpenOptions};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};

use serde::{Deserialize, Serialize};
use serde_json::Value;

use crate::monitor::message_handler::dispatch::ActiveSlackRelayFrameOutcome;
use crate::monitor::provider::ActiveSlackRelayError;

/// OpenClaw-style durable relay lifecycle state exposed for attach/start/stop/idle tests.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Default)]
pub struct ActiveSlackRelayLifecycle {
    attached: bool,
    running: bool,
    in_flight: usize,
}

impl ActiveSlackRelayLifecycle {
    /// Marks the relay dispatcher attached.
    pub fn attach(&mut self) {
        self.attached = true;
    }

    /// Marks the relay drain loop running.
    pub fn start(&mut self) {
        self.running = true;
    }

    /// Marks the relay drain loop stopped.
    pub fn stop(&mut self) {
        self.running = false;
    }

    /// Whether no dispatch/replay is currently being adopted.
    #[must_use]
    pub fn is_idle(&self) -> bool {
        self.in_flight == 0
    }

    /// Whether a dispatcher is attached.
    #[must_use]
    pub fn is_attached(&self) -> bool {
        self.attached
    }

    /// Whether the relay lifecycle is running.
    #[must_use]
    pub fn is_running(&self) -> bool {
        self.running
    }

    pub(crate) fn begin_turn(&mut self) {
        self.in_flight = self.in_flight.saturating_add(1);
    }

    pub(crate) fn finish_turn(&mut self) {
        self.in_flight = self.in_flight.saturating_sub(1);
    }
}

/// Durable record written before a relay ack is sent.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct DurableSlackRelayRecord {
    /// Delivery id.
    pub delivery_id: String,
    /// Logical dedupe key.
    pub dedupe_key: Option<String>,
    /// Processing action.
    pub action: DurableSlackRelayAction,
    /// Slack metadata used to build the ACP prompt.
    pub slack_meta: Value,
    /// Dispatched payload for `Dispatch` records. Legacy frame-splice path:
    /// `Value::String` holding the serialized ACP `session/prompt` frame.
    /// Standalone plugin path: serialized `crate::queue::DurableQueuedSlackEvent`.
    pub queued_event: Option<Value>,
}

/// Durable processing action.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum DurableSlackRelayAction {
    /// Logical dedupe key was reserved pending dispatch outcome.
    Claim,
    /// Event will be dispatched to ACP.
    Dispatch,
    /// Event was durably dispatched and the logical dedupe key is committed.
    Commit,
    /// Event was gated locally.
    Drop {
        /// Drop reason.
        reason: String,
    },
    /// Pending logical dedupe key was released after a gated/failed dispatch.
    Release,
    /// Uncommitted dispatch record was replayed to ACP after startup.
    Replay,
    /// Event duplicated an already claimed Slack logical message.
    Duplicate,
}

/// Durable accept store.
pub trait DurableSlackRelayStore {
    /// Accept a Slack relay record durably before acking the relay frame.
    ///
    /// # Errors
    ///
    /// Returns an error if the store cannot persist the event.
    fn accept(&mut self, record: &DurableSlackRelayRecord) -> Result<(), ActiveSlackRelayError>;
}

/// File-backed JSONL durable accept store.
#[derive(Debug)]
pub struct JsonlSlackRelayStore {
    file: File,
}

impl JsonlSlackRelayStore {
    /// Opens a JSONL store at `path`.
    ///
    /// # Errors
    ///
    /// Returns IO errors when the parent directory or file cannot be created.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, ActiveSlackRelayError> {
        if let Some(parent) = path.as_ref().parent() {
            std::fs::create_dir_all(parent)?;
        }
        let file = OpenOptions::new().create(true).append(true).open(path)?;
        Ok(Self { file })
    }
}

impl DurableSlackRelayStore for JsonlSlackRelayStore {
    fn accept(&mut self, record: &DurableSlackRelayRecord) -> Result<(), ActiveSlackRelayError> {
        serde_json::to_writer(&mut self.file, record)?;
        self.file.write_all(b"\n")?;
        self.file.sync_data()?;
        Ok(())
    }
}

/// Cheaply cloneable, shared handle to one JSONL store.
///
/// The relay loop and the worker pool both append records (dispatch-time
/// claims vs turn-terminal commits); the internal mutex keeps records whole.
/// The inner mutex is `std::sync` because [`DurableSlackRelayStore::accept`]
/// is synchronous — the lock is never held across an `.await`.
#[derive(Debug, Clone)]
pub struct SharedSlackRelayStore {
    inner: std::sync::Arc<std::sync::Mutex<JsonlSlackRelayStore>>,
    path: PathBuf,
}

impl SharedSlackRelayStore {
    /// Opens a shared JSONL store at `path`.
    ///
    /// # Errors
    ///
    /// Returns IO errors when the parent directory or file cannot be created.
    pub fn open(path: impl AsRef<Path>) -> Result<Self, ActiveSlackRelayError> {
        let inner = JsonlSlackRelayStore::open(&path)?;
        let path = path.as_ref().to_path_buf();
        Ok(Self {
            inner: std::sync::Arc::new(std::sync::Mutex::new(inner)),
            path,
        })
    }

    /// Path the store persists to (used to recover before first reconnect).
    #[must_use]
    pub fn path(&self) -> &Path {
        &self.path
    }
}

impl DurableSlackRelayStore for SharedSlackRelayStore {
    fn accept(&mut self, record: &DurableSlackRelayRecord) -> Result<(), ActiveSlackRelayError> {
        self.inner
            .lock()
            .unwrap_or_else(std::sync::PoisonError::into_inner)
            .accept(record)
    }
}

/// In-memory durable store substitute for tests and embedded callers that
/// provide durability outside this crate.
#[derive(Debug, Default)]
pub struct MemorySlackRelayStore {
    /// Accepted records.
    pub records: Vec<DurableSlackRelayRecord>,
}

impl DurableSlackRelayStore for MemorySlackRelayStore {
    fn accept(&mut self, record: &DurableSlackRelayRecord) -> Result<(), ActiveSlackRelayError> {
        self.records.push(record.clone());
        Ok(())
    }
}

/// Durable recovery records loaded from the JSONL store.
#[derive(Debug, Default)]
pub struct DurableSlackRelayRecovery {
    /// Dedupe keys that were committed before shutdown.
    pub committed_dedupe_keys: Vec<String>,
    /// Dispatch records accepted but not committed before shutdown.
    pub replay_records: Vec<DurableSlackRelayRecord>,
}

/// Rehydrates committed dedupe keys and uncommitted dispatches from JSONL.
///
/// # Errors
///
/// Returns IO or JSON errors from the durable store.
pub fn recover_durable_relay_log(
    path: &Path,
) -> Result<DurableSlackRelayRecovery, ActiveSlackRelayError> {
    if !path.is_file() {
        return Ok(DurableSlackRelayRecovery::default());
    }
    let file = File::open(path)?;
    let mut committed = HashSet::new();
    let mut in_flight_dispatches: HashMap<String, DurableSlackRelayRecord> = HashMap::new();
    for line in BufReader::new(file).lines() {
        let line = line?;
        if line.trim().is_empty() {
            continue;
        }
        let record = serde_json::from_str::<DurableSlackRelayRecord>(&line)?;
        match record.action {
            DurableSlackRelayAction::Commit => {
                if let Some(key) = record.dedupe_key {
                    committed.insert(key.clone());
                    in_flight_dispatches.remove(&key);
                }
            }
            DurableSlackRelayAction::Release => {
                if let Some(key) = record.dedupe_key {
                    committed.remove(&key);
                    in_flight_dispatches.remove(&key);
                }
            }
            DurableSlackRelayAction::Dispatch => {
                if record.queued_event.is_none() && line.contains("\"acp_frame\"") {
                    tracing::warn!(
                        delivery_id = %record.delivery_id,
                        "durable dispatch from the pre-envelope (acp_frame) log era is not \
                         replayable — one-time upgrade loss window"
                    );
                }
                if let Some(key) = record.dedupe_key.clone() {
                    if record.queued_event.is_some() && !committed.contains(&key) {
                        in_flight_dispatches.insert(key, record);
                    }
                }
            }
            DurableSlackRelayAction::Claim
            | DurableSlackRelayAction::Drop { .. }
            | DurableSlackRelayAction::Replay
            | DurableSlackRelayAction::Duplicate => {}
        }
    }
    Ok(DurableSlackRelayRecovery {
        committed_dedupe_keys: committed.into_iter().collect(),
        replay_records: in_flight_dispatches.into_values().collect(),
    })
}

/// Builds the default durable log path for one gateway/session pair.
#[must_use]
pub fn default_durable_log_path(gateway_id: &str, session_id: &str) -> PathBuf {
    std::env::current_dir()
        .unwrap_or_else(|_| std::env::temp_dir())
        .join(".hyper-acp")
        .join("slack-relay")
        .join(format!(
            "{}-{}.jsonl",
            sanitize_path_component(gateway_id),
            sanitize_path_component(session_id)
        ))
}

fn sanitize_path_component(value: &str) -> String {
    let sanitized = value
        .chars()
        .map(|ch| {
            if ch.is_ascii_alphanumeric() || ch == '-' || ch == '_' {
                ch
            } else {
                '_'
            }
        })
        .collect::<String>();
    if sanitized.is_empty() {
        "default".to_owned()
    } else {
        sanitized
    }
}

/// Ack-bearing outcomes are safe to acknowledge after durable ingress accepts.
#[must_use]
pub fn outcome_ack(
    outcome: &ActiveSlackRelayFrameOutcome,
) -> Option<&crate::relay_source::SlackRelayAckFrame> {
    match outcome {
        ActiveSlackRelayFrameOutcome::Dispatched { ack, .. }
        | ActiveSlackRelayFrameOutcome::Dropped { ack, .. }
        | ActiveSlackRelayFrameOutcome::Duplicate { ack, .. }
        | ActiveSlackRelayFrameOutcome::DuplicatePending { ack, .. } => Some(ack),
        ActiveSlackRelayFrameOutcome::Hello | ActiveSlackRelayFrameOutcome::Ignored => None,
    }
}

#[cfg(test)]
mod tests {
    use std::fs;

    use serde_json::json;

    use super::*;

    #[test]
    fn durable_log_rehydrates_only_committed_unreleased_dedupe_keys() {
        let path = std::env::temp_dir().join(format!(
            "hyper-acp-slack-dedupe-{}.jsonl",
            std::process::id()
        ));
        let committed = r#"["message","acct","T1","C1","100.100"]"#;
        let released = r#"["message","acct","T1","C1","101.100"]"#;
        let uncommitted = r#"["message","acct","T1","C1","102.100"]"#;
        let duplicate = r#"["message","acct","T1","C1","103.100"]"#;
        let lines = [
            serde_json::to_string(&DurableSlackRelayRecord {
                delivery_id: "d1".to_owned(),
                dedupe_key: Some(committed.to_owned()),
                action: DurableSlackRelayAction::Claim,
                slack_meta: json!({}),
                queued_event: None,
            })
            .unwrap(),
            serde_json::to_string(&DurableSlackRelayRecord {
                delivery_id: "d1".to_owned(),
                dedupe_key: Some(committed.to_owned()),
                action: DurableSlackRelayAction::Commit,
                slack_meta: json!({}),
                queued_event: None,
            })
            .unwrap(),
            serde_json::to_string(&DurableSlackRelayRecord {
                delivery_id: "d2".to_owned(),
                dedupe_key: Some(released.to_owned()),
                action: DurableSlackRelayAction::Commit,
                slack_meta: json!({}),
                queued_event: None,
            })
            .unwrap(),
            serde_json::to_string(&DurableSlackRelayRecord {
                delivery_id: "d2".to_owned(),
                dedupe_key: Some(released.to_owned()),
                action: DurableSlackRelayAction::Release,
                slack_meta: json!({}),
                queued_event: None,
            })
            .unwrap(),
            serde_json::to_string(&DurableSlackRelayRecord {
                delivery_id: "d3".to_owned(),
                dedupe_key: Some(uncommitted.to_owned()),
                action: DurableSlackRelayAction::Dispatch,
                slack_meta: json!({}),
                queued_event: Some(Value::String("{}".to_owned())),
            })
            .unwrap(),
            serde_json::to_string(&DurableSlackRelayRecord {
                delivery_id: "d4".to_owned(),
                dedupe_key: Some(duplicate.to_owned()),
                action: DurableSlackRelayAction::Duplicate,
                slack_meta: json!({}),
                queued_event: None,
            })
            .unwrap(),
        ];
        fs::write(&path, format!("{}\n", lines.join("\n"))).unwrap();

        let loaded = recover_durable_relay_log(&path).unwrap();
        fs::remove_file(&path).unwrap();

        assert_eq!(loaded.committed_dedupe_keys, vec![committed.to_owned()]);
        assert_eq!(loaded.replay_records.len(), 1);
        assert_eq!(
            loaded.replay_records[0].dedupe_key.as_deref(),
            Some(uncommitted)
        );
    }

    #[test]
    fn default_durable_path_uses_hyper_acp_state_dir() {
        let path = default_durable_log_path("agent:abc", "sess/1");
        assert!(path.to_string_lossy().contains(".hyper-acp/slack-relay"));
        assert!(path.to_string_lossy().ends_with("agent_abc-sess_1.jsonl"));
    }
}
