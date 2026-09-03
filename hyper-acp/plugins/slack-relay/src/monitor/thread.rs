//! Slack thread/history unroll helpers.
//!
//! Provenance:
//! - `openclaw-git/extensions/slack/src/monitor/message-handler/timestamp.ts`
//!   lines 4-16.
//! - `openclaw-git/extensions/slack/src/monitor/thread.ts` lines 73-217 for
//!   `conversations.replies` starter/history fetching, page caps, file-only
//!   placeholders, and capped incomplete history behavior.
//! - `openclaw-git/extensions/slack/src/monitor/message-handler/prepare-thread-context.ts`
//!   seed decision lines 176-200, root media hydration lines 248-268,
//!   visibility filtering lines 327-356, and history formatting lines 368-395.
//! - `openclaw-git/src/security/context-visibility.ts` lines 27-76 for
//!   supplemental context visibility decisions.

use regex::Regex;
use serde_json::{json, Value};

use crate::allowlist::resolve_slack_allow_list_match;
use crate::client::{conversations_replies_operation, files_info_operation, SlackWebApiOperation};
use crate::monitor::media::slack_file_metadata_allowed;
use crate::monitor::message_handler::prepare_content::{
    format_slack_file_reference_list, SlackFile,
};
use crate::monitor::replies::SlackRelayApiProxyRequest;

/// Slack recommends no more than 200 replies per page.
pub const SLACK_THREAD_HISTORY_FETCH_LIMIT: usize = 200;
/// OpenClaw caps cold thread history fetches at three pages.
pub const SLACK_THREAD_HISTORY_MAX_PAGES: usize = 3;

/// Slack thread session freshness.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlackSessionFreshness {
    /// No stored reset state.
    Missing,
    /// Existing session is fresh.
    Fresh,
    /// Existing session is stale.
    Stale,
}

/// Thread history message.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackThreadHistoryMessage {
    /// Text.
    pub text: String,
    /// Slack timestamp.
    pub ts: Option<String>,
    /// Slack user id.
    pub user_id: Option<String>,
    /// Slack bot id.
    pub bot_id: Option<String>,
    /// Optional resolved sender name.
    pub sender_name: Option<String>,
    /// Slack files attached to this history message.
    pub files: Vec<SlackFile>,
}

/// Slack context visibility policy.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlackContextVisibility {
    /// Include all supplemental thread context.
    All,
    /// Include only allowed senders.
    Allowlist,
    /// Same as allowlist for thread context; quote override is not applicable.
    AllowlistQuote,
}

/// One `conversations.replies` page.
#[derive(Debug, Clone, PartialEq)]
pub struct SlackThreadRepliesPage {
    /// Slack messages in oldest-to-newest page order.
    pub messages: Vec<Value>,
    /// Slack `response_metadata.next_cursor`.
    pub next_cursor: Option<String>,
}

/// Result of resolving bounded thread history from Web API pages.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackThreadHistoryResolution {
    /// Retained history messages.
    pub messages: Vec<SlackThreadHistoryMessage>,
    /// Number of pages consumed.
    pub pages_fetched: usize,
    /// Whether the fetch stopped because the OpenClaw page cap was hit.
    pub capped_incomplete: bool,
}

/// Thread starter media hydration result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackHydratedMedia {
    /// Slack file id.
    pub file_id: Option<String>,
    /// File name.
    pub name: Option<String>,
    /// Download URL or permalink when supplied by Slack.
    pub url: Option<String>,
    /// File size in bytes, when supplied.
    pub size_bytes: Option<u64>,
    /// Prompt placeholder.
    pub placeholder: String,
}

/// Visibility filter result.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackThreadVisibilityFilterResult {
    /// Kept messages.
    pub kept: Vec<SlackThreadHistoryMessage>,
    /// Omitted by context visibility/allowlist policy.
    pub omitted: usize,
}

