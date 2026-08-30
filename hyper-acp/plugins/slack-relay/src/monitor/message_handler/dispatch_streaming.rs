//! ACP output to Slack reply delivery pipeline.
//!
//! Provenance:
//! - `openclaw-git/extensions/slack/src/monitor/replies.ts` lines 69-336 for
//!   reply payload filtering, chunking, native-block/media ordering, and
//!   delivered thread timestamp precedence.
//! - `openclaw-git/extensions/slack/src/monitor/message-handler/dispatch-streaming.ts`
//!   lines 1-220 and `dispatch-progress.ts` lines 1-170 for the relevant
//!   status/progress split: normal final text is durable reply delivery while
//!   progress/status is best-effort Slack thread status.
//! - `agent-client-protocol-schema/src/v1/agent.rs` lines 3022-3122 and
//!   `src/v1/client.rs` lines 45-120 for `session/prompt`, prompt responses,
//!   and `session/update` frame shapes.

use std::collections::HashMap;

use serde_json::Value;
use thiserror::Error;
use tokio::sync::mpsc;

use crate::client::{SlackDirectClientConfig, SlackDirectWebApiClient, SlackWebApiError};
use crate::monitor::message_handler::dispatch_progress::{
    session_update_kind, status_text_for_state_update, status_text_for_update,
};
use crate::monitor::message_handler::dispatch_setup::read_hypercli_slack_meta;
use crate::relay_source::HYPER_AGENTS_API_KEY_ENV;
use crate::reply::{
    build_assistant_thread_status_operation, plan_slack_reply_deliveries,
    relay_request_for_operation, SlackRelayApiProxyRequest, SlackRelayHttpSender,
    SlackReplyDelivery, SlackReplyDeliveryError, SlackReplyPayload, SlackReplyToMode,
    SLACK_TEXT_LIMIT,
};

/// Optional relay API base URL for Slack Web API proxy calls.
pub const HYPER_ACP_SLACK_RELAY_API_URL_ENV: &str = "HYPER_ACP_SLACK_RELAY_API_URL";
/// Optional outbound text chunk limit.
pub const HYPER_ACP_SLACK_TEXT_LIMIT_ENV: &str = "HYPER_ACP_SLACK_TEXT_LIMIT";

/// Raw ACP frame direction.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlackAcpFrameDirection {
    /// Client-to-agent frame, used to observe generated `session/prompt` meta.
    ClientToAgent,
    /// Agent-to-client frame, used to observe `session/update` and prompt responses.
    AgentToClient,
}

/// Raw observed ACP frame.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackAcpObservedFrame {
    /// Direction.
    pub direction: SlackAcpFrameDirection,
    /// Raw JSON-RPC frame text.
    pub text: String,
}

/// Output delivery config.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackAcpOutputConfig {
    /// Relay API base URL, without `/slack/api/...`.
    pub relay_api_base_url: Option<String>,
    /// `HYPER_AGENTS_API_KEY` value.
    pub hyper_agents_api_key: Option<String>,
    /// Text chunk limit.
    pub text_limit: usize,
    /// Default reply mode.
    pub reply_to_mode: SlackReplyToMode,
    /// Direct Slack bot-token client config, when output should bypass relay proxy.
    pub direct_client_config: Option<SlackDirectClientConfig>,
}

impl SlackAcpOutputConfig {
    /// Builds output config from environment plus an optional relay websocket URL.
    ///
    /// # Errors
    ///
    /// Returns `Ok(None)` only when neither relay nor direct Slack credentials exist.
    pub fn from_env(relay_url: Option<&str>) -> Result<Option<Self>, SlackAcpOutputError> {
        let relay_api_base_url = env_var(HYPER_ACP_SLACK_RELAY_API_URL_ENV)
            .or_else(|| relay_url.and_then(derive_relay_api_base_url));
        let direct_client_config = SlackDirectClientConfig::from_env().ok();
        if relay_api_base_url.is_none() && direct_client_config.is_none() {
            return Ok(None);
        }
        let hyper_agents_api_key = env_var(HYPER_AGENTS_API_KEY_ENV);
        if relay_api_base_url.is_some()
            && hyper_agents_api_key.is_none()
            && direct_client_config.is_none()
        {
            return Err(SlackAcpOutputError::MissingEnv(HYPER_AGENTS_API_KEY_ENV));
        }
        let text_limit = env_var(HYPER_ACP_SLACK_TEXT_LIMIT_ENV)
            .and_then(|value| value.parse::<usize>().ok())
            .unwrap_or(SLACK_TEXT_LIMIT);
        Ok(Some(Self {
            relay_api_base_url,
            hyper_agents_api_key,
            text_limit,
            reply_to_mode: SlackReplyToMode::All,
            direct_client_config,
        }))
    }
}

