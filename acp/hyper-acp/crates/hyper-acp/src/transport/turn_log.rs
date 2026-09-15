//! Per-session in-flight turn registry and boundary logging.
//!
//! Feeds on validated ACP frames from the [`AcpFrameObserver`] sink and
//! tracks, per session id, the prompt currently executing in the agent. It
//! logs one `tracing::info!` event per turn boundary: `turn executing` when
//! a client→agent `session/prompt` request passes through, and `turn done`
//! when the agent's `session/prompt` response (carrying `stopReason`) passes
//! back. `session/update` notifications in between are counted per session.
//!
//! Redaction is load-bearing: the prompt adapter injects pod prompt text
//! into `params.prompt`, so every frame body is treated as sensitive and
//! only metadata is logged — session ids, request ids, stop reasons,
//! durations, and update counts. Prompt content, params, and frame bodies
//! are never logged.

use std::collections::HashMap;
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde_json::Value;

use super::{AcpFrameObserver, Direction};

/// One in-flight prompt turn.
#[derive(Debug)]
struct InFlightTurn {
    started: Instant,
    updates: u32,
    /// `session/prompt` request id, used to bind the agent's `stopReason`
    /// response back to this session.
    request_id: String,
}

#[derive(Debug, Default)]
struct TurnLogState {
    /// Session id -> in-flight turn.
    turns: HashMap<String, InFlightTurn>,
    /// `session/prompt` request id -> session id; request ids are unique per
    /// upstream connection, so a response can be bound back to its session.
    prompt_sessions: HashMap<String, String>,
}

/// Per-session in-flight turn registry.
///
/// Shared (via internal `Arc`) between a transport's client-bound and
/// agent-bound pumps: every clone observes into the same state, mirroring
/// [`crate::adapter::PromptAdapter`]. A second `session/prompt` on an
/// already-tracked session replaces the previous entry because clients
/// serialize prompts per session.
#[derive(Debug, Clone, Default)]
pub struct TurnLog {
    state: Arc<Mutex<TurnLogState>>,
}

impl TurnLog {
    /// Create an empty turn log.
    #[must_use]
    pub fn new() -> Self {
        Self::default()
    }

    /// Build an [`AcpFrameObserver`] that feeds this turn log.
    #[must_use]
    pub fn observer(&self) -> AcpFrameObserver {
        AcpFrameObserver::turn_log(self.clone())
    }

    /// Drop all in-flight turns and prompt bindings.
    ///
    /// Used when a transport resets eras (outbound WebSocket reconnect): the
    /// reconnecting client re-enters with `initialize`/`session/load`, so
    /// dead-era turns can never end cleanly.
    pub fn reset_in_flight(&self) {
        let cleared = {
            let mut state = self.state.lock().unwrap();
            let cleared = state.turns.len();
            state.turns.clear();
            state.prompt_sessions.clear();
            cleared
        };
        if cleared > 0 {
            tracing::info!(cleared, "in-flight turns cleared on socket era reset");
        }
    }

    pub(crate) fn observe(&self, direction: Direction, text: &str) {
        if !text.contains("session/prompt")
            && !text.contains("session/update")
            && !text.contains("stopReason")
            && !text.contains("\"error\"")
        {
            return;
        }
        let Ok(value) = serde_json::from_str::<Value>(text) else {
            return;
        };
        match &value {
            Value::Array(items) => {
                for item in items {
                    self.observe_element(direction, item);
                }
            }
            item => self.observe_element(direction, item),
        }
    }

    fn observe_element(&self, direction: Direction, frame: &Value) {
        match direction {
            Direction::ClientToAgent => self.observe_client_frame(frame),
            Direction::AgentToClient => self.observe_agent_frame(frame),
        }
    }

