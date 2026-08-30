//! Reply threading and HyperCLI relay proxy request helpers.
//!
//! Provenance:
//! - `openclaw-git/extensions/slack/src/monitor/replies.ts`
//!   `resolveDeliveredSlackReplyThreadTs` lines 58-67 and `deliverReplies`
//!   lines 69-336 for reasoning-skip, media/text/block ordering, hook-facing
//!   content, and per-payload thread resolution.
//! - `openclaw-git/extensions/slack/src/native-data-fallback.ts` lines 36-51
//!   for hard-limit chunking.
//! - `openclaw-git/extensions/slack/src/limits.ts` line 2 for the 8000-char
//!   conservative transport text limit.
//! - HyperCLI constraint: relay auth is `HYPER_AGENTS_API_KEY`; this module does
//!   not assume direct Slack bot-token delivery and calls Slack Web API through
//!   the relay `/slack/api/*` proxy.

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;

use crate::relay_source::HYPER_AGENTS_API_KEY_ENV;

/// OpenClaw's conservative Slack text transport limit.
pub const SLACK_TEXT_LIMIT: usize = 8_000;
/// Slack message hard text limit used by fallback chunking.
pub const SLACK_MESSAGE_TEXT_HARD_LIMIT: usize = 40_000;

/// Reply-to mode.
#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum SlackReplyToMode {
    /// No reply tags.
    Off,
    /// First reply.
    First,
    /// All replies.
    All,
    /// Batched replies.
    Batched,
}

/// Resolves the delivered Slack thread timestamp.
#[must_use]
pub fn resolve_delivered_slack_reply_thread_ts(
    reply_to_mode: SlackReplyToMode,
    payload_reply_to_id: Option<&str>,
    reply_thread_ts: Option<&str>,
) -> Option<String> {
    let inline_reply_to_id = if reply_to_mode == SlackReplyToMode::Off {
        None
    } else {
        payload_reply_to_id.and_then(nonempty)
    };
    inline_reply_to_id
        .or_else(|| reply_thread_ts.and_then(nonempty))
        .map(ToOwned::to_owned)
}

/// A relay-authenticated Slack API proxy request.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackRelayApiProxyRequest {
    /// HTTP method.
    pub method: String,
    /// Full URL.
    pub url: String,
    /// Authorization header value.
    pub authorization: String,
    /// JSON body.
    pub body: Value,
}

/// One ACP-derived outbound Slack reply payload.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SlackReplyPayload {
    /// Text content.
    pub text: Option<String>,
    /// Media URLs or file/resource URLs.
    #[serde(default)]
    pub media_urls: Vec<String>,
    /// Slack-native Block Kit blocks, when already supplied by ACP metadata.
    #[serde(default)]
    pub blocks: Vec<Value>,
    /// Reasoning/thought payloads are not posted as Slack replies.
    #[serde(default)]
    pub is_reasoning: bool,
    /// Explicit per-payload reply id.
    pub reply_to_id: Option<String>,
    /// Durable delivery queue id used for Slack reconciliation metadata.
    #[serde(default)]
    pub delivery_queue_id: Option<String>,
}

/// Planned Slack API delivery.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackReplyDelivery {
    /// Request to send.
    pub request: SlackRelayApiProxyRequest,
    /// Hook-facing content that represents the visible Slack delivery.
    pub hook_content: String,
}

/// Delivered Slack message result subset.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackSendResult {
    /// Slack message timestamp.
    pub message_id: Option<String>,
    /// Raw Slack API response.
    pub response: Value,
}

/// Reply delivery target and limits shared across planned payloads.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub struct SlackReplyDeliveryTarget<'a> {
    /// Relay API base URL, without `/slack/api/...`.
    pub relay_api_base_url: &'a str,
    /// `HYPER_AGENTS_API_KEY` value.
    pub hyper_agents_api_key: &'a str,
    /// Slack channel id.
    pub channel: &'a str,
    /// Default Slack thread timestamp for replies.
    pub reply_thread_ts: Option<&'a str>,
    /// Reply threading mode.
    pub reply_to_mode: SlackReplyToMode,
    /// Text chunk limit.
    pub text_limit: usize,
}

