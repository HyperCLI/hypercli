//! Metadata-only SQLite tracing for ACP envelopes.

use crate::frame::{EnvelopeKind, FrameMetadata, FrameTopLevel};
use anyhow::Result;
use rusqlite::{Connection, params};
use std::path::Path;
use std::sync::{Arc, Mutex};
use std::time::{SystemTime, UNIX_EPOCH};

/// Default maximum number of trace rows retained.
pub const DEFAULT_MAX_TRACE_ROWS: usize = 10_000;

/// Metadata-only trace store for ACP frames.
#[derive(Clone, Debug)]
pub struct TraceStore {
    conn: Arc<Mutex<Connection>>,
    max_rows: usize,
}

impl TraceStore {
    /// Open or create a SQLite trace database.
    ///
    /// # Errors
    ///
    /// Returns an error if the database or parent directory cannot be created.
    pub fn open(path: &Path, max_rows: usize) -> Result<Self> {
        if let Some(parent) = path.parent() {
            std::fs::create_dir_all(parent)?;
        }
        let conn = Connection::open(path)?;
        conn.execute_batch(
            "CREATE TABLE IF NOT EXISTS acp_envelopes (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ts_ms INTEGER NOT NULL,
                direction TEXT NOT NULL,
                top_level TEXT NOT NULL,
                envelope_index INTEGER NOT NULL,
                envelope_kind TEXT NOT NULL,
                method TEXT,
                request_id TEXT,
                session_ids_json TEXT NOT NULL,
                frame_bytes INTEGER NOT NULL
            );",
        )?;
        Ok(Self {
            conn: Arc::new(Mutex::new(conn)),
            max_rows: max_rows.max(1),
        })
    }

    /// Record metadata for each envelope in a raw ACP frame.
    ///
    /// # Errors
    ///
    /// Returns an error if SQLite insertion fails.
    pub fn record_frame(&self, direction: Direction, metadata: &FrameMetadata) -> Result<()> {
        let now = now_ms();
        let frame_bytes = i64::try_from(metadata.byte_len).unwrap_or(i64::MAX);
        let conn = self.conn.lock().expect("trace db mutex poisoned");
        for (index, envelope) in metadata.envelopes.iter().enumerate() {
            conn.execute(
                "INSERT INTO acp_envelopes
                 (ts_ms, direction, top_level, envelope_index, envelope_kind,
                  method, request_id, session_ids_json, frame_bytes)
                 VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9)",
                params![
                    now,
                    direction.as_str(),
                    top_level(metadata.top_level),
                    i64::try_from(index).unwrap_or(i64::MAX),
                    envelope_kind(envelope.kind),
                    envelope.method,
                    envelope.request_id,
                    serde_json::to_string(&envelope.session_ids)?,
                    frame_bytes,
                ],
            )?;
        }
        conn.execute(
            "DELETE FROM acp_envelopes
             WHERE id NOT IN (
                SELECT id FROM acp_envelopes ORDER BY id DESC LIMIT ?1
             )",
            [i64::try_from(self.max_rows).unwrap_or(i64::MAX)],
        )?;
        Ok(())
    }
}

/// ACP frame direction through the host.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Direction {
    /// Client-to-agent ACP frame.
    ClientToAgent,
    /// Agent-to-client ACP frame.
    AgentToClient,
}

impl Direction {
    fn as_str(self) -> &'static str {
        match self {
            Self::ClientToAgent => "client_to_agent",
            Self::AgentToClient => "agent_to_client",
        }
    }
}

fn top_level(top_level: FrameTopLevel) -> &'static str {
    match top_level {
        FrameTopLevel::Single => "single",
        FrameTopLevel::Batch => "batch",
    }
}

fn envelope_kind(kind: EnvelopeKind) -> &'static str {
    match kind {
        EnvelopeKind::Request => "request",
        EnvelopeKind::Notification => "notification",
        EnvelopeKind::Response => "response",
    }
}

fn now_ms() -> i64 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
        .try_into()
        .unwrap_or(i64::MAX)
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::frame::RawAcpFrame;

    #[test]
    fn trace_records_metadata_without_payload_column() {
        let path = tempfile_path("metadata");
        let trace = TraceStore::open(&path, DEFAULT_MAX_TRACE_ROWS).unwrap();
        let frame = RawAcpFrame::parse(
            r#"{"jsonrpc":"2.0","id":1,"method":"session/prompt","params":{"sessionId":"s1","secret":"do-not-store"}}"#,
        )
        .unwrap();
        trace
            .record_frame(Direction::ClientToAgent, frame.metadata())
            .unwrap();

        let conn = trace.conn.lock().unwrap();
        let payload_column_count: i64 = conn
            .query_row(
                "SELECT COUNT(*) FROM pragma_table_info('acp_envelopes') WHERE name = 'payload'",
                [],
                |row| row.get(0),
            )
            .unwrap();
        let (method, session_ids): (String, String) = conn
            .query_row(
                "SELECT method, session_ids_json FROM acp_envelopes",
                [],
                |row| Ok((row.get(0)?, row.get(1)?)),
            )
            .unwrap();

        assert_eq!(payload_column_count, 0);
        assert_eq!(method, "session/prompt");
        assert_eq!(session_ids, r#"["s1"]"#);
    }

    #[test]
    fn trace_is_bounded() {
        let path = tempfile_path("bounded");
        let trace = TraceStore::open(&path, 1).unwrap();
        for id in 1..=2 {
            let text = format!(r#"{{"jsonrpc":"2.0","id":{id},"result":{{}}}}"#);
            let frame = RawAcpFrame::parse(&text).unwrap();
            trace
                .record_frame(Direction::AgentToClient, frame.metadata())
                .unwrap();
        }
        let count: i64 = trace
            .conn
            .lock()
            .unwrap()
            .query_row("SELECT COUNT(*) FROM acp_envelopes", [], |row| row.get(0))
            .unwrap();
        assert_eq!(count, 1);
    }

    fn tempfile_path(name: &str) -> std::path::PathBuf {
        let mut path = std::env::temp_dir();
        path.push(format!(
            "hyper-acp-{name}-{}-{}.sqlite3",
            std::process::id(),
            now_ms()
        ));
        path
    }
}