/// Builds one relay-authenticated `conversations.replies` proxy request.
#[must_use]
pub fn build_conversations_replies_proxy_request(
    relay_api_base_url: &str,
    hyper_agents_api_key: &str,
    channel_id: &str,
    thread_ts: &str,
    cursor: Option<&str>,
) -> SlackRelayApiProxyRequest {
    let mut body = json!({
        "channel": channel_id,
        "ts": thread_ts,
        "limit": SLACK_THREAD_HISTORY_FETCH_LIMIT,
        "inclusive": true,
    });
    if let Some(cursor) = cursor.map(str::trim).filter(|value| !value.is_empty()) {
        body.as_object_mut()
            .expect("json object")
            .insert("cursor".to_owned(), Value::String(cursor.to_owned()));
    }
    SlackRelayApiProxyRequest {
        method: "POST".to_owned(),
        url: format!(
            "{}/slack/api/conversations.replies",
            relay_api_base_url.trim_end_matches('/')
        ),
        authorization: format!("Bearer {hyper_agents_api_key}"),
        body,
    }
}

/// Builds a direct `conversations.replies` operation for bot-token mode.
#[must_use]
pub fn build_conversations_replies_operation(
    channel_id: &str,
    thread_ts: &str,
    cursor: Option<&str>,
) -> SlackWebApiOperation {
    let mut operation =
        conversations_replies_operation(channel_id, thread_ts, SLACK_THREAD_HISTORY_FETCH_LIMIT);
    if let SlackWebApiOperation::ConversationsReplies { body } = &mut operation {
        body.as_object_mut()
            .expect("json object")
            .insert("inclusive".to_owned(), Value::Bool(true));
        if let Some(cursor) = cursor.map(str::trim).filter(|value| !value.is_empty()) {
            body.as_object_mut()
                .expect("json object")
                .insert("cursor".to_owned(), Value::String(cursor.to_owned()));
        }
    }
    operation
}

/// Builds relay-authenticated `files.info` proxy requests for media hydration.
#[must_use]
pub fn build_files_info_proxy_requests(
    relay_api_base_url: &str,
    hyper_agents_api_key: &str,
    files: &[SlackFile],
) -> Vec<SlackRelayApiProxyRequest> {
    files
        .iter()
        .filter_map(|file| file.id.as_deref().map(str::trim))
        .filter(|id| !id.is_empty())
        .map(|id| SlackRelayApiProxyRequest {
            method: "POST".to_owned(),
            url: format!(
                "{}/slack/api/files.info",
                relay_api_base_url.trim_end_matches('/')
            ),
            authorization: format!("Bearer {hyper_agents_api_key}"),
            body: json!({ "file": id }),
        })
        .collect()
}

/// Builds direct `files.info` operations for media hydration.
#[must_use]
pub fn build_files_info_operations(files: &[SlackFile]) -> Vec<SlackWebApiOperation> {
    files
        .iter()
        .filter_map(|file| file.id.as_deref().map(str::trim))
        .filter(|id| !id.is_empty())
        .map(files_info_operation)
        .collect()
}

/// Resolves the bounded, newest-N Slack thread history from fetched pages.
#[must_use]
pub fn resolve_slack_thread_history_from_pages(
    pages: &[SlackThreadRepliesPage],
    current_message_ts: Option<&str>,
    limit: usize,
    max_pages: usize,
) -> SlackThreadHistoryResolution {
    if limit == 0 || pages.is_empty() {
        return SlackThreadHistoryResolution {
            messages: Vec::new(),
            pages_fetched: 0,
            capped_incomplete: false,
        };
    }
    let mut retained = Vec::new();
    let mut capped_incomplete = false;
    let pages_to_read = pages.len().min(max_pages);
    for (index, page) in pages.iter().take(pages_to_read).enumerate() {
        for message in &page.messages {
            let Some(history_message) = slack_thread_history_message_from_value(message) else {
                continue;
            };
            if current_message_ts
                .map(str::trim)
                .is_some_and(|ts| history_message.ts.as_deref() == Some(ts))
            {
                continue;
            }
            retained.push(history_message);
        }
        if retained.len() > limit {
            retained.drain(0..retained.len() - limit);
        }
        if index + 1 == max_pages
            && page
                .next_cursor
                .as_deref()
                .is_some_and(|cursor| !cursor.trim().is_empty())
        {
            capped_incomplete = true;
        }
    }
    if capped_incomplete {
        retained.clear();
    }
    SlackThreadHistoryResolution {
        messages: retained,
        pages_fetched: pages_to_read,
        capped_incomplete,
    }
}

