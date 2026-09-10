//! Per-adapter prompt delivery.
//!
//! The composed prompt ([`crate::prompt::PromptConfig`]) must reach the model
//! on every supported runtime, but ACP v1 has no schema-blessed channel for
//! it: `codex-acp` honors `_meta.systemPrompt` (`{append}` / `{replace}`),
//! v2-capable agents take the bare `session/new` `systemPrompt` field, and
//! v1 agents that ignore both (e.g. `opencode`) only see prompt content
//! blocks. This module picks the channel per agent, keyed off the agent's
//! `initialize` response identity:
//!
//! - `claude-*` agents: `session/new` `params._meta.systemPrompt` —
//!   `{replace}` when `HYPER_ACP_SYSTEM_PROMPT(_FILE)` overrides the base
//!   prompt, `{append}` otherwise.
//! - agents answering `initialize` with `protocolVersion >= 2`: the bare
//!   `params.systemPrompt` field.
//! - every other agent (v1 or unidentified): the composed prompt is stripped
//!   from `session/new` and prepended as a text content block to the FIRST
//!   `session/prompt` of that session (tracked per session id so it happens
//!   exactly once).

use std::borrow::Cow;
use std::collections::HashMap;
use std::sync::Mutex;
use std::time::Duration;

use anyhow::{Context, Result};
use serde_json::{Value, json};
use tokio::sync::Notify;

use crate::prompt::PromptConfig;

/// Upper bound for waiting on the agent's `initialize` response identity
/// before delivering `session/new`. Real agents answer `initialize` before
/// any `session/new` arrives (the client waits for the handshake); the
/// timeout only guards against agents that never respond, falling back to
/// prompt-channel delivery rather than stalling the session.
const IDENTITY_WAIT: Duration = Duration::from_secs(30);

/// Agent identity captured from its `initialize` response.
#[derive(Debug, Clone)]
struct AgentIdentity {
    /// `result.agentInfo.name`.
    name: String,
    /// `result.protocolVersion` the agent negotiated.
    protocol_version: u64,
}

/// How the composed prompt is delivered for the connected agent.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum Delivery {
    /// `session/new` `params._meta.systemPrompt` (`{append}` / `{replace}`).
    MetaSystemPrompt,
    /// Bare `session/new` `params.systemPrompt` field (protocol v2 support).
    BareField,
    /// Prepend a text block to the session's first `session/prompt`.
    PrependFirstPrompt,
}

#[derive(Debug, Default)]
struct AdapterState {
    identity: Option<AgentIdentity>,
    /// A client `initialize` request passed through; once seen, the adapter
    /// holds the first `session/new` until the response identity lands.
    initialize_seen: bool,
    /// `session/new` request ids awaiting their response (prepend delivery):
    /// the composed prompt is bound once the agent assigns a session id.
    pending_sessions: HashMap<String, String>,
    /// Session ids whose first `session/prompt` still needs the prepend.
    prepend_pending: HashMap<String, String>,
}

/// Stateful per-agent prompt delivery. Shared (via `Arc`) between a
/// transport's client-bound and agent-bound pumps.
#[derive(Debug)]
pub struct PromptAdapter {
    config: PromptConfig,
    state: Mutex<AdapterState>,
    identity_notify: Notify,
}

impl PromptAdapter {
    #[must_use]
    pub fn new(config: PromptConfig) -> Self {
        Self {
            config,
            state: Mutex::new(AdapterState::default()),
            identity_notify: Notify::new(),
        }
    }

    /// Observe one agent→client frame, capturing the agent identity from its
    /// `initialize` response and binding prepend-pending prompts to session
    /// ids as `session/new` responses pass through.
    ///
    /// The frame is never modified.
    pub fn observe_agent_frame(&self, text: &str) {
        let needs_identity = text.contains("agentInfo");
        let needs_binding = {
            let state = self.state.lock().unwrap();
            !state.pending_sessions.is_empty()
        };
        if !needs_identity && !needs_binding {
            return;
        }
        let Ok(value) = serde_json::from_str::<Value>(text) else {
            return;
        };
        match &value {
            Value::Array(items) => {
                for item in items {
                    self.observe_agent_response(item);
                }
            }
            item => self.observe_agent_response(item),
        }
    }

