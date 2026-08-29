use std::collections::HashMap;
use std::path::Path;
use std::sync::Arc;

use chrono::{DateTime, Utc};
use rusqlite::{params, Connection, OptionalExtension};
use serde::de::DeserializeOwned;
use serde_json::Value;
use tokio::sync::Mutex;

use crate::types::{
    ActivityFrame, NormalizedTurn, SessionTrace, SessionTraceFilter, TraceSession, TraceTurn,
    TurnAccepted, TurnAdmissionStatus, TurnTerminal,
};

const MAX_TRACE_RECORD_BYTES: usize = 256 * 1024;
const MAX_TRACE_TEXT_BYTES: usize = 64 * 1024;
const MAX_TRACE_ACTIVITY_ROWS: usize = 1_000;

#[derive(Clone)]
pub struct TraceStore {
    db: Arc<Mutex<Connection>>,
}

impl TraceStore {
    pub fn open(path: impl AsRef<Path>) -> anyhow::Result<Self> {
        if let Some(parent) = path.as_ref().parent() {
            std::fs::create_dir_all(parent)?;
        }
        let connection = Connection::open(path)?;
        init_connection(&connection)?;
        Ok(Self {
            db: Arc::new(Mutex::new(connection)),
        })
    }

    pub fn memory() -> anyhow::Result<Self> {
        let connection = Connection::open_in_memory()?;
        init_connection(&connection)?;
        Ok(Self {
            db: Arc::new(Mutex::new(connection)),
        })
    }

    pub async fn load_active_sessions(&self) -> anyhow::Result<HashMap<String, String>> {
        let db = self.db.lock().await;
        let mut statement = db.prepare(
            "SELECT conversation_key, session_id FROM sessions WHERE rotated_at IS NULL",
        )?;
        let rows = statement.query_map([], |row| {
            Ok((row.get::<_, String>(0)?, row.get::<_, String>(1)?))
        })?;
        let mut sessions = HashMap::new();
        for row in rows {
            let (conversation_key, session_id) = row?;
            sessions.insert(conversation_key, session_id);
        }
        Ok(sessions)
    }

    pub async fn record_turn_accepted(
        &self,
        turn: &NormalizedTurn,
        accepted: &TurnAccepted,
    ) -> anyhow::Result<()> {
        if accepted.status == TurnAdmissionStatus::Duplicate {
            return Ok(());
        }
        let db = self.db.lock().await;
        db.execute(
            r#"
            INSERT INTO turns (
              turn_id, conversation_key, connector, idempotency_key, request_id,
              status, queued_at, turn_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8)
            ON CONFLICT(turn_id) DO UPDATE SET
              request_id=excluded.request_id,
              status=excluded.status,
              queued_at=excluded.queued_at,
              turn_json=excluded.turn_json
            "#,
            params![
                accepted.turn_id,
                accepted.conversation_key,
                turn.connector,
                turn.idempotency_key,
                accepted.request_id,
                status_name(accepted.status),
                accepted.queued_at.to_rfc3339(),
                trace_json_string(&bounded_turn(turn))?,
            ],
        )?;
        Ok(())
    }

    pub async fn record_turn_started(
        &self,
        turn_id: &str,
        conversation_key: &str,
        session_id: Option<&str>,
        started_at: DateTime<Utc>,
    ) -> anyhow::Result<()> {
        let db = self.db.lock().await;
        db.execute(
            r#"
            UPDATE turns
            SET status='started', session_id=COALESCE(?3, session_id), started_at=COALESCE(started_at, ?4)
            WHERE turn_id=?1 AND conversation_key=?2
            "#,
            params![
                turn_id,
                conversation_key,
                session_id,
                started_at.to_rfc3339(),
            ],
        )?;
        Ok(())
    }