/// Applies OpenClaw's supplemental thread-context visibility policy.
#[must_use]
pub fn filter_slack_thread_history_for_visibility(
    messages: &[SlackThreadHistoryMessage],
    visibility: SlackContextVisibility,
    allow_from_lower: &[String],
    allow_name_matching: bool,
    current_bot_user_id: Option<&str>,
    current_bot_id: Option<&str>,
) -> SlackThreadVisibilityFilterResult {
    if visibility == SlackContextVisibility::All {
        return SlackThreadVisibilityFilterResult {
            kept: messages.to_vec(),
            omitted: 0,
        };
    }
    let kept = messages
        .iter()
        .filter(|message| {
            if is_current_bot_thread_author(message, current_bot_user_id, current_bot_id)
                || message.bot_id.is_some()
            {
                return true;
            }
            resolve_slack_allow_list_match(
                allow_from_lower,
                message.user_id.as_deref(),
                message.sender_name.as_deref(),
                allow_name_matching,
            )
            .allowed
        })
        .cloned()
        .collect::<Vec<_>>();
    SlackThreadVisibilityFilterResult {
        omitted: messages.len() - kept.len(),
        kept,
    }
}

/// Hydrates Slack file info responses into portable media placeholders.
#[must_use]
pub fn hydrate_slack_thread_starter_media(
    files: &[SlackFile],
    file_info_responses: &[Value],
    media_max_bytes: Option<u64>,
) -> Vec<SlackHydratedMedia> {
    files
        .iter()
        .filter_map(|file| {
            let id = file.id.as_deref();
            let info = id.and_then(|id| find_file_info(file_info_responses, id));
            if info.is_some_and(|value| !slack_file_metadata_allowed(value, media_max_bytes)) {
                return None;
            }
            let size_bytes = info
                .and_then(|value| value.get("size"))
                .and_then(Value::as_u64);
            if let (Some(size), Some(max)) = (size_bytes, media_max_bytes) {
                if size > max {
                    return None;
                }
            }
            let name = info
                .and_then(|value| value.get("name").and_then(Value::as_str))
                .map(ToOwned::to_owned)
                .or_else(|| file.name.clone());
            let url = info.and_then(|value| {
                value
                    .get("url_private_download")
                    .or_else(|| value.get("url_private"))
                    .or_else(|| value.get("permalink"))
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            });
            let hydrated_file = SlackFile {
                id: file.id.clone(),
                name: name.clone(),
            };
            Some(SlackHydratedMedia {
                file_id: file.id.clone(),
                placeholder: format!(
                    "[Slack file: {}]",
                    format_slack_file_reference(Some(&hydrated_file))
                ),
                name,
                url,
                size_bytes,
            })
        })
        .collect()
}