    fn observe_agent_response(&self, value: &Value) {
        let Some(result) = value.get("result") else {
            return;
        };
        let mut state = self.state.lock().unwrap();
        if let Some(name) = result
            .get("agentInfo")
            .and_then(|info| info.get("name"))
            .and_then(Value::as_str)
        {
            state.identity = Some(AgentIdentity {
                name: name.to_owned(),
                protocol_version: result
                    .get("protocolVersion")
                    .and_then(Value::as_u64)
                    .unwrap_or(1),
            });
            drop(state);
            self.identity_notify.notify_waiters();
            return;
        }
        if let Some(id) = value.get("id").map(id_key)
            && let Some(prompt) = state.pending_sessions.remove(&id)
            && let Some(session_id) = result.get("sessionId").and_then(Value::as_str)
        {
            state.prepend_pending.insert(session_id.to_owned(), prompt);
        }
    }

    /// Rewrite one client→agent frame for per-adapter prompt delivery.
    ///
    /// Non-`session/new` / non-`session/prompt` frames are returned
    /// byte-for-byte. Batch frames are rewritten element-wise.
    ///
    /// When the client has sent `initialize` but the agent's response has not
    /// been observed on the agent-bound pump yet, the first `session/new`
    /// waits (bounded by [`IDENTITY_WAIT`]) for the identity so the delivery
    /// channel is chosen deterministically.
    ///
    /// # Errors
    ///
    /// Returns an error when a rewritten frame cannot be serialized.
    pub async fn process_client_frame<'a>(&self, line: &'a str) -> Result<Cow<'a, str>> {
        if !line.contains("\"initialize\"") && !line.contains("session/") {
            return Ok(Cow::Borrowed(line));
        }
        let mut value: Value =
            serde_json::from_str(line).context("parse ACP frame for prompt delivery")?;
        let changed = match &mut value {
            Value::Array(items) => {
                let mut changed = false;
                for item in items {
                    changed |= self.process_client_element(item).await;
                }
                changed
            }
            item => self.process_client_element(item).await,
        };
        if changed {
            Ok(Cow::Owned(serde_json::to_string(&value)?))
        } else {
            Ok(Cow::Borrowed(line))
        }
    }

    async fn process_client_element(&self, frame: &mut Value) -> bool {
        match frame.get("method").and_then(Value::as_str) {
            Some("initialize") => {
                self.state.lock().unwrap().initialize_seen = true;
                false
            }
            Some("session/new") => self.deliver_on_session_new(frame).await,
            Some("session/prompt") => self.deliver_on_session_prompt(frame),
            _ => false,
        }
    }

    async fn deliver_on_session_new(&self, frame: &mut Value) -> bool {
        let request_id = frame.get("id").map(id_key);
        let Some(params) = frame.get_mut("params").and_then(Value::as_object_mut) else {
            return false;
        };
        let incoming = params
            .get("systemPrompt")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        let Some(prompt) = self.config.compose(incoming.as_deref()) else {
            return false;
        };
        self.wait_for_identity().await;
        match self.delivery() {
            Delivery::BareField => {
                params.insert("systemPrompt".to_owned(), Value::String(prompt));
            }
            Delivery::MetaSystemPrompt => {
                params.remove("systemPrompt");
                let key = if self.config.is_override() {
                    "replace"
                } else {
                    "append"
                };
                let system_prompt_meta = json!({ key: prompt });
                let meta = params
                    .entry("_meta")
                    .or_insert_with(|| Value::Object(serde_json::Map::new()));
                if let Some(existing) = meta.as_object_mut() {
                    existing.insert("systemPrompt".to_owned(), system_prompt_meta);
                } else {
                    *meta = json!({ "systemPrompt": system_prompt_meta });
                }
            }
            Delivery::PrependFirstPrompt => {
                params.remove("systemPrompt");
                match request_id {
                    Some(id) => {
                        self.state
                            .lock()
                            .unwrap()
                            .pending_sessions
                            .insert(id, prompt);
                    }
                    // A notification-shaped session/new can never be bound to
                    // a session id; keep the bare field so it is not lost.
                    None => {
                        params.insert("systemPrompt".to_owned(), Value::String(prompt));
                    }
                }
            }
        }
        true
    }

    fn deliver_on_session_prompt(&self, frame: &mut Value) -> bool {
        let Some(session_id) = frame
            .get("params")
            .and_then(|params| params.get("sessionId"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned)
        else {
            return false;
        };
        let prompt = {
            let mut state = self.state.lock().unwrap();
            let Some(prompt) = state.prepend_pending.remove(&session_id) else {
                return false;
            };
            prompt
        };
        let block = json!({ "type": "text", "text": prompt });
        let Some(params) = frame.get_mut("params").and_then(Value::as_object_mut) else {
            return false;
        };
        match params
            .entry("prompt")
            .or_insert_with(|| Value::Array(Vec::new()))
            .as_array_mut()
        {
            Some(blocks) => blocks.insert(0, block),
            None => {
                params.insert("prompt".to_owned(), Value::Array(vec![block]));
            }
        }
        true
    }

    /// Wait for the agent identity when a client `initialize` passed through
    /// but its response has not been observed yet. No-op for unidentified
    /// flows (no `initialize`) and bounded by [`IDENTITY_WAIT`].
    async fn wait_for_identity(&self) {
        loop {
            let notified = self.identity_notify.notified();
            tokio::pin!(notified);
            notified.as_mut().enable();
            {
                let state = self.state.lock().unwrap();
                if !state.initialize_seen || state.identity.is_some() {
                    return;
                }
            }
            if tokio::time::timeout(IDENTITY_WAIT, notified).await.is_err() {
                tracing::warn!(
                    "ACP agent initialize response not observed within {IDENTITY_WAIT:?}; \
                     delivering session/new prompt via the first-prompt channel"
                );
                return;
            }
        }
    }

    fn delivery(&self) -> Delivery {
        match &self.state.lock().unwrap().identity {
            Some(identity) if identity.name.to_ascii_lowercase().starts_with("claude") => {
                Delivery::MetaSystemPrompt
            }
            Some(identity) if identity.protocol_version >= 2 => Delivery::BareField,
            _ => Delivery::PrependFirstPrompt,
        }
    }
}