    pub async fn record_turn_terminal(
        &self,
        terminal: &TurnTerminal,
        status: &str,
    ) -> anyhow::Result<()> {
        let db = self.db.lock().await;
        db.execute(
            r#"
            UPDATE turns
            SET status=?2, session_id=?3, completed_at=?4, terminal_json=?5
            WHERE turn_id=?1
            "#,
            params![
                terminal.turn_id,
                status,
                terminal.session_id,
                terminal.timing.completed_at.map(|value| value.to_rfc3339()),
                trace_json_string(&bounded_terminal(terminal))?,
            ],
        )?;
        Ok(())
    }

    pub async fn record_session_bound(
        &self,
        conversation_key: &str,
        session_id: &str,
        connector: Option<&str>,
        now: DateTime<Utc>,
    ) -> anyhow::Result<()> {
        let db = self.db.lock().await;
        let updated = db.execute(
            r#"
            UPDATE sessions
            SET connector=COALESCE(?3, connector), updated_at=?4
            WHERE conversation_key=?1 AND session_id=?2 AND rotated_at IS NULL
            "#,
            params![conversation_key, session_id, connector, now.to_rfc3339()],
        )?;
        if updated == 0 {
            db.execute(
                r#"
                INSERT INTO sessions (
                  conversation_key, session_id, connector, created_at, updated_at, rotated_at
                ) VALUES (?1, ?2, ?3, ?4, ?4, NULL)
                "#,
                params![conversation_key, session_id, connector, now.to_rfc3339()],
            )?;
        }
        Ok(())
    }

    pub async fn record_session_rotated(
        &self,
        conversation_key: &str,
        now: DateTime<Utc>,
    ) -> anyhow::Result<()> {
        let db = self.db.lock().await;
        db.execute(
            r#"
            UPDATE sessions
            SET rotated_at=?2, updated_at=?2
            WHERE conversation_key=?1 AND rotated_at IS NULL
            "#,
            params![conversation_key, now.to_rfc3339()],
        )?;
        Ok(())
    }

    pub async fn record_activity(&self, frame: &ActivityFrame) -> anyhow::Result<()> {
        let db = self.db.lock().await;
        db.execute(
            r#"
            INSERT INTO activity (
              seq, timestamp, kind, connector, conversation_key, session_id,
              turn_id, started_at, payload_json, frame_json
            ) VALUES (?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8, ?9, ?10)
            "#,
            params![
                frame.seq,
                frame.timestamp.to_rfc3339(),
                json_string(&frame.kind)?.trim_matches('"').to_owned(),
                frame.connector,
                frame.conversation_key,
                frame.session_id,
                frame.turn_id,
                frame.started_at.map(|value| value.to_rfc3339()),
                frame.payload.as_ref().map(trace_json_string).transpose()?,
                trace_json_string(&bounded_activity_frame(frame))?,
            ],
        )?;
        prune_activity(&db)?;
        Ok(())
    }

    pub async fn list_sessions(
        &self,
        conversation_key: Option<&str>,
    ) -> anyhow::Result<Vec<TraceSession>> {
        let db = self.db.lock().await;
        let mut sessions = Vec::new();
        if let Some(conversation_key) = conversation_key {
            let mut statement = db.prepare(
                r#"
                SELECT conversation_key, session_id, connector, created_at, updated_at, rotated_at
                FROM sessions
                WHERE conversation_key=?1
                ORDER BY updated_at DESC
                "#,
            )?;
            let rows = statement.query_map([conversation_key], trace_session_from_row)?;
            for row in rows {
                sessions.push(row?);
            }
        } else {
            let mut statement = db.prepare(
                r#"
                SELECT conversation_key, session_id, connector, created_at, updated_at, rotated_at
                FROM sessions
                ORDER BY updated_at DESC
                "#,
            )?;
            let rows = statement.query_map([], trace_session_from_row)?;
            for row in rows {
                sessions.push(row?);
            }
        }
        Ok(sessions)
    }

    pub async fn traceback(&self, filter: SessionTraceFilter) -> anyhow::Result<SessionTrace> {
        let sessions = self.trace_sessions_for_filter(&filter).await?;
        let turns = self.trace_turns_for_filter(&filter).await?;
        let activity = self.trace_activity_for_filter(&filter).await?;
        Ok(SessionTrace {
            request_id: filter.request_id,
            conversation_key: filter.conversation_key,
            session_id: filter.session_id,
            sessions,
            turns,
            activity,
        })
    }