    fn observe_client_frame(&self, frame: &Value) {
        if frame.get("method").and_then(Value::as_str) != Some("session/prompt") {
            return;
        }
        let Some(session_id) = frame
            .get("params")
            .and_then(|params| params.get("sessionId"))
            .and_then(Value::as_str)
        else {
            return;
        };
        let Some(request_id) = frame.get("id").and_then(request_id_key) else {
            return;
        };
        {
            let mut state = self.state.lock().unwrap();
            // A second prompt on a tracked session replaces the prior entry;
            // the superseded request binding is dropped so its late response
            // cannot complete the replacement turn.
            if let Some(previous) = state.turns.remove(session_id) {
                state.prompt_sessions.remove(&previous.request_id);
            }
            state
                .prompt_sessions
                .insert(request_id.clone(), session_id.to_owned());
            state.turns.insert(
                session_id.to_owned(),
                InFlightTurn {
                    started: Instant::now(),
                    updates: 0,
                    request_id: request_id.clone(),
                },
            );
        }
        tracing::info!(
            session_id = %session_id,
            request_id = %request_id,
            "turn executing"
        );
    }

    fn observe_agent_frame(&self, frame: &Value) {
        if let Some(method) = frame.get("method").and_then(Value::as_str) {
            if method == "session/update"
                && let Some(session_id) = frame
                    .get("params")
                    .and_then(|params| params.get("sessionId"))
                    .and_then(Value::as_str)
                && let Some(turn) = self.state.lock().unwrap().turns.get_mut(session_id)
            {
                turn.updates = turn.updates.saturating_add(1);
            }
            return;
        }
        let Some(request_id) = frame.get("id").and_then(request_id_key) else {
            return;
        };
        // A turn ends on `result.stopReason` or on a JSON-RPC error; an
        // errored prompt must not leak its registry entry.
        let stop_reason = if let Some(reason) = frame
            .get("result")
            .and_then(|result| result.get("stopReason"))
            .and_then(Value::as_str)
        {
            reason.to_owned()
        } else if let Some(error) = frame.get("error") {
            let code = error.get("code").and_then(Value::as_i64).unwrap_or(0);
            format!("error:{code}")
        } else {
            return;
        };
        let ended = {
            let mut state = self.state.lock().unwrap();
            state
                .prompt_sessions
                .remove(&request_id)
                .and_then(|session_id| {
                    state
                        .turns
                        .remove(&session_id)
                        .map(|turn| (session_id, turn))
                })
        };
        if let Some((session_id, turn)) = ended {
            let duration_ms = u64::try_from(turn.started.elapsed().as_millis()).unwrap_or(u64::MAX);
            tracing::info!(
                session_id = %session_id,
                request_id = %turn.request_id,
                stop_reason = %stop_reason,
                duration_ms,
                updates = turn.updates,
                "turn done"
            );
        }
    }
}