/// Reply delivery errors.
#[derive(Debug, Error)]
pub enum SlackReplyDeliveryError {
    /// HTTP client error.
    #[error("Slack relay API request failed: {0}")]
    Http(#[from] reqwest::Error),
    /// Slack API returned `ok:false`.
    #[error("Slack API rejected {method}: {error}")]
    SlackApi {
        /// Slack method.
        method: String,
        /// Slack error.
        error: String,
    },
}

/// Builds a `chat.postMessage` proxy request using HyperCLI relay auth.
#[must_use]
pub fn build_chat_post_message_proxy_request(
    relay_api_base_url: &str,
    hyper_agents_api_key: &str,
    channel: &str,
    text: &str,
    thread_ts: Option<&str>,
) -> SlackRelayApiProxyRequest {
    let mut body = json!({
        "channel": channel,
        "text": text,
    });
    if let Some(thread_ts) = thread_ts.and_then(nonempty) {
        body.as_object_mut()
            .expect("json object")
            .insert("thread_ts".to_owned(), Value::String(thread_ts.to_owned()));
    }
    SlackRelayApiProxyRequest {
        method: "POST".to_owned(),
        url: format!(
            "{}/slack/api/chat.postMessage",
            relay_api_base_url.trim_end_matches('/')
        ),
        authorization: format!("Bearer {hyper_agents_api_key}"),
        body,
    }
}

/// Builds a `files.getUploadURLExternal` proxy request for relay-owned upload planning.
#[must_use]
pub fn build_files_get_upload_url_proxy_request(
    relay_api_base_url: &str,
    hyper_agents_api_key: &str,
    filename: &str,
    length: u64,
) -> SlackRelayApiProxyRequest {
    SlackRelayApiProxyRequest {
        method: "POST".to_owned(),
        url: format!(
            "{}/slack/api/files.getUploadURLExternal",
            relay_api_base_url.trim_end_matches('/')
        ),
        authorization: format!("Bearer {hyper_agents_api_key}"),
        body: json!({
            "filename": filename,
            "length": length,
        }),
    }
}

/// Builds a `files.completeUploadExternal` proxy request for relay-owned upload completion.
#[must_use]
pub fn build_files_complete_upload_proxy_request(
    relay_api_base_url: &str,
    hyper_agents_api_key: &str,
    channel: &str,
    file_id: &str,
    title: Option<&str>,
    thread_ts: Option<&str>,
) -> SlackRelayApiProxyRequest {
    let mut body = json!({
        "channel_id": channel,
        "files": [{"id": file_id, "title": title.and_then(nonempty).unwrap_or("file")}],
    });
    if let Some(thread_ts) = thread_ts.and_then(nonempty) {
        body.as_object_mut()
            .expect("json object")
            .insert("thread_ts".to_owned(), Value::String(thread_ts.to_owned()));
    }
    SlackRelayApiProxyRequest {
        method: "POST".to_owned(),
        url: format!(
            "{}/slack/api/files.completeUploadExternal",
            relay_api_base_url.trim_end_matches('/')
        ),
        authorization: format!("Bearer {hyper_agents_api_key}"),
        body,
    }
}

/// Builds an `assistant.threads.setStatus` proxy request.
#[must_use]
pub fn build_assistant_thread_status_proxy_request(
    relay_api_base_url: &str,
    hyper_agents_api_key: &str,
    channel: &str,
    thread_ts: &str,
    status: &str,
) -> SlackRelayApiProxyRequest {
    SlackRelayApiProxyRequest {
        method: "POST".to_owned(),
        url: format!(
            "{}/slack/api/assistant.threads.setStatus",
            relay_api_base_url.trim_end_matches('/')
        ),
        authorization: format!("Bearer {hyper_agents_api_key}"),
        body: json!({
            "channel_id": channel,
            "thread_ts": thread_ts,
            "status": status,
        }),
    }
}

/// Plans outbound Slack reply deliveries using HyperCLI relay API auth.
#[must_use]
pub fn plan_slack_reply_deliveries(
    relay_api_base_url: &str,
    hyper_agents_api_key: &str,
    channel: &str,
    reply_thread_ts: Option<&str>,
    reply_to_mode: SlackReplyToMode,
    payloads: &[SlackReplyPayload],
    text_limit: usize,
) -> Vec<SlackReplyDelivery> {
    let chunk_limit = text_limit.clamp(1, SLACK_TEXT_LIMIT);
    let mut deliveries = Vec::new();
    for payload in payloads {
        if payload.is_reasoning {
            continue;
        }
        let thread_ts = resolve_delivered_slack_reply_thread_ts(
            reply_to_mode,
            payload.reply_to_id.as_deref(),
            reply_thread_ts,
        );
        let text = payload
            .text
            .as_deref()
            .map(str::trim)
            .filter(|value| !value.is_empty());
        if text.is_none() && payload.media_urls.is_empty() && payload.blocks.is_empty() {
            continue;
        }
        if !payload.blocks.is_empty() {
            let base_text = text.unwrap_or_else(|| blocks_fallback_text(&payload.blocks));
            let delivery_queue_id = payload.delivery_queue_id.as_deref();
            let mut request = build_chat_post_message_proxy_request(
                relay_api_base_url,
                hyper_agents_api_key,
                channel,
                base_text,
                thread_ts.as_deref(),
            );
            request
                .body
                .as_object_mut()
                .expect("json object")
                .insert("blocks".to_owned(), Value::Array(payload.blocks.clone()));
            if let Some(metadata) =
                slack_delivery_metadata(delivery_queue_id, channel, thread_ts.as_deref(), 0, 1)
            {
                request
                    .body
                    .as_object_mut()
                    .expect("json object")
                    .insert("metadata".to_owned(), metadata);
            }
            deliveries.push(SlackReplyDelivery {
                request,
                hook_content: base_text.to_owned(),
            });
        } else if let Some(text) = text {
            for chunk in chunk_slack_text_at_hard_limit(text, chunk_limit) {
                deliveries.push(SlackReplyDelivery {
                    request: build_chat_post_message_proxy_request(
                        relay_api_base_url,
                        hyper_agents_api_key,
                        channel,
                        &chunk,
                        thread_ts.as_deref(),
                    ),
                    hook_content: chunk,
                });
            }
        }
        for media_url in payload
            .media_urls
            .iter()
            .map(String::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
        {
            let delivery_queue_id = payload.delivery_queue_id.as_deref();
            let media_text = format!("<{media_url}|Slack file attachment>");
            let mut request = build_chat_post_message_proxy_request(
                relay_api_base_url,
                hyper_agents_api_key,
                channel,
                &media_text,
                thread_ts.as_deref(),
            );
            request.body.as_object_mut().expect("json object").insert(
                "blocks".to_owned(),
                json!([{
                    "type": "section",
                    "text": {"type": "mrkdwn", "text": media_text},
                }]),
            );
            if let Some(metadata) =
                slack_delivery_metadata(delivery_queue_id, channel, thread_ts.as_deref(), 0, 1)
            {
                request
                    .body
                    .as_object_mut()
                    .expect("json object")
                    .insert("metadata".to_owned(), metadata);
            }
            deliveries.push(SlackReplyDelivery {
                request,
                hook_content: media_url.to_owned(),
            });
        }
    }
    deliveries
}

/// Chunks text without splitting UTF-8 scalar boundaries.
#[must_use]
pub fn chunk_slack_text_at_hard_limit(text: &str, limit: usize) -> Vec<String> {
    let effective_limit = limit.max(2);
    if text.is_empty() {
        return Vec::new();
    }
    let mut chunks = Vec::new();
    let mut current = String::new();
    for ch in text.chars() {
        if current.len() + ch.len_utf8() > effective_limit && !current.is_empty() {
            chunks.push(current);
            current = String::new();
        }
        current.push(ch);
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

/// Relay-backed Slack Web API sender.
#[derive(Debug, Clone)]
pub struct SlackRelayHttpSender {
    client: reqwest::Client,
}

impl Default for SlackRelayHttpSender {
    fn default() -> Self {
        Self::new()
    }
}

impl SlackRelayHttpSender {
    /// Creates a sender with a default reqwest client.
    #[must_use]
    pub fn new() -> Self {
        Self {
            client: reqwest::Client::new(),
        }
    }

    /// Sends one planned Slack API request.
    ///
    /// # Errors
    ///
    /// Returns HTTP errors or Slack `ok:false` responses.
    pub async fn send(
        &self,
        request: &SlackRelayApiProxyRequest,
    ) -> Result<SlackSendResult, SlackReplyDeliveryError> {
        let mut attempt = 0_u8;
        let response = loop {
            match self.send_once(request).await {
                Ok(response) => break response,
                Err(error) if attempt < 2 && is_transient_dns_error(&error) => {
                    attempt = attempt.saturating_add(1);
                    tokio::time::sleep(std::time::Duration::from_millis(250 * u64::from(attempt)))
                        .await;
                }
                Err(error) => return Err(error.into()),
            }
        };
        if response.get("ok").and_then(Value::as_bool) == Some(false) {
            let error = response
                .get("error")
                .and_then(Value::as_str)
                .unwrap_or("unknown_error")
                .to_owned();
            return Err(SlackReplyDeliveryError::SlackApi {
                method: request.url.clone(),
                error,
            });
        }
        let message_id = response
            .get("message")
            .and_then(|message| message.get("ts"))
            .or_else(|| response.get("ts"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned);
        Ok(SlackSendResult {
            message_id,
            response,
        })
    }

    async fn send_once(
        &self,
        request: &SlackRelayApiProxyRequest,
    ) -> Result<Value, reqwest::Error> {
        self.client
            .post(&request.url)
            .header(reqwest::header::AUTHORIZATION, &request.authorization)
            .json(&request.body)
            .send()
            .await?
            .error_for_status()?
            .json::<Value>()
            .await
    }
}

/// Sends reply payloads through the relay Slack Web API proxy.
///
/// # Errors
///
/// Returns the first HTTP or Slack API delivery failure.
pub async fn deliver_slack_reply_payloads(
    sender: &SlackRelayHttpSender,
    target: SlackReplyDeliveryTarget<'_>,
    payloads: &[SlackReplyPayload],
) -> Result<Vec<SlackSendResult>, SlackReplyDeliveryError> {
    let deliveries = plan_slack_reply_deliveries(
        target.relay_api_base_url,
        target.hyper_agents_api_key,
        target.channel,
        target.reply_thread_ts,
        target.reply_to_mode,
        payloads,
        target.text_limit,
    );
    let mut results = Vec::new();
    for delivery in &deliveries {
        results.push(sender.send(&delivery.request).await?);
    }
    Ok(results)
}

/// Documents the auth environment expected by callers.
#[must_use]
pub fn relay_reply_auth_env() -> &'static str {
    HYPER_AGENTS_API_KEY_ENV
}

fn blocks_fallback_text(blocks: &[Value]) -> &str {
    blocks
        .iter()
        .find_map(|block| {
            block
                .get("text")
                .and_then(|value| {
                    value
                        .as_str()
                        .or_else(|| value.get("text").and_then(Value::as_str))
                })
                .or_else(|| block.get("fallback").and_then(Value::as_str))
        })
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("Shared a Block Kit message")
}

fn slack_delivery_metadata(
    queue_id: Option<&str>,
    channel_id: &str,
    thread_ts: Option<&str>,
    part_index: usize,
    part_count: usize,
) -> Option<Value> {
    let queue_id = queue_id.and_then(nonempty)?;
    Some(json!({
        "event_type": "openclaw_delivery",
        "event_payload": {
            "openclaw_delivery_id": queue_id,
            "openclaw_delivery_part_index": part_index,
            "openclaw_delivery_part_count": part_count,
            "hypercli_delivery_channel": channel_id,
            "hypercli_delivery_thread_ts": thread_ts.unwrap_or(""),
        },
    }))
}

fn is_transient_dns_error(error: &reqwest::Error) -> bool {
    let message = error.to_string();
    Regex::new(r"(?i)\b(EAI_AGAIN|ENOTFOUND|UND_ERR_DNS_RESOLVE_FAILED|dns)\b")
        .expect("valid DNS retry regex")
        .is_match(&message)
}

fn nonempty(value: &str) -> Option<&str> {
    let trimmed = value.trim();
    if trimmed.is_empty() {
        None
    } else {
        Some(trimmed)
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reply_thread_ts_preserves_openclaw_precedence() {
        assert_eq!(
            resolve_delivered_slack_reply_thread_ts(
                SlackReplyToMode::All,
                Some("payload"),
                Some("thread")
            ),
            Some("payload".to_owned())
        );
        assert_eq!(
            resolve_delivered_slack_reply_thread_ts(
                SlackReplyToMode::Off,
                Some("payload"),
                Some("thread")
            ),
            Some("thread".to_owned())
        );
    }

    #[test]
    fn proxy_request_uses_hyper_agents_key_not_slack_token() {
        let request = build_chat_post_message_proxy_request(
            "https://relay.example.com/",
            "key",
            "C1",
            "hi",
            Some("1.2"),
        );
        assert_eq!(
            request.url,
            "https://relay.example.com/slack/api/chat.postMessage"
        );
        assert_eq!(request.authorization, "Bearer key");
        assert_eq!(request.body["thread_ts"], "1.2");
        assert_eq!(relay_reply_auth_env(), "HYPER_AGENTS_API_KEY");
    }

    #[test]
    fn plans_text_chunks_blocks_media_and_skips_reasoning() {
        let deliveries = plan_slack_reply_deliveries(
            "https://relay.example",
            "key",
            "C1",
            Some("100.1"),
            SlackReplyToMode::All,
            &[
                SlackReplyPayload {
                    text: Some("abcdef".to_owned()),
                    media_urls: vec![],
                    blocks: vec![],
                    is_reasoning: false,
                    reply_to_id: None,
                    delivery_queue_id: None,
                },
                SlackReplyPayload {
                    text: Some("thinking".to_owned()),
                    media_urls: vec![],
                    blocks: vec![],
                    is_reasoning: true,
                    reply_to_id: None,
                    delivery_queue_id: None,
                },
                SlackReplyPayload {
                    text: Some("chart".to_owned()),
                    media_urls: vec![],
                    blocks: vec![json!({"type":"section","text":{"type":"mrkdwn","text":"chart"}})],
                    is_reasoning: false,
                    reply_to_id: None,
                    delivery_queue_id: None,
                },
                SlackReplyPayload {
                    text: None,
                    media_urls: vec!["https://files.example/a.png".to_owned()],
                    blocks: vec![],
                    is_reasoning: false,
                    reply_to_id: None,
                    delivery_queue_id: Some("queue-1".to_owned()),
                },
            ],
            3,
        );
        assert_eq!(deliveries.len(), 4);
        assert_eq!(deliveries[0].request.body["text"], "abc");
        assert_eq!(deliveries[1].request.body["text"], "def");
        assert!(deliveries[2].request.body.get("blocks").is_some());
        assert_eq!(
            deliveries[3].request.body["text"],
            "<https://files.example/a.png|Slack file attachment>"
        );
        assert!(deliveries[3].request.body.get("blocks").is_some());
        assert_eq!(
            deliveries[3].request.body["metadata"]["event_payload"]["openclaw_delivery_id"],
            "queue-1"
        );
        assert_eq!(deliveries[0].request.body["thread_ts"], "100.1");
    }

    #[test]
    fn status_request_uses_assistant_thread_endpoint() {
        let request = build_assistant_thread_status_proxy_request(
            "https://relay.example/",
            "key",
            "C1",
            "100.1",
            "Working",
        );
        assert_eq!(
            request.url,
            "https://relay.example/slack/api/assistant.threads.setStatus"
        );
        assert_eq!(request.body["status"], "Working");
    }

    #[test]
    fn upload_plan_requests_use_relay_file_endpoints() {
        let start =
            build_files_get_upload_url_proxy_request("https://relay.example/", "key", "a.png", 12);
        assert_eq!(
            start.url,
            "https://relay.example/slack/api/files.getUploadURLExternal"
        );
        assert_eq!(start.authorization, "Bearer key");
        assert_eq!(start.body["filename"], "a.png");
        assert_eq!(start.body["length"], 12);

        let complete = build_files_complete_upload_proxy_request(
            "https://relay.example/",
            "key",
            "C1",
            "F1",
            Some("a.png"),
            Some("100.1"),
        );
        assert_eq!(
            complete.url,
            "https://relay.example/slack/api/files.completeUploadExternal"
        );
        assert_eq!(complete.body["channel_id"], "C1");
        assert_eq!(complete.body["files"][0]["id"], "F1");
        assert_eq!(complete.body["thread_ts"], "100.1");
    }
}