    async fn trace_sessions_for_filter(
        &self,
        filter: &SessionTraceFilter,
    ) -> anyhow::Result<Vec<TraceSession>> {
        let db = self.db.lock().await;
        let mut sessions = Vec::new();
        match (&filter.conversation_key, &filter.session_id) {
            (Some(conversation_key), Some(session_id)) => {
                let mut statement = db.prepare(
                    r#"
                    SELECT conversation_key, session_id, connector, created_at, updated_at, rotated_at
                    FROM sessions
                    WHERE conversation_key=?1 AND session_id=?2
                    ORDER BY updated_at ASC
                    "#,
                )?;
                let rows = statement.query_map(
                    params![conversation_key, session_id],
                    trace_session_from_row,
                )?;
                for row in rows {
                    sessions.push(row?);
                }
            }
            (Some(conversation_key), None) => {
                let mut statement = db.prepare(
                    r#"
                    SELECT conversation_key, session_id, connector, created_at, updated_at, rotated_at
                    FROM sessions
                    WHERE conversation_key=?1
                    ORDER BY updated_at ASC
                    "#,
                )?;
                let rows = statement.query_map([conversation_key], trace_session_from_row)?;
                for row in rows {
                    sessions.push(row?);
                }
            }
            (None, Some(session_id)) => {
                let mut statement = db.prepare(
                    r#"
                    SELECT conversation_key, session_id, connector, created_at, updated_at, rotated_at
                    FROM sessions
                    WHERE session_id=?1
                    ORDER BY updated_at ASC
                    "#,
                )?;
                let rows = statement.query_map([session_id], trace_session_from_row)?;
                for row in rows {
                    sessions.push(row?);
                }
            }
            (None, None) => {}
        }
        Ok(sessions)
    }

    async fn trace_turns_for_filter(
        &self,
        filter: &SessionTraceFilter,
    ) -> anyhow::Result<Vec<TraceTurn>> {
        let db = self.db.lock().await;
        let limit = filter.limit.unwrap_or(200).min(1000) as i64;
        let mut turns = Vec::new();
        match (&filter.conversation_key, &filter.session_id) {
            (Some(conversation_key), Some(session_id)) => {
                let mut statement = db.prepare(
                    r#"
                    SELECT turn_id, conversation_key, session_id, connector, idempotency_key,
                           request_id, status, queued_at, started_at, completed_at,
                           turn_json, terminal_json
                    FROM turns
                    WHERE conversation_key=?1 AND session_id=?2
                    ORDER BY queued_at ASC
                    LIMIT ?3
                    "#,
                )?;
                let rows = statement.query_map(
                    params![conversation_key, session_id, limit],
                    trace_turn_from_row,
                )?;
                for row in rows {
                    turns.push(row?);
                }
            }
            (Some(conversation_key), None) => {
                let mut statement = db.prepare(
                    r#"
                    SELECT turn_id, conversation_key, session_id, connector, idempotency_key,
                           request_id, status, queued_at, started_at, completed_at,
                           turn_json, terminal_json
                    FROM turns
                    WHERE conversation_key=?1
                    ORDER BY queued_at ASC
                    LIMIT ?2
                    "#,
                )?;
                let rows =
                    statement.query_map(params![conversation_key, limit], trace_turn_from_row)?;
                for row in rows {
                    turns.push(row?);
                }
            }
            (None, Some(session_id)) => {
                let mut statement = db.prepare(
                    r#"
                    SELECT turn_id, conversation_key, session_id, connector, idempotency_key,
                           request_id, status, queued_at, started_at, completed_at,
                           turn_json, terminal_json
                    FROM turns
                    WHERE session_id=?1
                    ORDER BY queued_at ASC
                    LIMIT ?2
                    "#,
                )?;
                let rows = statement.query_map(params![session_id, limit], trace_turn_from_row)?;
                for row in rows {
                    turns.push(row?);
                }
            }
            (None, None) => {}
        }
        Ok(turns)
    }