fn id_key(id: &Value) -> String {
    id.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    fn config(env: &[(&str, &str)]) -> PromptConfig {
        let env: std::collections::HashMap<&str, &str> = env.iter().copied().collect();
        PromptConfig::from_lookup(|name| env.get(name).map(|value| (*value).to_owned())).unwrap()
    }

    fn initialize_response(name: &str, protocol_version: u64) -> String {
        json!({
            "jsonrpc": "2.0",
            "id": 1,
            "result": {
                "protocolVersion": protocol_version,
                "agentInfo": { "name": name, "version": "0" },
                "agentCapabilities": {},
            },
        })
        .to_string()
    }

    fn session_new(id: u64) -> String {
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "method": "session/new",
            "params": { "cwd": "/tmp", "mcpServers": [] },
        })
        .to_string()
    }

    fn session_new_response(id: u64, session_id: &str) -> String {
        json!({
            "jsonrpc": "2.0",
            "id": id,
            "result": { "sessionId": session_id },
        })
        .to_string()
    }

    fn session_prompt(id: u64, session_id: &str, text: &str) -> String {
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

    #[tokio::test]
    async fn claude_agent_receives_meta_system_prompt_append() {
        let adapter = PromptAdapter::new(config(&[]));
        adapter.observe_agent_frame(&initialize_response("claude-code-acp", 1));

        let frame = session_new(2);
        let line = adapter.process_client_frame(&frame).await.unwrap();
        let value: Value = serde_json::from_str(&line).unwrap();

        assert!(value["params"].get("systemPrompt").is_none());
        let meta = value["params"]["_meta"]["systemPrompt"]["append"]
            .as_str()
            .unwrap();
        assert!(meta.contains("<base>"));
        assert!(meta.contains("HyperCLI hosted workspace"));
    }

    #[tokio::test]
    async fn claude_agent_receives_meta_system_prompt_replace_on_env_override() {
        let adapter = PromptAdapter::new(config(&[("HYPER_ACP_SYSTEM_PROMPT", "persona")]));
        adapter.observe_agent_frame(&initialize_response("claude-agent-acp", 1));

        let frame = session_new(2);
        let line = adapter.process_client_frame(&frame).await.unwrap();
        let value: Value = serde_json::from_str(&line).unwrap();

        assert!(value["params"].get("systemPrompt").is_none());
        assert_eq!(
            value["params"]["_meta"]["systemPrompt"],
            json!({ "replace": "persona" })
        );
    }

    #[tokio::test]
    async fn claude_meta_merge_preserves_existing_client_meta_fields() {
        let adapter = PromptAdapter::new(config(&[]));
        adapter.observe_agent_frame(&initialize_response("claude-code-acp", 1));
        let frame = json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "session/new",
            "params": { "cwd": "/tmp", "_meta": { "trace": "abc" } },
        })
        .to_string();

        let line = adapter.process_client_frame(&frame).await.unwrap();
        let value: Value = serde_json::from_str(&line).unwrap();

        assert_eq!(value["params"]["_meta"]["trace"], "abc");
        assert!(value["params"]["_meta"]["systemPrompt"]["append"].is_string());
    }

    #[tokio::test]
    async fn v2_agent_keeps_the_bare_system_prompt_field() {
        let adapter = PromptAdapter::new(config(&[]));
        adapter.observe_agent_frame(&initialize_response("fake-acp", 2));

        let frame = session_new(2);
        let line = adapter.process_client_frame(&frame).await.unwrap();
        let value: Value = serde_json::from_str(&line).unwrap();

        let prompt = value["params"]["systemPrompt"].as_str().unwrap();
        assert!(prompt.contains("<base>"));
        assert!(value["params"].get("_meta").is_none());
        // Prepend state must not engage for the bare-field path.
        adapter.observe_agent_frame(&session_new_response(2, "s1"));
        let prompt_frame = session_prompt(3, "s1", "hello");
        assert!(matches!(
            adapter.process_client_frame(&prompt_frame).await.unwrap(),
            Cow::Borrowed(returned) if returned == prompt_frame
        ));
    }

    #[tokio::test]
    async fn v1_opencode_prompt_is_prepended_to_the_first_turn_only() {
        let adapter = PromptAdapter::new(config(&[]));
        adapter.observe_agent_frame(&initialize_response("opencode", 1));

        let frame = session_new(2);
        let line = adapter.process_client_frame(&frame).await.unwrap();
        let value: Value = serde_json::from_str(&line).unwrap();
        assert!(value["params"].get("systemPrompt").is_none());
        assert!(value["params"].get("_meta").is_none());

        let response = session_new_response(2, "s1");
        adapter.observe_agent_frame(&response);

        let turn = session_prompt(3, "s1", "first turn");
        let first: Value =
            serde_json::from_str(&adapter.process_client_frame(&turn).await.unwrap()).unwrap();
        let blocks = first["params"]["prompt"].as_array().unwrap();
        assert_eq!(blocks.len(), 2);
        assert_eq!(blocks[0]["type"], "text");
        assert!(blocks[0]["text"].as_str().unwrap().contains("<base>"));
        assert_eq!(blocks[1]["text"], "first turn");

        let second_frame = session_prompt(4, "s1", "second turn");
        assert!(matches!(
            adapter.process_client_frame(&second_frame).await.unwrap(),
            Cow::Borrowed(returned) if returned == second_frame
        ));
    }

    #[tokio::test]
    async fn v1_override_is_prepended_verbatim_without_base_wrapper() {
        let adapter = PromptAdapter::new(config(&[("HYPER_ACP_SYSTEM_PROMPT", "persona")]));
        adapter.observe_agent_frame(&initialize_response("opencode", 1));

        drop(adapter.process_client_frame(&session_new(2)).await.unwrap());
        adapter.observe_agent_frame(&session_new_response(2, "s1"));
        let first: Value = serde_json::from_str(
            &adapter
                .process_client_frame(&session_prompt(3, "s1", "go"))
                .await
                .unwrap(),
        )
        .unwrap();

        assert_eq!(first["params"]["prompt"][0]["text"], "persona");
    }

    #[tokio::test]
    async fn unknown_agent_falls_back_to_prepend_delivery() {
        let adapter = PromptAdapter::new(config(&[]));
        // No initialize observed yet.
        let frame = session_new(2);
        let line = adapter.process_client_frame(&frame).await.unwrap();
        let value: Value = serde_json::from_str(&line).unwrap();
        assert!(value["params"].get("systemPrompt").is_none());

        adapter.observe_agent_frame(&session_new_response(2, "s1"));
        let first: Value = serde_json::from_str(
            &adapter
                .process_client_frame(&session_prompt(3, "s1", "go"))
                .await
                .unwrap(),
        )
        .unwrap();
        assert!(
            first["params"]["prompt"][0]["text"]
                .as_str()
                .unwrap()
                .contains("<base>")
        );
    }

    #[tokio::test]
    async fn prepend_delivery_is_tracked_per_session() {
        let adapter = PromptAdapter::new(config(&[]));
        adapter.observe_agent_frame(&initialize_response("opencode", 1));

        drop(adapter.process_client_frame(&session_new(2)).await.unwrap());
        drop(adapter.process_client_frame(&session_new(3)).await.unwrap());
        adapter.observe_agent_frame(&session_new_response(2, "s1"));

        // A different session first: untouched.
        let other = session_prompt(4, "s2", "other session");
        assert!(matches!(
            adapter.process_client_frame(&other).await.unwrap(),
            Cow::Borrowed(returned) if returned == other
        ));

        adapter.observe_agent_frame(&session_new_response(3, "s2"));
        let first_s2: Value =
            serde_json::from_str(&adapter.process_client_frame(&other).await.unwrap()).unwrap();
        assert!(
            first_s2["params"]["prompt"][0]["text"]
                .as_str()
                .unwrap()
                .contains("<base>")
        );

        // s1's first prompt still gets its own prepend.
        let first_s1: Value = serde_json::from_str(
            &adapter
                .process_client_frame(&session_prompt(5, "s1", "s1 turn"))
                .await
                .unwrap(),
        )
        .unwrap();
        assert!(
            first_s1["params"]["prompt"][0]["text"]
                .as_str()
                .unwrap()
                .contains("<base>")
        );
    }

    #[tokio::test]
    async fn client_system_prompt_layers_as_session_context_on_every_channel() {
        let frame = json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "session/new",
            "params": { "cwd": "/tmp", "systemPrompt": "client context" },
        })
        .to_string();

        // v1 (prepend)
        let adapter = PromptAdapter::new(config(&[]));
        adapter.observe_agent_frame(&initialize_response("opencode", 1));
        drop(adapter.process_client_frame(&frame).await.unwrap());
        adapter.observe_agent_frame(&session_new_response(2, "s1"));
        let first: Value = serde_json::from_str(
            &adapter
                .process_client_frame(&session_prompt(3, "s1", "go"))
                .await
                .unwrap(),
        )
        .unwrap();
        let text = first["params"]["prompt"][0]["text"].as_str().unwrap();
        assert!(text.contains("<session-context>\nclient context\n</session-context>"));

        // v2 (bare field)
        let adapter = PromptAdapter::new(config(&[]));
        adapter.observe_agent_frame(&initialize_response("fake-acp", 2));
        let line = adapter.process_client_frame(&frame).await.unwrap();
        let value: Value = serde_json::from_str(&line).unwrap();
        let prompt = value["params"]["systemPrompt"].as_str().unwrap();
        assert!(prompt.contains("<session-context>\nclient context\n</session-context>"));
    }

    #[tokio::test]
    async fn unrelated_frames_are_byte_preserved() {
        let adapter = PromptAdapter::new(config(&[]));
        adapter.observe_agent_frame(&initialize_response("opencode", 1));
        let line = r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#;
        assert!(matches!(
            adapter.process_client_frame(line).await.unwrap(),
            Cow::Borrowed(returned) if returned == line
        ));
    }

    #[tokio::test]
    async fn batch_session_new_frames_each_get_delivery() {
        let adapter = PromptAdapter::new(config(&[]));
        adapter.observe_agent_frame(&initialize_response("claude-agent-acp", 1));
        let batch = format!(
            "[{},{}]",
            session_new(2),
            r#"{"jsonrpc":"2.0","id":3,"method":"session/new","params":{"cwd":"/b"}}"#
        );

        let line = adapter.process_client_frame(&batch).await.unwrap();
        let items = serde_json::from_str::<Value>(&line).unwrap();
        let items = items.as_array().unwrap();
        for item in items {
            assert!(
                item["params"]["_meta"]["systemPrompt"]["append"]
                    .as_str()
                    .unwrap()
                    .contains("<base>")
            );
        }
    }

    #[tokio::test]
    async fn identity_capture_ignores_unrelated_responses() {
        let adapter = PromptAdapter::new(config(&[]));
        adapter.observe_agent_frame(&session_new_response(2, "s1"));
        adapter.observe_agent_frame(
            r#"{"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1"}}"#,
        );
        assert!(adapter.state.lock().unwrap().identity.is_none());
    }
}