/// Normalize a JSON-RPC request id (integer or string) to its key form.
fn request_id_key(id: &Value) -> Option<String> {
    match id {
        Value::String(text) => Some(text.clone()),
        Value::Number(number) => Some(number.to_string()),
        _ => None,
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use serde_json::json;

    #[derive(Clone, Default)]
    struct SharedBuffer(Arc<Mutex<Vec<u8>>>);

    impl SharedBuffer {
        fn text(&self) -> String {
            String::from_utf8(self.0.lock().unwrap().clone()).unwrap()
        }
    }

    impl std::io::Write for SharedBuffer {
        fn write(&mut self, buf: &[u8]) -> std::io::Result<usize> {
            self.0.lock().unwrap().extend_from_slice(buf);
            Ok(buf.len())
        }
        fn flush(&mut self) -> std::io::Result<()> {
            Ok(())
        }
    }

    fn captured<F>(body: F) -> String
    where
        F: FnOnce(),
    {
        let buffer = SharedBuffer::default();
        let subscriber = tracing_subscriber::fmt()
            .with_ansi(false)
            .without_time()
            .with_max_level(tracing::Level::INFO)
            .with_writer({
                let buffer = buffer.clone();
                move || buffer.clone()
            })
            .finish();
        tracing::subscriber::with_default(subscriber, body);
        buffer.text()
    }

    fn prompt(id: u64, session_id: &str, text: &str) -> String {
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "session/prompt",
            "params": {
                "sessionId": session_id,
                "prompt": [{ "type": "text", "text": text }],
            },
        })
        .to_string()
    }

    fn update(session_id: &str) -> String {
        json!({
            "jsonrpc": "2.0",
            "method": "session/update",
            "params": {
                "sessionId": session_id,
                "update": {
                    "sessionUpdate": "agent_message_chunk",
                    "content": { "type": "text", "text": "stream text" },
                },
            },
        })
        .to_string()
    }

    fn stop(id: u64, reason: &str) -> String {
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": { "stopReason": reason },
        })
        .to_string()
    }

    #[test]
    fn turn_lifecycle_logs_executing_and_done_with_update_count() {
        let turn_log = TurnLog::new();
        let logs = captured(|| {
            turn_log.observe(
                Direction::ClientToAgent,
                &prompt(7, "s1", "secret prompt body"),
            );
            turn_log.observe(Direction::AgentToClient, &update("s1"));
            turn_log.observe(Direction::AgentToClient, &update("s1"));
            turn_log.observe(Direction::AgentToClient, &stop(7, "end_turn"));
        });

        assert!(logs.contains("turn executing"));
        assert!(logs.contains("session_id=s1"));
        assert!(logs.contains("request_id=7"));
        assert!(logs.contains("turn done"));
        assert!(logs.contains("stop_reason=end_turn"));
        assert!(logs.contains("updates=2"));
        assert!(logs.contains("duration_ms="));
        assert!(!logs.contains("secret prompt body"));
        assert!(!logs.contains("stream text"));

        let state = turn_log.state.lock().unwrap();
        assert!(state.turns.is_empty());
        assert!(state.prompt_sessions.is_empty());
    }

    #[test]
    fn stop_response_with_unknown_id_is_ignored() {
        let turn_log = TurnLog::new();
        let logs = captured(|| {
            turn_log.observe(Direction::AgentToClient, &stop(7, "end_turn"));
            turn_log.observe(Direction::AgentToClient, &update("s1"));
        });

        assert!(!logs.contains("turn executing"));
        assert!(!logs.contains("turn done"));
        let state = turn_log.state.lock().unwrap();
        assert!(state.turns.is_empty());
        assert!(state.prompt_sessions.is_empty());
    }

    #[test]
    fn era_reset_clears_in_flight_turns_and_prompt_bindings() {
        let turn_log = TurnLog::new();
        turn_log.observe(Direction::ClientToAgent, &prompt(7, "s1", "x"));
        turn_log.observe(Direction::AgentToClient, &update("s1"));

        turn_log.observer().reset_in_flight_turns();
        {
            let state = turn_log.state.lock().unwrap();
            assert!(state.turns.is_empty());
            assert!(state.prompt_sessions.is_empty());
        }

        let logs = captured(|| turn_log.observe(Direction::AgentToClient, &stop(7, "end_turn")));
        assert!(!logs.contains("turn done"));
    }

    #[test]
    fn interleaved_sessions_track_independently() {
        let turn_log = TurnLog::new();
        let logs = captured(|| {
            turn_log.observe(Direction::ClientToAgent, &prompt(1, "s1", "a"));
            turn_log.observe(Direction::ClientToAgent, &prompt(2, "s2", "b"));
            turn_log.observe(Direction::AgentToClient, &update("s1"));
            turn_log.observe(Direction::AgentToClient, &update("s2"));
            turn_log.observe(Direction::AgentToClient, &update("s2"));
            turn_log.observe(Direction::AgentToClient, &stop(2, "tool_use"));
            turn_log.observe(Direction::AgentToClient, &update("s1"));
            turn_log.observe(Direction::AgentToClient, &stop(1, "end_turn"));
        });

        assert_eq!(logs.matches("turn executing").count(), 2);
        let s1_done = logs
            .lines()
            .find(|line| line.contains("turn done") && line.contains("session_id=s1"))
            .unwrap();
        assert!(s1_done.contains("request_id=1"));
        assert!(s1_done.contains("stop_reason=end_turn"));
        assert!(s1_done.contains("updates=2"));
        let s2_done = logs
            .lines()
            .find(|line| line.contains("turn done") && line.contains("session_id=s2"))
            .unwrap();
        assert!(s2_done.contains("request_id=2"));
        assert!(s2_done.contains("stop_reason=tool_use"));
        assert!(s2_done.contains("updates=2"));

        let state = turn_log.state.lock().unwrap();
        assert!(state.turns.is_empty());
        assert!(state.prompt_sessions.is_empty());
    }

    #[test]
    fn second_prompt_on_session_replaces_previous_turn() {
        let turn_log = TurnLog::new();
        let logs = captured(|| {
            turn_log.observe(Direction::ClientToAgent, &prompt(1, "s1", "a"));
            turn_log.observe(Direction::AgentToClient, &update("s1"));
            turn_log.observe(Direction::ClientToAgent, &prompt(3, "s1", "b"));
            // The late response for the superseded request must not complete
            // the replacement turn.
            turn_log.observe(Direction::AgentToClient, &stop(1, "end_turn"));
        });

        assert_eq!(logs.matches("turn executing").count(), 2);
        assert!(!logs.contains("turn done"));
        {
            let state = turn_log.state.lock().unwrap();
            assert_eq!(state.turns.len(), 1);
            let turn = state.turns.get("s1").unwrap();
            assert_eq!(turn.request_id, "3");
            assert_eq!(state.prompt_sessions.len(), 1);
            assert!(!state.prompt_sessions.contains_key("1"));
        }

        let logs = captured(|| {
            turn_log.observe(Direction::AgentToClient, &stop(3, "refusal"));
        });
        assert!(logs.contains("turn done"));
        assert!(logs.contains("request_id=3"));
        assert!(logs.contains("stop_reason=refusal"));
        let state = turn_log.state.lock().unwrap();
        assert!(state.turns.is_empty());
        assert!(state.prompt_sessions.is_empty());
    }

    #[test]
    fn batch_frames_are_handled_elementwise_and_directions_are_respected() {
        let turn_log = TurnLog::new();
        let batch_prompt = format!(
            "[{},{}]",
            prompt(9, "s9", "x"),
            r#"{"jsonrpc":"2.0","method":"initialized"}"#
        );
        turn_log.observe(Direction::ClientToAgent, &batch_prompt);
        let batch_updates = format!("[{},{}]", update("s9"), update("s9"));
        turn_log.observe(Direction::AgentToClient, &batch_updates);
        // Wrong-direction frames must not be interpreted.
        turn_log.observe(Direction::AgentToClient, &prompt(10, "s10", "y"));
        turn_log.observe(Direction::ClientToAgent, &update("s9"));

        let state = turn_log.state.lock().unwrap();
        assert_eq!(state.turns.get("s9").unwrap().updates, 2);
        assert!(!state.turns.contains_key("s10"));
        assert_eq!(
            state.prompt_sessions.get("9"),
            Some(&"s9".to_owned()),
            "prompt id must bind to its session"
        );
    }

    #[test]
    fn error_response_ends_turn_without_leaking_registry_entries() {
        let turn_log = TurnLog::new();
        let error = json!({
            "jsonrpc": "2.0",
            "id": 7,
            "error": { "code": -32603, "message": "internal error" },
        })
        .to_string();
        let logs = captured(|| {
            turn_log.observe(Direction::ClientToAgent, &prompt(7, "s1", "x"));
            turn_log.observe(Direction::AgentToClient, &error);
        });

        assert!(logs.contains("turn done"));
        assert!(logs.contains("stop_reason=error:-32603"));
        assert!(!logs.contains("internal error"));
        let state = turn_log.state.lock().unwrap();
        assert!(state.turns.is_empty());
        assert!(state.prompt_sessions.is_empty());
    }

    #[tokio::test]
    async fn observer_sink_routes_frames_into_the_shared_log() {
        let turn_log = TurnLog::new();
        let observer = turn_log.observer();
        // Observer clones, like the two pump tasks hold, feed the same state.
        let clone = observer.clone();
        observer
            .observe(Direction::ClientToAgent, &prompt(7, "s1", "x"))
            .await
            .unwrap();
        clone
            .observe(Direction::AgentToClient, &update("s1"))
            .await
            .unwrap();

        let state = turn_log.state.lock().unwrap();
        assert_eq!(state.turns.get("s1").unwrap().updates, 1);
        assert_eq!(
            state.prompt_sessions.get("7"),
            Some(&"s1".to_owned()),
            "request id must be recorded as its JSON key form"
        );
    }
}