    async fn trace_activity_for_filter(
        &self,
        filter: &SessionTraceFilter,
    ) -> anyhow::Result<Vec<ActivityFrame>> {
        let db = self.db.lock().await;
        let limit = filter.limit.unwrap_or(200).min(1000) as i64;
        let mut activity = Vec::new();
        match (&filter.conversation_key, &filter.session_id) {
            (Some(conversation_key), Some(session_id)) => {
                let mut statement = db.prepare(
                    r#"
                    SELECT frame_json FROM activity
                    WHERE conversation_key=?1 AND session_id=?2
                    ORDER BY id ASC
                    LIMIT ?3
                    "#,
                )?;
                let rows = statement
                    .query_map(params![conversation_key, session_id, limit], |row| {
                        json_from_row(row, 0)
                    })?;
                for row in rows {
                    activity.push(row?);
                }
            }
            (Some(conversation_key), None) => {
                let mut statement = db.prepare(
                    r#"
                    SELECT frame_json FROM activity
                    WHERE conversation_key=?1
                    ORDER BY id ASC
                    LIMIT ?2
                    "#,
                )?;
                let rows = statement.query_map(params![conversation_key, limit], |row| {
                    json_from_row(row, 0)
                })?;
                for row in rows {
                    activity.push(row?);
                }
            }
            (None, Some(session_id)) => {
                let mut statement = db.prepare(
                    r#"
                    SELECT frame_json FROM activity
                    WHERE session_id=?1
                    ORDER BY id ASC
                    LIMIT ?2
                    "#,
                )?;
                let rows =
                    statement.query_map(params![session_id, limit], |row| json_from_row(row, 0))?;
                for row in rows {
                    activity.push(row?);
                }
            }
            (None, None) => {}
        }
        Ok(activity)
    }
}

fn trace_session_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TraceSession> {
    Ok(TraceSession {
        conversation_key: row.get(0)?,
        session_id: row.get(1)?,
        connector: row.get(2)?,
        created_at: parse_rfc3339_cell(row, 3)?,
        updated_at: parse_rfc3339_cell(row, 4)?,
        rotated_at: parse_optional_rfc3339_cell(row, 5)?,
    })
}

fn trace_turn_from_row(row: &rusqlite::Row<'_>) -> rusqlite::Result<TraceTurn> {
    Ok(TraceTurn {
        turn_id: row.get(0)?,
        conversation_key: row.get(1)?,
        session_id: row.get(2)?,
        connector: row.get(3)?,
        idempotency_key: row.get(4)?,
        request_id: row.get(5)?,
        status: row.get(6)?,
        queued_at: parse_rfc3339_cell(row, 7)?,
        started_at: parse_optional_rfc3339_cell(row, 8)?,
        completed_at: parse_optional_rfc3339_cell(row, 9)?,
        turn: json_from_row(row, 10)?,
        terminal: optional_json_from_row(row, 11)?,
    })
}

fn parse_rfc3339_cell(row: &rusqlite::Row<'_>, index: usize) -> rusqlite::Result<DateTime<Utc>> {
    let value: String = row.get(index)?;
    parse_rfc3339(&value)
}

fn parse_optional_rfc3339_cell(
    row: &rusqlite::Row<'_>,
    index: usize,
) -> rusqlite::Result<Option<DateTime<Utc>>> {
    let value: Option<String> = row.get(index)?;
    value.as_deref().map(parse_rfc3339).transpose()
}

fn parse_rfc3339(value: &str) -> rusqlite::Result<DateTime<Utc>> {
    DateTime::parse_from_rfc3339(value)
        .map(|value| value.with_timezone(&Utc))
        .map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(0, rusqlite::types::Type::Text, Box::new(err))
        })
}