/// Planned ACP-output Slack API request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SlackAcpOutputDelivery {
    /// Slack visible reply message.
    Reply(SlackReplyDelivery),
    /// Best-effort assistant thread status.
    Status(SlackStatusDelivery),
}

/// Planned assistant-thread status delivery.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackStatusDelivery {
    /// Transport-neutral Slack Web API operation.
    pub operation: crate::client::SlackWebApiOperation,
    /// Relay proxy request for relay mode.
    pub request: Option<SlackRelayApiProxyRequest>,
}

/// Output processing errors.
#[derive(Debug, Error)]
pub enum SlackAcpOutputError {
    /// Missing env var.
    #[error("{0} is required for Slack ACP output delivery")]
    MissingEnv(&'static str),
    /// Invalid relay URL.
    #[error("Slack relay API URL cannot be derived from {0}")]
    InvalidRelayUrl(String),
    /// JSON parse error.
    #[error("ACP output frame is not valid JSON: {0}")]
    Json(#[from] serde_json::Error),
    /// Reply delivery error.
    #[error(transparent)]
    Delivery(#[from] SlackReplyDeliveryError),
    /// Direct Slack Web API delivery error.
    #[error(transparent)]
    DirectSlack(#[from] SlackWebApiError),
    /// Relay delivery requested without relay credentials.
    #[error("Slack ACP output has no relay delivery credentials")]
    MissingRelayDeliveryConfig,
}

/// Mutable output processing state.
#[derive(Debug, Default)]
pub struct SlackAcpOutputState {
    turns_by_request_id: HashMap<String, SlackOutputTurn>,
    active_request_by_session_id: HashMap<String, String>,
}

impl SlackAcpOutputState {
    /// Processes one raw ACP frame and returns Slack delivery requests.
    ///
    /// # Errors
    ///
    /// Returns JSON parsing errors for malformed ACP frames.
    pub fn process_frame(
        &mut self,
        config: &SlackAcpOutputConfig,
        observed: &SlackAcpObservedFrame,
    ) -> Result<Vec<SlackAcpOutputDelivery>, SlackAcpOutputError> {
        let value = serde_json::from_str::<Value>(&observed.text)?;
        let envelopes = match value {
            Value::Array(values) => values,
            value @ Value::Object(_) => vec![value],
            other => {
                return Err(serde_json::Error::io(std::io::Error::new(
                    std::io::ErrorKind::InvalidData,
                    format!("ACP frame must be object or batch, got {other}"),
                ))
                .into())
            }
        };
        let mut deliveries = Vec::new();
        for envelope in envelopes {
            if let Some(delivery) = self.process_envelope(config, observed.direction, &envelope) {
                deliveries.extend(delivery);
            }
        }
        Ok(deliveries)
    }

    fn process_envelope(
        &mut self,
        config: &SlackAcpOutputConfig,
        direction: SlackAcpFrameDirection,
        envelope: &Value,
    ) -> Option<Vec<SlackAcpOutputDelivery>> {
        match direction {
            SlackAcpFrameDirection::ClientToAgent => {
                self.observe_prompt_request(envelope);
                None
            }
            SlackAcpFrameDirection::AgentToClient => self.observe_agent_frame(config, envelope),
        }
    }

    fn observe_prompt_request(&mut self, envelope: &Value) {
        if envelope.get("method").and_then(Value::as_str) != Some("session/prompt") {
            return;
        }
        let Some(request_id) = request_id_key(envelope.get("id")) else {
            return;
        };
        let Some(params) = envelope.get("params") else {
            return;
        };
        let Some(session_id) = params.get("sessionId").and_then(Value::as_str) else {
            return;
        };
        let Some(slack_meta) = read_hypercli_slack_meta(params) else {
            return;
        };
        let channel = slack_meta
            .get("message")
            .and_then(|message| message.get("channel"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        let reply_thread_ts = slack_meta
            .get("reply_thread_ts")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        let reply_to_mode = slack_meta
            .get("reply_to_mode")
            .and_then(Value::as_str)
            .and_then(parse_reply_to_mode)
            .unwrap_or(SlackReplyToMode::All);
        let Some(channel) = channel else {
            return;
        };
        let turn = SlackOutputTurn {
            session_id: session_id.to_owned(),
            channel,
            reply_thread_ts,
            reply_to_mode,
            buffered_text: String::new(),
            media_urls: Vec::new(),
            blocks: Vec::new(),
            payloads: Vec::new(),
            sent_final: false,
        };
        self.turns_by_request_id.insert(request_id.clone(), turn);
        self.active_request_by_session_id
            .insert(session_id.to_owned(), request_id);
    }

    fn observe_agent_frame(
        &mut self,
        config: &SlackAcpOutputConfig,
        envelope: &Value,
    ) -> Option<Vec<SlackAcpOutputDelivery>> {
        if is_response(envelope) {
            return self.complete_prompt_response(config, envelope);
        }
        let method = envelope.get("method").and_then(Value::as_str)?;
        if method != "session/update" && method != "sessionUpdate" {
            return None;
        }
        let params = envelope.get("params")?;
        let session_id = params.get("sessionId").and_then(Value::as_str)?;
        let request_id = self.active_request_by_session_id.get(session_id)?.clone();
        let turn = self.turns_by_request_id.get_mut(&request_id)?;
        let update = params.get("update")?;
        match session_update_kind(update)? {
            "agent_message_chunk" | "agentMessageChunk" => {
                let payload = reply_payload_from_content_update(update, false);
                turn.push_reply_payload(payload);
                None
            }
            "agent_thought_chunk" | "agentThoughtChunk" => {
                let payload = reply_payload_from_content_update(update, true);
                if !payload.is_empty() {
                    turn.payloads.push(payload);
                }
                Some(turn.plan_status(config, "Thinking"))
            }
            "tool_call"
            | "toolCall"
            | "tool_call_update"
            | "toolCallUpdate"
            | "plan"
            | "plan_update"
            | "planUpdate"
            | "plan_removed"
            | "planRemoved"
            | "current_mode_update"
            | "currentModeUpdate"
            | "available_commands_update"
            | "availableCommandsUpdate"
            | "config_option_update"
            | "configOptionUpdate"
            | "session_info_update"
            | "sessionInfoUpdate"
            | "notice"
            | "compaction_update"
            | "compactionUpdate" => Some(turn.plan_status(config, status_text_for_update(update))),
            "state_update"
            | "stateUpdate"
            | "usage_update"
            | "usageUpdate"
            | "compaction_summary_chunk"
            | "compactionSummaryChunk" => {
                Some(turn.plan_status(config, status_text_for_state_update(update)))
            }
            _ => None,
        }
    }

    fn complete_prompt_response(
        &mut self,
        config: &SlackAcpOutputConfig,
        envelope: &Value,
    ) -> Option<Vec<SlackAcpOutputDelivery>> {
        let request_id = request_id_key(envelope.get("id"))?;
        let mut turn = self.turns_by_request_id.remove(&request_id)?;
        self.active_request_by_session_id.remove(&turn.session_id);
        if turn.sent_final {
            return None;
        }
        if envelope.get("error").is_some() && turn.buffered_text.trim().is_empty() {
            "The agent failed before sending a Slack-visible reply."
                .clone_into(&mut turn.buffered_text);
        }
        turn.sent_final = true;
        let mut deliveries = turn.plan_final_replies(config);
        deliveries.extend(turn.plan_status(config, "Idle"));
        Some(deliveries)
    }
}

/// Runs the ACP output processor and posts planned deliveries through Slack relay API.
///
/// # Errors
///
/// Returns the first JSON or Slack delivery error.
pub async fn run_slack_acp_output_to_replies(
    config: SlackAcpOutputConfig,
    mut frames: mpsc::Receiver<SlackAcpObservedFrame>,
) -> Result<(), SlackAcpOutputError> {
    let sender = SlackRelayHttpSender::new();
    let direct_sender = config
        .direct_client_config
        .clone()
        .map(SlackDirectWebApiClient::new);
    let mut state = SlackAcpOutputState::default();
    while let Some(frame) = frames.recv().await {
        let deliveries = match state.process_frame(&config, &frame) {
            Ok(deliveries) => deliveries,
            Err(SlackAcpOutputError::Json(error)) => {
                eprintln!("slack output ignored malformed ACP frame: {error}");
                continue;
            }
            Err(error) => return Err(error),
        };
        for delivery in deliveries {
            match delivery {
                SlackAcpOutputDelivery::Reply(reply) => {
                    if let Some(direct_sender) = &direct_sender {
                        send_direct_with_retry(direct_sender, &reply.operation).await?;
                    } else {
                        let request = reply
                            .request
                            .as_ref()
                            .ok_or(SlackAcpOutputError::MissingRelayDeliveryConfig)?;
                        sender.send(request).await?;
                    }
                }
                SlackAcpOutputDelivery::Status(status) => {
                    if let Some(direct_sender) = &direct_sender {
                        send_direct_nonfatal(direct_sender, &status.operation).await;
                    } else if let Some(request) = &status.request {
                        if let Err(error) = sender.send(request).await {
                            eprintln!("slack status delivery failed: {error}");
                        }
                    }
                }
            }
        }
    }
    Ok(())
}

async fn send_direct_nonfatal(
    sender: &SlackDirectWebApiClient,
    operation: &crate::client::SlackWebApiOperation,
) {
    if let Err(SlackWebApiError::RateLimited {
        retry_after_seconds,
    }) = sender.send(operation).await
    {
        let delay = retry_after_seconds.unwrap_or(1).min(30);
        tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
        let _result = sender.send(operation).await;
    }
}

async fn send_direct_with_retry(
    sender: &SlackDirectWebApiClient,
    operation: &crate::client::SlackWebApiOperation,
) -> Result<(), SlackAcpOutputError> {
    match sender.send(operation).await {
        Ok(_) => Ok(()),
        Err(SlackWebApiError::RateLimited {
            retry_after_seconds,
        }) => {
            let delay = retry_after_seconds.unwrap_or(1).min(30);
            tokio::time::sleep(std::time::Duration::from_secs(delay)).await;
            sender.send(operation).await?;
            Ok(())
        }
        Err(error) => Err(error.into()),
    }
}

#[derive(Debug, Clone, PartialEq)]
struct SlackOutputTurn {
    session_id: String,
    channel: String,
    reply_thread_ts: Option<String>,
    reply_to_mode: SlackReplyToMode,
    buffered_text: String,
    media_urls: Vec<String>,
    blocks: Vec<Value>,
    payloads: Vec<SlackReplyPayload>,
    sent_final: bool,
}

impl SlackOutputTurn {
    fn plan_final_replies(&self, config: &SlackAcpOutputConfig) -> Vec<SlackAcpOutputDelivery> {
        let mut payloads = self.payloads.clone();
        let aggregate_payload = SlackReplyPayload {
            text: (!self.buffered_text.trim().is_empty()).then(|| self.buffered_text.clone()),
            media_urls: self.media_urls.clone(),
            blocks: self.blocks.clone(),
            is_reasoning: false,
            reply_to_id: None,
            delivery_queue_id: None,
        };
        if !aggregate_payload.is_empty() {
            payloads.push(aggregate_payload);
        }
        plan_slack_reply_deliveries(
            config.relay_api_base_url.as_deref().unwrap_or(""),
            config.hyper_agents_api_key.as_deref().unwrap_or(""),
            &self.channel,
            self.reply_thread_ts.as_deref(),
            self.reply_to_mode,
            &payloads,
            config.text_limit,
        )
        .into_iter()
        .map(SlackAcpOutputDelivery::Reply)
        .collect()
    }

    fn plan_status(
        &self,
        config: &SlackAcpOutputConfig,
        status: &str,
    ) -> Vec<SlackAcpOutputDelivery> {
        let Some(thread_ts) = self.reply_thread_ts.as_deref() else {
            return Vec::new();
        };
        vec![SlackAcpOutputDelivery::Status({
            let operation =
                build_assistant_thread_status_operation(&self.channel, thread_ts, status);
            let request = config
                .relay_api_base_url
                .as_deref()
                .zip(config.hyper_agents_api_key.as_deref())
                .and_then(|(api_base, key)| relay_request_for_operation(api_base, key, &operation));
            SlackStatusDelivery { operation, request }
        })]
    }

    fn push_reply_payload(&mut self, payload: SlackReplyPayload) {
        if payload.reply_to_id.is_some() || payload.delivery_queue_id.is_some() {
            self.payloads.push(payload);
            return;
        }
        if let Some(text) = payload.text {
            if !self.buffered_text.is_empty() && !self.buffered_text.ends_with('\n') {
                self.buffered_text.push('\n');
            }
            self.buffered_text.push_str(&text);
        }
        self.media_urls.extend(payload.media_urls);
        self.blocks.extend(payload.blocks);
    }
}

impl SlackReplyPayload {
    fn is_empty(&self) -> bool {
        self.text.as_deref().is_none_or(str::is_empty)
            && self.media_urls.is_empty()
            && self.blocks.is_empty()
    }
}

fn reply_payload_from_content_update(update: &Value, is_reasoning: bool) -> SlackReplyPayload {
    let slack_meta = update
        .get("_meta")
        .and_then(|meta| meta.get("hypercli.slack"));
    let content = update.get("content");
    let text = slack_meta
        .and_then(|slack| slack.get("text"))
        .and_then(Value::as_str)
        .or_else(|| content.and_then(content_text))
        .map(ToOwned::to_owned);
    let mut media_urls = slack_meta
        .and_then(|slack| slack.get("mediaUrls").or_else(|| slack.get("media_urls")))
        .and_then(Value::as_array)
        .map(|items| {
            items
                .iter()
                .filter_map(Value::as_str)
                .map(ToOwned::to_owned)
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    if let Some(url) = slack_meta
        .and_then(|slack| slack.get("mediaUrl").or_else(|| slack.get("media_url")))
        .and_then(Value::as_str)
        .or_else(|| content.and_then(content_media_url))
    {
        media_urls.push(url.to_owned());
    }
    let blocks = slack_meta
        .and_then(|slack| slack.get("blocks"))
        .and_then(Value::as_array)
        .cloned()
        .unwrap_or_default();
    SlackReplyPayload {
        text,
        media_urls,
        blocks,
        is_reasoning,
        reply_to_id: update
            .get("_meta")
            .and_then(|meta| meta.get("hypercli.slack"))
            .and_then(|slack| slack.get("reply_to_id"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        delivery_queue_id: update
            .get("_meta")
            .and_then(|meta| meta.get("hypercli.slack"))
            .and_then(|slack| slack.get("delivery_queue_id"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
    }
}

fn content_text(content: &Value) -> Option<&str> {
    match content.get("type").and_then(Value::as_str)? {
        "text" => content.get("text").and_then(Value::as_str),
        _ => None,
    }
}

fn content_media_url(content: &Value) -> Option<&str> {
    match content.get("type").and_then(Value::as_str)? {
        "image" => content
            .get("uri")
            .or_else(|| content.get("url"))
            .and_then(Value::as_str),
        "resource_link" => content.get("uri").and_then(Value::as_str),
        "resource" => content
            .get("resource")
            .and_then(|resource| resource.get("uri"))
            .and_then(Value::as_str),
        _ => None,
    }
}

fn parse_reply_to_mode(value: &str) -> Option<SlackReplyToMode> {
    match value.trim() {
        "off" => Some(SlackReplyToMode::Off),
        "first" => Some(SlackReplyToMode::First),
        "all" => Some(SlackReplyToMode::All),
        "batched" => Some(SlackReplyToMode::Batched),
        _ => None,
    }
}

fn request_id_key(value: Option<&Value>) -> Option<String> {
    let value = value?;
    match value {
        Value::String(value) => Some(Value::String(value.clone()).to_string()),
        Value::Number(_) | Value::Bool(_) | Value::Null => Some(value.to_string()),
        Value::Array(_) | Value::Object(_) => None,
    }
}

fn is_response(envelope: &Value) -> bool {
    envelope.get("method").is_none()
        && envelope.get("id").is_some()
        && (envelope.get("result").is_some() || envelope.get("error").is_some())
}

fn env_var(name: &'static str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .or_else(|| {
            let legacy = name.strip_prefix("HYPER_ACP_SLACK_")?;
            let legacy_name = format!("HYPER_SLACK_{legacy}");
            std::env::var(legacy_name)
                .ok()
                .map(|value| value.trim().to_owned())
                .filter(|value| !value.is_empty())
        })
}

fn derive_relay_api_base_url(raw: &str) -> Option<String> {
    let mut url = url::Url::parse(raw).ok()?;
    match url.scheme() {
        "ws" => url.set_scheme("http").ok()?,
        "wss" => url.set_scheme("https").ok()?,
        "http" | "https" => {}
        _ => return None,
    }
    url.set_path("");
    url.set_query(None);
    url.set_fragment(None);
    Some(url.to_string().trim_end_matches('/').to_owned())
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn config() -> SlackAcpOutputConfig {
        SlackAcpOutputConfig {
            relay_api_base_url: Some("https://relay.example".to_owned()),
            hyper_agents_api_key: Some("key".to_owned()),
            text_limit: 4,
            reply_to_mode: SlackReplyToMode::All,
            direct_client_config: None,
        }
    }

    #[test]
    fn correlates_prompt_updates_and_completion_into_chunked_reply() {
        let mut state = SlackAcpOutputState::default();
        let prompt = json!({
            "jsonrpc":"2.0",
            "id":1,
            "method":"session/prompt",
            "params":{
                "sessionId":"s1",
                "_meta":{"hypercli.slack":{
                    "message":{"channel":"C1"},
                    "reply_thread_ts":"100.1",
                    "reply_to_mode":"all"
                }}
            }
        });
        state
            .process_frame(
                &config(),
                &SlackAcpObservedFrame {
                    direction: SlackAcpFrameDirection::ClientToAgent,
                    text: prompt.to_string(),
                },
            )
            .unwrap();
        let update = json!({
            "jsonrpc":"2.0",
            "method":"session/update",
            "params":{
                "sessionId":"s1",
                "update":{
                    "sessionUpdate":"agent_message_chunk",
                    "content":{"type":"text","text":"abcdef"}
                }
            }
        });
        assert!(state
            .process_frame(
                &config(),
                &SlackAcpObservedFrame {
                    direction: SlackAcpFrameDirection::AgentToClient,
                    text: update.to_string(),
                },
            )
            .unwrap()
            .is_empty());
        let completion = json!({"jsonrpc":"2.0","id":1,"result":{"stopReason":"end_turn"}});
        let deliveries = state
            .process_frame(
                &config(),
                &SlackAcpObservedFrame {
                    direction: SlackAcpFrameDirection::AgentToClient,
                    text: completion.to_string(),
                },
            )
            .unwrap();
        assert_eq!(deliveries.len(), 3);
        let SlackAcpOutputDelivery::Reply(first) = &deliveries[0] else {
            panic!("expected reply");
        };
        let request = first.request.as_ref().unwrap();
        assert_eq!(request.body["text"], "abcd");
        assert_eq!(request.body["thread_ts"], "100.1");
    }

    #[test]
    fn plans_status_for_tool_updates_without_final_text() {
        let mut state = SlackAcpOutputState::default();
        let prompt = json!({
            "jsonrpc":"2.0","id":"r1","method":"session/prompt",
            "params":{"sessionId":"s1","_meta":{"hypercli.slack":{"message":{"channel":"C1"},"reply_thread_ts":"100.1"}}}
        });
        state
            .process_frame(
                &config(),
                &SlackAcpObservedFrame {
                    direction: SlackAcpFrameDirection::ClientToAgent,
                    text: prompt.to_string(),
                },
            )
            .unwrap();
        let update = json!({
            "jsonrpc":"2.0","method":"session/update",
            "params":{"sessionId":"s1","update":{"sessionUpdate":"tool_call"}}
        });
        let deliveries = state
            .process_frame(
                &config(),
                &SlackAcpObservedFrame {
                    direction: SlackAcpFrameDirection::AgentToClient,
                    text: update.to_string(),
                },
            )
            .unwrap();
        assert!(matches!(deliveries[0], SlackAcpOutputDelivery::Status(_)));
        let SlackAcpOutputDelivery::Status(status) = &deliveries[0] else {
            panic!("expected status");
        };
        assert_eq!(
            status.operation.method(),
            Some("assistant.threads.setStatus")
        );
        assert_eq!(
            status.request.as_ref().unwrap().url,
            "https://relay.example/slack/api/assistant.threads.setStatus"
        );
    }

    #[test]
    fn handles_canonical_update_kinds_reasoning_and_structured_payloads() {
        let mut state = SlackAcpOutputState::default();
        let prompt = json!({
            "jsonrpc":"2.0","id":"r1","method":"session/prompt",
            "params":{"sessionId":"s1","_meta":{"hypercli.slack":{"message":{"channel":"C1"},"reply_thread_ts":"100.1","reply_to_mode":"first"}}}
        });
        state
            .process_frame(
                &config(),
                &SlackAcpObservedFrame {
                    direction: SlackAcpFrameDirection::ClientToAgent,
                    text: prompt.to_string(),
                },
            )
            .unwrap();
        let reasoning = json!({
            "jsonrpc":"2.0","method":"session/update",
            "params":{"sessionId":"s1","update":{"sessionUpdate":"agent_thought_chunk","content":{"type":"text","text":"hidden"}}}
        });
        let status = state
            .process_frame(
                &config(),
                &SlackAcpObservedFrame {
                    direction: SlackAcpFrameDirection::AgentToClient,
                    text: reasoning.to_string(),
                },
            )
            .unwrap();
        assert!(matches!(status[0], SlackAcpOutputDelivery::Status(_)));

        let update = json!({
            "jsonrpc":"2.0","method":"session/update",
            "params":{"sessionId":"s1","update":{
                "sessionUpdate":"agent_message_chunk",
                "content":{"type":"image","uri":"https://example.com/final.png"},
                "_meta":{"hypercli.slack":{
                    "text":"Photo",
                    "mediaUrls":["https://example.com/a.png"],
                    "mediaUrl":"https://example.com/b.png",
                    "blocks":[{"type":"section","text":{"type":"mrkdwn","text":"Photo"}}],
                    "reply_to_id":"200.2",
                    "delivery_queue_id":"dq1"
                }}
            }}
        });
        assert!(state
            .process_frame(
                &config(),
                &SlackAcpObservedFrame {
                    direction: SlackAcpFrameDirection::AgentToClient,
                    text: update.to_string(),
                },
            )
            .unwrap()
            .is_empty());

        let batch = json!([
            {"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"plan_update"}}},
            {"jsonrpc":"2.0","method":"session/update","params":{"sessionId":"s1","update":{"sessionUpdate":"usage_update","state":"working"}}},
            {"jsonrpc":"2.0","id":"r1","result":{"stopReason":"end_turn"}}
        ]);
        let deliveries = state
            .process_frame(
                &config(),
                &SlackAcpObservedFrame {
                    direction: SlackAcpFrameDirection::AgentToClient,
                    text: batch.to_string(),
                },
            )
            .unwrap();
        assert!(matches!(deliveries[0], SlackAcpOutputDelivery::Status(_)));
        assert!(matches!(deliveries[1], SlackAcpOutputDelivery::Status(_)));
        let reply = deliveries
            .iter()
            .find_map(|delivery| match delivery {
                SlackAcpOutputDelivery::Reply(reply)
                    if reply.request.as_ref().unwrap().body["metadata"]["event_payload"]
                        ["openclaw_delivery_id"]
                        == "dq1" =>
                {
                    Some(reply)
                }
                SlackAcpOutputDelivery::Status(_) | SlackAcpOutputDelivery::Reply(_) => None,
            })
            .expect("metadata-carrying reply delivery");
        let request = reply.request.as_ref().unwrap();
        assert_eq!(request.body["thread_ts"], "200.2");
        assert_eq!(
            request.body["metadata"]["event_payload"]["openclaw_delivery_id"],
            "dq1"
        );
        assert_eq!(request.body["text"], "Photo");
        assert_eq!(reply.operation.method(), Some("chat.postMessage"));
        assert!(!deliveries.iter().any(|delivery| match delivery {
            SlackAcpOutputDelivery::Reply(reply) => reply.hook_content.contains("hidden"),
            SlackAcpOutputDelivery::Status(_) => false,
        }));
    }

    #[test]
    fn direct_output_config_uses_same_reply_and_status_operations() {
        let mut state = SlackAcpOutputState::default();
        let mut direct_config = config();
        direct_config.direct_client_config = Some(SlackDirectClientConfig {
            bot_token: "xoxb-direct".to_owned(),
            api_base_url: "https://slack.example/api".to_owned(),
        });
        let prompt = json!({
            "jsonrpc":"2.0","id":"r1","method":"session/prompt",
            "params":{"sessionId":"s1","_meta":{"hypercli.slack":{"message":{"channel":"C1"},"reply_thread_ts":"100.1"}}}
        });
        state
            .process_frame(
                &direct_config,
                &SlackAcpObservedFrame {
                    direction: SlackAcpFrameDirection::ClientToAgent,
                    text: prompt.to_string(),
                },
            )
            .unwrap();
        let update = json!({
            "jsonrpc":"2.0","method":"session/update",
            "params":{"sessionId":"s1","update":{"sessionUpdate":"agent_message_chunk","content":{"type":"text","text":"hi"}}}
        });
        assert!(state
            .process_frame(
                &direct_config,
                &SlackAcpObservedFrame {
                    direction: SlackAcpFrameDirection::AgentToClient,
                    text: update.to_string(),
                },
            )
            .unwrap()
            .is_empty());
        let deliveries = state
            .process_frame(
                &direct_config,
                &SlackAcpObservedFrame {
                    direction: SlackAcpFrameDirection::AgentToClient,
                    text: json!({"jsonrpc":"2.0","id":"r1","result":{"stopReason":"end_turn"}})
                        .to_string(),
                },
            )
            .unwrap();
        let reply = deliveries
            .iter()
            .find_map(|delivery| match delivery {
                SlackAcpOutputDelivery::Reply(reply) => Some(reply),
                SlackAcpOutputDelivery::Status(_) => None,
            })
            .expect("reply delivery");
        assert_eq!(reply.operation.method(), Some("chat.postMessage"));
        let direct_request = crate::reply::direct_request_for_delivery(
            direct_config.direct_client_config.as_ref().unwrap(),
            reply,
        );
        assert_eq!(
            direct_request.url,
            "https://slack.example/api/chat.postMessage"
        );
        assert_eq!(
            direct_request.authorization.as_deref(),
            Some("Bearer xoxb-direct")
        );
    }

    #[test]
    fn output_config_allows_direct_bot_token_without_relay_env() {
        let _env = crate::test_env_lock();
        std::env::remove_var(HYPER_ACP_SLACK_RELAY_API_URL_ENV);
        std::env::remove_var("HYPER_SLACK_RELAY_API_URL");
        std::env::remove_var(HYPER_AGENTS_API_KEY_ENV);
        std::env::set_var(crate::client::SLACK_BOT_TOKEN_ENV, "xoxb-direct-only");
        let config = SlackAcpOutputConfig::from_env(None).unwrap().unwrap();
        assert!(config.relay_api_base_url.is_none());
        assert!(config.hyper_agents_api_key.is_none());
        assert_eq!(
            config.direct_client_config.unwrap().bot_token,
            "xoxb-direct-only"
        );
        std::env::remove_var(crate::client::SLACK_BOT_TOKEN_ENV);
    }

    #[test]
    fn output_config_reads_legacy_hyper_slack_relay_api_url() {
        let _env = crate::test_env_lock();
        std::env::remove_var(HYPER_ACP_SLACK_RELAY_API_URL_ENV);
        std::env::set_var("HYPER_SLACK_RELAY_API_URL", "https://legacy-relay.example");
        std::env::set_var(HYPER_AGENTS_API_KEY_ENV, "relay-key");
        let config = SlackAcpOutputConfig::from_env(None).unwrap().unwrap();
        assert_eq!(
            config.relay_api_base_url.as_deref(),
            Some("https://legacy-relay.example")
        );
        std::env::remove_var("HYPER_SLACK_RELAY_API_URL");
        std::env::remove_var(HYPER_AGENTS_API_KEY_ENV);
    }

    #[test]
    fn derives_relay_api_base_from_websocket_url() {
        assert_eq!(
            derive_relay_api_base_url("wss://relay.example/slack/ws?gateway_id=1").as_deref(),
            Some("https://relay.example")
        );
    }
}