/// Fetches bounded thread history through the HyperCLI Slack Web API proxy.
///
/// # Errors
///
/// Returns HTTP/JSON errors from the relay proxy request path.
pub async fn fetch_slack_thread_history_via_relay(
    client: &reqwest::Client,
    relay_api_base_url: &str,
    hyper_agents_api_key: &str,
    channel_id: &str,
    thread_ts: &str,
    current_message_ts: Option<&str>,
    limit: usize,
) -> Result<SlackThreadHistoryResolution, reqwest::Error> {
    if limit == 0 {
        return Ok(SlackThreadHistoryResolution {
            messages: Vec::new(),
            pages_fetched: 0,
            capped_incomplete: false,
        });
    }
    let mut pages = Vec::new();
    let mut cursor = None;
    loop {
        let request = build_conversations_replies_proxy_request(
            relay_api_base_url,
            hyper_agents_api_key,
            channel_id,
            thread_ts,
            cursor.as_deref(),
        );
        let response = client
            .post(&request.url)
            .header(reqwest::header::AUTHORIZATION, request.authorization)
            .json(&request.body)
            .send()
            .await?
            .error_for_status()?
            .json::<Value>()
            .await?;
        let messages = response
            .get("messages")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        let next_cursor = response
            .get("response_metadata")
            .and_then(|metadata| metadata.get("next_cursor"))
            .and_then(Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(ToOwned::to_owned);
        pages.push(SlackThreadRepliesPage {
            messages,
            next_cursor: next_cursor.clone(),
        });
        if next_cursor.is_none() || pages.len() >= SLACK_THREAD_HISTORY_MAX_PAGES {
            break;
        }
        cursor = next_cursor;
    }
    Ok(resolve_slack_thread_history_from_pages(
        &pages,
        current_message_ts,
        limit,
        SLACK_THREAD_HISTORY_MAX_PAGES,
    ))
}

/// Decides whether to seed initial thread context.
#[must_use]
pub fn should_seed_initial_thread_context(
    is_thread_reply: bool,
    thread_ts: Option<&str>,
    freshness: Option<SlackSessionFreshness>,
    previous_timestamp_ms: Option<u64>,
) -> bool {
    is_thread_reply
        && thread_ts.is_some_and(|value| !value.trim().is_empty())
        && freshness.map_or(previous_timestamp_ms.is_none(), |state| {
            state != SlackSessionFreshness::Fresh
        })
}

/// Parses Slack timestamp milliseconds with OpenClaw's strict numeric rules.
#[must_use]
pub fn resolve_slack_timestamp_ms(ts: Option<&str>) -> Option<u64> {
    let trimmed = ts?.trim();
    let re = Regex::new(r"^\d+(?:\.\d+)?$").expect("valid timestamp regex");
    if trimmed.is_empty() || !re.is_match(trimmed) {
        return None;
    }
    let seconds = trimmed.parse::<f64>().ok()?;
    if !seconds.is_finite()
        || !(0.0..=(f64::from(u32::MAX) * 2_097_152.0 / 1000.0)).contains(&seconds)
    {
        return None;
    }
    Some((seconds * 1000.0).round() as u64)
}

/// Formats thread history into the same body semantics OpenClaw feeds through
/// `formatInboundEnvelope`; this pure port keeps the critical role/sender/id
/// content and leaves caller-specific envelope decoration outside.
#[must_use]
pub fn format_slack_thread_history_body(
    messages: &[SlackThreadHistoryMessage],
    channel_id: &str,
    current_bot_user_id: Option<&str>,
    current_bot_id: Option<&str>,
) -> Option<String> {
    let parts: Vec<String> = messages
        .iter()
        .map(|message| {
            let is_current_bot = message
                .user_id
                .as_deref()
                .is_some_and(|user| Some(user) == current_bot_user_id)
                || message
                    .bot_id
                    .as_deref()
                    .is_some_and(|bot| Some(bot) == current_bot_id);
            let is_assistant = is_current_bot || message.bot_id.is_some();
            let role = if is_assistant { "assistant" } else { "user" };
            let sender = if is_current_bot {
                "Bot (this assistant)".to_owned()
            } else {
                message
                    .sender_name
                    .clone()
                    .or_else(|| message.bot_id.as_ref().map(|bot| format!("Bot ({bot})")))
                    .unwrap_or_else(|| "Unknown".to_owned())
            };
            let ts = message.ts.as_deref().unwrap_or("unknown");
            format!(
                "Slack from {sender} ({role})\n{}\n[slack message id: {ts} channel: {channel_id}]",
                message.text
            )
        })
        .collect();
    if parts.is_empty() {
        None
    } else {
        Some(parts.join("\n\n"))
    }
}

pub(crate) fn slack_thread_history_message_from_value(
    value: &Value,
) -> Option<SlackThreadHistoryMessage> {
    let object = value.as_object()?;
    let files = object
        .get("files")
        .and_then(Value::as_array)
        .map(|files| {
            files
                .iter()
                .filter_map(|file| {
                    let file = file.as_object()?;
                    Some(SlackFile {
                        id: file
                            .get("id")
                            .and_then(Value::as_str)
                            .map(ToOwned::to_owned),
                        name: file
                            .get("name")
                            .and_then(Value::as_str)
                            .map(ToOwned::to_owned),
                    })
                })
                .collect::<Vec<_>>()
        })
        .unwrap_or_default();
    let text = object
        .get("text")
        .and_then(Value::as_str)
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(ToOwned::to_owned)
        .or_else(|| {
            (!files.is_empty())
                .then(|| format!("[attached: {}]", format_slack_file_reference_list(&files)))
        })?;
    Some(SlackThreadHistoryMessage {
        text,
        ts: object
            .get("ts")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        user_id: object
            .get("user")
            .or_else(|| object.get("user_id"))
            .or_else(|| object.get("userId"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        bot_id: object
            .get("bot_id")
            .or_else(|| object.get("botId"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        sender_name: object
            .get("sender_name")
            .or_else(|| object.get("senderName"))
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        files,
    })
}

fn is_current_bot_thread_author(
    message: &SlackThreadHistoryMessage,
    current_bot_user_id: Option<&str>,
    current_bot_id: Option<&str>,
) -> bool {
    message
        .user_id
        .as_deref()
        .is_some_and(|user| Some(user) == current_bot_user_id)
        || message
            .bot_id
            .as_deref()
            .is_some_and(|bot| Some(bot) == current_bot_id)
}

fn find_file_info<'a>(responses: &'a [Value], file_id: &str) -> Option<&'a Value> {
    responses.iter().find_map(|response| {
        let file = response.get("file").or(Some(response))?;
        (file.get("id").and_then(Value::as_str) == Some(file_id)).then_some(file)
    })
}

fn format_slack_file_reference(file: Option<&SlackFile>) -> String {
    let files = file.cloned().into_iter().collect::<Vec<_>>();
    format_slack_file_reference_list(&files)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn timestamp_matches_strict_slack_rules() {
        assert_eq!(resolve_slack_timestamp_ms(Some("100.500")), Some(100_500));
        assert_eq!(resolve_slack_timestamp_ms(Some(" 1.4 ")), Some(1_400));
        assert_eq!(resolve_slack_timestamp_ms(Some("-1")), None);
        assert_eq!(resolve_slack_timestamp_ms(Some("1x")), None);
    }

    #[test]
    fn seed_initial_thread_context_matches_freshness_gate() {
        assert!(should_seed_initial_thread_context(
            true,
            Some("100.1"),
            Some(SlackSessionFreshness::Missing),
            Some(1)
        ));
        assert!(!should_seed_initial_thread_context(
            true,
            Some("100.1"),
            Some(SlackSessionFreshness::Fresh),
            None
        ));
        assert!(should_seed_initial_thread_context(
            true,
            Some("100.1"),
            None,
            None
        ));
        assert!(!should_seed_initial_thread_context(
            false,
            Some("100.1"),
            None,
            None
        ));
    }

    #[test]
    fn formats_history_with_roles_and_slack_ids() {
        let body = format_slack_thread_history_body(
            &[
                SlackThreadHistoryMessage {
                    text: "assistant reply".to_owned(),
                    ts: Some("100.500".to_owned()),
                    user_id: None,
                    bot_id: Some("B1".to_owned()),
                    sender_name: None,
                    files: vec![],
                },
                SlackThreadHistoryMessage {
                    text: "user reply".to_owned(),
                    ts: Some("101.000".to_owned()),
                    user_id: Some("U1".to_owned()),
                    bot_id: None,
                    sender_name: Some("Ada".to_owned()),
                    files: vec![],
                },
            ],
            "C1",
            None,
            Some("B1"),
        )
        .unwrap();
        assert!(body.contains("Bot (this assistant) (assistant)"));
        assert!(body.contains("[slack message id: 101.000 channel: C1]"));
    }

    #[test]
    fn thread_history_keeps_newest_limit_and_drops_when_page_cap_leaves_cursor() {
        let page = SlackThreadRepliesPage {
            messages: vec![
                json!({"text":"old","ts":"1","user":"U1"}),
                json!({"files":[{"id":"F1","name":"a.png"}],"ts":"2","user":"U2"}),
                json!({"text":"current","ts":"3","user":"U3"}),
            ],
            next_cursor: None,
        };
        let resolved = resolve_slack_thread_history_from_pages(&[page], Some("3"), 1, 3);
        assert_eq!(resolved.messages.len(), 1);
        assert_eq!(resolved.messages[0].text, "[attached: a.png (fileId: F1)]");

        let capped = resolve_slack_thread_history_from_pages(
            &[SlackThreadRepliesPage {
                messages: vec![json!({"text":"old","ts":"1","user":"U1"})],
                next_cursor: Some("next".to_owned()),
            }],
            None,
            20,
            1,
        );
        assert!(capped.capped_incomplete);
        assert!(capped.messages.is_empty());
    }

    #[test]
    fn visibility_filters_thread_context_by_allowlist_but_keeps_bots() {
        let messages = vec![
            SlackThreadHistoryMessage {
                text: "allowed".to_owned(),
                ts: Some("1".to_owned()),
                user_id: Some("U1".to_owned()),
                bot_id: None,
                sender_name: Some("Ada Lovelace".to_owned()),
                files: vec![],
            },
            SlackThreadHistoryMessage {
                text: "blocked".to_owned(),
                ts: Some("2".to_owned()),
                user_id: Some("U2".to_owned()),
                bot_id: None,
                sender_name: None,
                files: vec![],
            },
            SlackThreadHistoryMessage {
                text: "bot".to_owned(),
                ts: Some("3".to_owned()),
                user_id: None,
                bot_id: Some("B1".to_owned()),
                sender_name: None,
                files: vec![],
            },
        ];
        let filtered = filter_slack_thread_history_for_visibility(
            &messages,
            SlackContextVisibility::AllowlistQuote,
            &["ada-lovelace".to_owned()],
            true,
            None,
            None,
        );
        assert_eq!(filtered.omitted, 1);
        assert_eq!(filtered.kept.len(), 2);
    }

    #[test]
    fn web_api_proxy_requests_preserve_relay_auth_and_hydration_caps() {
        let request = build_conversations_replies_proxy_request(
            "https://relay.example/",
            "key",
            "C1",
            "100.1",
            Some(" next "),
        );
        assert_eq!(
            request.url,
            "https://relay.example/slack/api/conversations.replies"
        );
        assert_eq!(request.body["cursor"], "next");

        let files = vec![SlackFile {
            id: Some("F1".to_owned()),
            name: Some("local.png".to_owned()),
        }];
        let file_requests = build_files_info_proxy_requests("https://relay.example", "key", &files);
        assert_eq!(file_requests[0].body["file"], "F1");
        let hydrated = hydrate_slack_thread_starter_media(
            &files,
            &[
                json!({"file":{"id":"F1","name":"remote.png","url_private":"https://files.slack.com/F1","size":20}}),
            ],
            Some(50),
        );
        assert_eq!(hydrated[0].name.as_deref(), Some("remote.png"));
        assert_eq!(
            hydrated[0].url.as_deref(),
            Some("https://files.slack.com/F1")
        );
        assert!(hydrate_slack_thread_starter_media(
            &files,
            &[json!({"file":{"id":"F1","size":99}})],
            Some(50)
        )
        .is_empty());
    }

    #[test]
    fn direct_history_and_file_operations_match_proxy_semantics() {
        let replies = build_conversations_replies_operation("C1", "100.1", Some(" next "));
        assert_eq!(replies.method(), Some("conversations.replies"));
        let body = replies.body().unwrap();
        assert_eq!(body["channel"], "C1");
        assert_eq!(body["ts"], "100.1");
        assert_eq!(body["cursor"], "next");
        assert_eq!(body["inclusive"], true);

        let files = build_files_info_operations(&[SlackFile {
            id: Some("F1".to_owned()),
            name: None,
        }]);
        assert_eq!(files[0].method(), Some("files.info"));
        assert_eq!(files[0].body().unwrap()["file"], "F1");
    }
}