fn json_from_row<T: DeserializeOwned>(
    row: &rusqlite::Row<'_>,
    index: usize,
) -> rusqlite::Result<T> {
    let value: String = row.get(index)?;
    serde_json::from_str(&value).map_err(|err| {
        rusqlite::Error::FromSqlConversionFailure(index, rusqlite::types::Type::Text, Box::new(err))
    })
}

fn optional_json_from_row<T: DeserializeOwned>(
    row: &rusqlite::Row<'_>,
    index: usize,
) -> rusqlite::Result<Option<T>> {
    let value: Option<String> = row.get(index)?;
    value
        .as_deref()
        .map(serde_json::from_str)
        .transpose()
        .map_err(|err| {
            rusqlite::Error::FromSqlConversionFailure(
                index,
                rusqlite::types::Type::Text,
                Box::new(err),
            )
        })
}

fn json_string<T: serde::Serialize>(value: &T) -> anyhow::Result<String> {
    Ok(serde_json::to_string(value)?)
}

fn trace_json_string<T: serde::Serialize>(value: &T) -> anyhow::Result<String> {
    let json = serde_json::to_string(value)?;
    if json.len() <= MAX_TRACE_RECORD_BYTES {
        return Ok(json);
    }
    Ok(serde_json::to_string(&serde_json::json!({
        "trace_truncated": true,
        "original_json_bytes": json.len(),
        "limit_bytes": MAX_TRACE_RECORD_BYTES,
    }))?)
}

fn bounded_turn(turn: &NormalizedTurn) -> Value {
    let mut value = serde_json::to_value(turn).unwrap_or_else(|_| {
        serde_json::json!({
            "trace_error": "turn_serialization_failed"
        })
    });
    if let Some(message) = value.get_mut("message").and_then(Value::as_object_mut) {
        let oversized_text = message
            .get("text")
            .and_then(Value::as_str)
            .filter(|text| text.len() > MAX_TRACE_TEXT_BYTES)
            .map(bounded_text_value);
        if let Some(text) = oversized_text {
            message.insert("text".to_string(), text);
        }
        if message
            .get("attachments")
            .and_then(Value::as_array)
            .is_some_and(|attachments| !attachments.is_empty())
        {
            message.insert(
                "attachments".to_string(),
                serde_json::json!({
                    "trace_truncated": true,
                    "reason": "attachments_omitted",
                }),
            );
        }
    }
    bound_value(value)
}

fn bounded_activity_frame(frame: &ActivityFrame) -> ActivityFrame {
    let mut frame = frame.clone();
    frame.payload = frame.payload.map(bound_value);
    frame
}

fn bounded_terminal(terminal: &TurnTerminal) -> Value {
    let mut value = serde_json::to_value(terminal).unwrap_or_else(|_| {
        serde_json::json!({
            "trace_error": "terminal_serialization_failed",
            "turn_id": terminal.turn_id,
            "conversation_key": terminal.conversation_key,
            "session_id": terminal.session_id,
        })
    });
    if let Some(error) = value.get_mut("error").and_then(Value::as_object_mut) {
        let oversized_message = error
            .get("message")
            .and_then(Value::as_str)
            .filter(|message| message.len() > MAX_TRACE_TEXT_BYTES)
            .map(bounded_text_value);
        if let Some(message) = oversized_message {
            error.insert("message".to_string(), message);
        }
    }
    if serde_json::to_string(&value)
        .map(|json| json.len() <= MAX_TRACE_RECORD_BYTES)
        .unwrap_or(false)
    {
        return value;
    }
    serde_json::json!({
        "trace_truncated": true,
        "turn_id": terminal.turn_id,
        "conversation_key": terminal.conversation_key,
        "connector": terminal.connector,
        "session_id": terminal.session_id,
        "queued_at": terminal.timing.queued_at,
        "started_at": terminal.timing.started_at,
        "completed_at": terminal.timing.completed_at,
        "duration_ms": terminal.timing.duration_ms,
        "queue_duration_ms": terminal.timing.queue_duration_ms,
        "reply_status": terminal.reply_status,
        "stop_reason": terminal.stop_reason,
        "error_class": terminal.error_class,
        "usage": terminal.usage,
    })
}

fn bound_value(value: Value) -> Value {
    let Ok(json) = serde_json::to_string(&value) else {
        return serde_json::json!({ "trace_error": "json_serialization_failed" });
    };
    if json.len() <= MAX_TRACE_RECORD_BYTES {
        return value;
    }
    serde_json::json!({
        "trace_truncated": true,
        "original_json_bytes": json.len(),
        "limit_bytes": MAX_TRACE_RECORD_BYTES,
    })
}

fn bounded_text_value(text: &str) -> Value {
    let mut end = MAX_TRACE_TEXT_BYTES.min(text.len());
    while !text.is_char_boundary(end) {
        end -= 1;
    }
    serde_json::json!({
        "trace_truncated": true,
        "original_bytes": text.len(),
        "prefix": &text[..end],
    })
}

fn prune_activity(db: &Connection) -> anyhow::Result<()> {
    db.execute(
        r#"
        DELETE FROM activity
        WHERE id NOT IN (
          SELECT id FROM activity
          ORDER BY id DESC
          LIMIT ?1
        )
        "#,
        [MAX_TRACE_ACTIVITY_ROWS as i64],
    )?;
    Ok(())
}

fn status_name(status: TurnAdmissionStatus) -> &'static str {
    match status {
        TurnAdmissionStatus::Accepted => "accepted",
        TurnAdmissionStatus::Queued => "queued",
        TurnAdmissionStatus::Duplicate => "duplicate",
    }
}

pub async fn session_id_for_conversation(
    store: &TraceStore,
    conversation_key: &str,
) -> anyhow::Result<Option<String>> {
    let db = store.db.lock().await;
    Ok(db
        .query_row(
            "SELECT session_id FROM sessions WHERE conversation_key=?1 AND rotated_at IS NULL",
            [conversation_key],
            |row| row.get(0),
        )
        .optional()?)
}

fn init_connection(db: &Connection) -> anyhow::Result<()> {
    db.pragma_update(None, "journal_mode", "WAL")?;
    db.pragma_update(None, "foreign_keys", "ON")?;
    db.execute_batch(
        r#"
        CREATE TABLE IF NOT EXISTS sessions (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          conversation_key TEXT NOT NULL,
          session_id TEXT NOT NULL,
          connector TEXT,
          created_at TEXT NOT NULL,
          updated_at TEXT NOT NULL,
          rotated_at TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_sessions_session_id
          ON sessions(session_id);
        CREATE INDEX IF NOT EXISTS idx_sessions_conversation
          ON sessions(conversation_key, updated_at);

        CREATE TABLE IF NOT EXISTS turns (
          turn_id TEXT PRIMARY KEY NOT NULL,
          conversation_key TEXT NOT NULL,
          session_id TEXT,
          connector TEXT,
          idempotency_key TEXT NOT NULL,
          request_id TEXT,
          status TEXT NOT NULL,
          queued_at TEXT NOT NULL,
          started_at TEXT,
          completed_at TEXT,
          turn_json TEXT NOT NULL,
          terminal_json TEXT
        );

        CREATE INDEX IF NOT EXISTS idx_turns_conversation
          ON turns(conversation_key, queued_at);
        CREATE INDEX IF NOT EXISTS idx_turns_session
          ON turns(session_id, queued_at);
        CREATE UNIQUE INDEX IF NOT EXISTS idx_turns_idempotency
          ON turns(idempotency_key);

        CREATE TABLE IF NOT EXISTS activity (
          id INTEGER PRIMARY KEY AUTOINCREMENT NOT NULL,
          seq INTEGER NOT NULL,
          timestamp TEXT NOT NULL,
          kind TEXT NOT NULL,
          connector TEXT,
          conversation_key TEXT,
          session_id TEXT,
          turn_id TEXT,
          started_at TEXT,
          payload_json TEXT,
          frame_json TEXT NOT NULL
        );

        CREATE INDEX IF NOT EXISTS idx_activity_conversation
          ON activity(conversation_key, seq);
        CREATE INDEX IF NOT EXISTS idx_activity_session
          ON activity(session_id, seq);
        CREATE INDEX IF NOT EXISTS idx_activity_turn
          ON activity(turn_id, seq);
        "#,
    )?;
    Ok(())
}

#[cfg(test)]
mod tests {
    use chrono::Utc;
    use serde_json::json;

    use super::*;
    use crate::types::{
        Actor, ActorKind, ErrorClass, Message, ReplyStatus, ReplyTarget, StopReason, TurnContext,
        TurnError, TurnTiming,
    };

    fn turn(text: impl Into<String>) -> NormalizedTurn {
        NormalizedTurn {
            turn_id: Some("turn_1".to_string()),
            request_id: Some("req_1".to_string()),
            idempotency_key: "idem_1".to_string(),
            connector: "web".to_string(),
            conversation_key: "web:thread".to_string(),
            sender: Actor {
                id: "user_1".to_string(),
                display: None,
                kind: ActorKind::Human,
                role: None,
            },
            message: Message {
                text: text.into(),
                attachments: vec![json!({ "large": "omitted" })],
            },
            reply_target: ReplyTarget::None,
            context: TurnContext::default(),
            require_reply: None,
        }
    }

    #[tokio::test]
    async fn trace_records_bounded_turn_terminal_and_activity() {
        let trace = TraceStore::memory().expect("trace");
        let now = Utc::now();
        let accepted = TurnAccepted {
            request_id: Some("req_1".to_string()),
            turn_id: "turn_1".to_string(),
            conversation_key: "web:thread".to_string(),
            status: TurnAdmissionStatus::Accepted,
            queued_at: now,
        };
        let oversized = "x".repeat(MAX_TRACE_TEXT_BYTES + 100);
        trace
            .record_turn_accepted(&turn(oversized), &accepted)
            .await
            .expect("record accepted");
        trace
            .record_session_bound("web:thread", "session_1", Some("web"), now)
            .await
            .expect("record session");
        trace
            .record_turn_started("turn_1", "web:thread", Some("session_1"), now)
            .await
            .expect("record started");
        trace
            .record_turn_terminal(
                &TurnTerminal {
                    turn_id: "turn_1".to_string(),
                    conversation_key: "web:thread".to_string(),
                    connector: Some("web".to_string()),
                    session_id: Some("session_1".to_string()),
                    timing: TurnTiming {
                        queued_at: now,
                        started_at: Some(now),
                        completed_at: Some(now),
                        duration_ms: Some(1),
                        queue_duration_ms: Some(0),
                        last_liveness_at: None,
                    },
                    reply_status: ReplyStatus::NoReply,
                    stop_reason: Some(StopReason::EndTurn),
                    error_class: None,
                    error: None,
                    usage: None,
                },
                "completed",
            )
            .await
            .expect("record terminal");
        trace
            .record_activity(&ActivityFrame {
                seq: 1,
                timestamp: now,
                kind: crate::types::ActivityKind::TurnCompleted,
                connector: Some("web".to_string()),
                conversation_key: Some("web:thread".to_string()),
                session_id: Some("session_1".to_string()),
                turn_id: Some("turn_1".to_string()),
                started_at: Some(now),
                payload: Some(json!({ "body": "y".repeat(MAX_TRACE_RECORD_BYTES + 1) })),
            })
            .await
            .expect("record activity");

        let traceback = trace
            .traceback(SessionTraceFilter {
                request_id: Some("trace_1".to_string()),
                conversation_key: Some("web:thread".to_string()),
                session_id: None,
                limit: None,
            })
            .await
            .expect("traceback");

        assert_eq!(traceback.turns.len(), 1);
        assert_eq!(traceback.turns[0].status, "completed");
        assert_eq!(traceback.turns[0].session_id.as_deref(), Some("session_1"));
        assert_eq!(
            traceback.turns[0].turn["message"]["text"]["trace_truncated"],
            true
        );
        assert_eq!(
            traceback.turns[0].turn["message"]["attachments"]["reason"],
            "attachments_omitted"
        );
        assert_eq!(traceback.activity.len(), 1);
        assert_eq!(
            traceback.activity[0].payload.as_ref().unwrap()["trace_truncated"],
            true
        );
    }

    #[tokio::test]
    async fn trace_rehydrates_active_sessions_and_preserves_rotations() {
        let dir = tempfile::tempdir().expect("tempdir");
        let path = dir.path().join(".hypercli-acp/trace.sqlite3");
        let trace = TraceStore::open(&path).expect("trace");
        let now = Utc::now();
        trace
            .record_session_bound("slack:thread", "session_a", Some("slack"), now)
            .await
            .expect("bind a");
        trace
            .record_session_rotated("slack:thread", now)
            .await
            .expect("rotate");
        trace
            .record_session_bound("slack:thread", "session_b", Some("slack"), now)
            .await
            .expect("bind b");

        let reopened = TraceStore::open(&path).expect("reopen");
        let active = reopened.load_active_sessions().await.expect("active");
        let sessions = reopened
            .list_sessions(Some("slack:thread"))
            .await
            .expect("sessions");

        assert_eq!(
            active.get("slack:thread").map(String::as_str),
            Some("session_b")
        );
        assert_eq!(sessions.len(), 2);
        assert!(sessions.iter().any(|session| session.rotated_at.is_some()));
    }

    #[tokio::test]
    async fn trace_prunes_activity_without_pruning_turns() {
        let trace = TraceStore::memory().expect("trace");
        let now = Utc::now();
        for seq in 1..=(MAX_TRACE_ACTIVITY_ROWS as u64 + 3) {
            trace
                .record_activity(&ActivityFrame {
                    seq,
                    timestamp: now,
                    kind: crate::types::ActivityKind::TurnLiveness,
                    connector: Some("web".to_string()),
                    conversation_key: Some("web:activity".to_string()),
                    session_id: Some("session_activity".to_string()),
                    turn_id: Some("turn_activity".to_string()),
                    started_at: Some(now),
                    payload: None,
                })
                .await
                .expect("activity");
        }

        let traceback = trace
            .traceback(SessionTraceFilter {
                request_id: None,
                conversation_key: Some("web:activity".to_string()),
                session_id: None,
                limit: Some(MAX_TRACE_ACTIVITY_ROWS + 10),
            })
            .await
            .expect("traceback");

        assert_eq!(traceback.activity.len(), MAX_TRACE_ACTIVITY_ROWS);
        assert_eq!(traceback.activity[0].seq, 4);
    }

    #[test]
    fn oversized_terminal_trace_keeps_key_fields() {
        let now = Utc::now();
        let terminal = TurnTerminal {
            turn_id: "turn_big".to_string(),
            conversation_key: "web:big".to_string(),
            connector: Some("web".to_string()),
            session_id: Some("session_big".to_string()),
            timing: TurnTiming {
                queued_at: now,
                started_at: Some(now),
                completed_at: Some(now),
                duration_ms: Some(10),
                queue_duration_ms: Some(1),
                last_liveness_at: None,
            },
            reply_status: ReplyStatus::Failed,
            stop_reason: Some(StopReason::RuntimeError),
            error_class: Some(ErrorClass::Runtime),
            error: Some(TurnError {
                code: "x".repeat(MAX_TRACE_RECORD_BYTES + 1),
                class: ErrorClass::Runtime,
                message: "too large".to_string(),
                retryable: true,
            }),
            usage: None,
        };

        let value = bounded_terminal(&terminal);

        assert_eq!(value["trace_truncated"], true);
        assert_eq!(value["turn_id"], "turn_big");
        assert_eq!(value["conversation_key"], "web:big");
        assert_eq!(value["session_id"], "session_big");
        assert_eq!(value["reply_status"], "failed");
        assert_eq!(value["stop_reason"], "runtime_error");
    }
}
