//! Slack message content and metadata formatting.
//!
//! Provenance:
//! - `openclaw-git/extensions/slack/src/file-reference.ts` lines 5-16.
//! - `openclaw-git/extensions/slack/src/monitor/message-handler/prepare-content.ts`
//!   mention constants lines 18-20, mention collection/rendering lines 24-56,
//!   inherited parent file filter lines 58-78, file/attachment fallback and
//!   body assembly lines 94-147 and 149-217.
//! - `openclaw-git/extensions/slack/src/monitor/message-handler/prepare.ts`
//!   Slack message id/channel/thread footer lines 1412-1416.

use std::collections::{HashMap, HashSet};
use std::hash::BuildHasher;

use regex::Regex;
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Maximum user mention lookups per message.
pub const SLACK_MENTION_RESOLUTION_MAX_LOOKUPS_PER_MESSAGE: usize = 20;
/// Maximum file placeholders in fallback-only content.
pub const MAX_SLACK_MEDIA_FILES: usize = 8;

/// Slack file subset.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlackFile {
    /// File id.
    pub id: Option<String>,
    /// File name.
    pub name: Option<String>,
}

/// Slack attachment subset.
#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
pub struct SlackAttachment {
    /// Attachment text.
    pub text: Option<String>,
    /// Attachment fallback.
    pub fallback: Option<String>,
}

/// Portable Slack message subset.
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub struct SlackMessageForContent {
    /// Message text.
    pub text: Option<String>,
    /// Channel id.
    pub channel: String,
    /// Message timestamp.
    pub ts: Option<String>,
    /// Thread timestamp.
    pub thread_ts: Option<String>,
    /// Parent user id.
    pub parent_user_id: Option<String>,
    /// User id.
    pub user: Option<String>,
    /// Bot id.
    pub bot_id: Option<String>,
    /// Username.
    pub username: Option<String>,
    /// Files.
    pub files: Vec<SlackFile>,
    /// Attachments.
    pub attachments: Vec<SlackAttachment>,
    /// Raw blocks.
    pub blocks: Vec<Value>,
}

/// Resolved message content.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackResolvedMessageContent {
    /// Body without Slack transport footer.
    pub raw_body: String,
    /// Body with Slack message id/channel/thread footer.
    pub body_with_metadata: String,
}

/// Formats one Slack file reference.
#[must_use]
pub fn format_slack_file_reference(file: Option<&SlackFile>) -> String {
    let name = file
        .and_then(|file| normalized_optional(file.name.as_deref()))
        .unwrap_or("file");
    let file_id = file.and_then(|file| normalized_optional(file.id.as_deref()));
    file_id.map_or_else(|| name.to_owned(), |id| format!("{name} (fileId: {id})"))
}

/// Formats a Slack file reference list.
#[must_use]
pub fn format_slack_file_reference_list(files: &[SlackFile]) -> String {
    if files.is_empty() {
        return "file".to_owned();
    }
    files
        .iter()
        .map(|file| format_slack_file_reference(Some(file)))
        .collect::<Vec<_>>()
        .join(", ")
}

/// Parses portable content fields from relay `payload.event`.
#[must_use]
pub fn slack_message_for_content_from_value(value: &Value) -> Option<SlackMessageForContent> {
    let object = value.as_object()?;
    Some(SlackMessageForContent {
        text: object
            .get("text")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        channel: object.get("channel")?.as_str()?.to_owned(),
        ts: object
            .get("ts")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        thread_ts: object
            .get("thread_ts")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        parent_user_id: object
            .get("parent_user_id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        user: object
            .get("user")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        bot_id: object
            .get("bot_id")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        username: object
            .get("username")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        files: object
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
                    .collect()
            })
            .unwrap_or_default(),
        attachments: object
            .get("attachments")
            .and_then(Value::as_array)
            .map(|attachments| {
                attachments
                    .iter()
                    .filter_map(|attachment| {
                        let attachment = attachment.as_object()?;
                        Some(SlackAttachment {
                            text: attachment
                                .get("text")
                                .and_then(Value::as_str)
                                .map(ToOwned::to_owned),
                            fallback: attachment
                                .get("fallback")
                                .and_then(Value::as_str)
                                .map(ToOwned::to_owned),
                        })
                    })
                    .collect()
            })
            .unwrap_or_default(),
        blocks: object
            .get("blocks")
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default(),
    })
}

/// Resolves Slack message content using portable OpenClaw semantics.
#[must_use]
pub fn resolve_slack_message_content<S: BuildHasher>(
    message: &SlackMessageForContent,
    is_thread_reply: bool,
    thread_starter_files: &[SlackFile],
    rendered_mentions: &HashMap<String, Option<String>, S>,
) -> Option<SlackResolvedMessageContent> {
    let own_files =
        filter_inherited_parent_files(&message.files, is_thread_reply, thread_starter_files);
    let file_only_placeholder = if own_files.is_empty() {
        None
    } else {
        let files = own_files
            .iter()
            .take(MAX_SLACK_MEDIA_FILES)
            .cloned()
            .collect::<Vec<_>>();
        Some(format!(
            "[Slack file: {}]",
            format_slack_file_reference_list(&files)
        ))
    };
    let bot_attachment_text = if message.bot_id.is_some() {
        let parts = message
            .attachments
            .iter()
            .filter_map(|attachment| {
                normalized_optional(attachment.text.as_deref())
                    .or_else(|| normalized_optional(attachment.fallback.as_deref()))
            })
            .collect::<Vec<_>>();
        (!parts.is_empty()).then(|| parts.join("\n"))
    } else {
        None
    };
    let primary_text = choose_primary_text(
        normalized_optional(message.text.as_deref()),
        resolve_blocks_text(&message.blocks),
    );
    let text_parts = [
        primary_text.as_deref(),
        bot_attachment_text.as_deref(),
        file_only_placeholder.as_deref(),
    ];
    let raw_body = text_parts
        .into_iter()
        .flatten()
        .map(|part| {
            render_slack_user_mentions(Some(part), rendered_mentions)
                .unwrap_or_else(|| part.to_owned())
        })
        .collect::<Vec<_>>()
        .join("\n");
    if raw_body.is_empty() {
        return None;
    }
    let body_with_metadata = append_slack_message_metadata(&raw_body, message);
    Some(SlackResolvedMessageContent {
        raw_body,
        body_with_metadata,
    })
}

/// Collects unique Slack user mention IDs, capped by caller.
#[must_use]
pub fn collect_unique_slack_mention_ids(texts: &[Option<String>]) -> Vec<String> {
    let re = Regex::new(r"(?i)<@([A-Z0-9]+)(?:\|[^>]+)?>").expect("valid mention regex");
    let mut seen = HashSet::new();
    let mut ids = Vec::new();
    for text in texts.iter().flatten() {
        for captures in re.captures_iter(text) {
            let Some(id) = captures.get(1).map(|value| value.as_str().to_owned()) else {
                continue;
            };
            if seen.insert(id.clone()) {
                ids.push(id);
            }
        }
    }
    ids
}

/// Renders Slack user mentions with resolved names.
#[must_use]
pub fn render_slack_user_mentions<S: BuildHasher>(
    text: Option<&str>,
    rendered_mentions: &HashMap<String, Option<String>, S>,
) -> Option<String> {
    let text = text?;
    if rendered_mentions.is_empty() {
        return Some(text.to_owned());
    }
    let re = Regex::new(r"(?i)<@([A-Z0-9]+)(?:\|[^>]+)?>").expect("valid mention regex");
    Some(
        re.replace_all(text, |captures: &regex::Captures<'_>| {
            let full = captures.get(0).map_or("", |value| value.as_str());
            let user_id = captures.get(1).map_or("", |value| value.as_str());
            rendered_mentions
                .get(user_id)
                .and_then(Clone::clone)
                .unwrap_or_else(|| full.to_owned())
        })
        .to_string(),
    )
}

/// Builds rendered mention map from resolved user names with OpenClaw formatting.
#[must_use]
pub fn build_rendered_mention_map(
    names: &HashMap<String, Option<String>, impl BuildHasher>,
) -> HashMap<String, Option<String>> {
    let mut ids = names.keys().cloned().collect::<Vec<_>>();
    ids.sort();
    build_rendered_mention_map_for_ids(ids.iter().map(String::as_str), names)
}

/// Builds rendered mention map in text-order with OpenClaw's lookup cap.
#[must_use]
pub fn build_rendered_mention_map_for_ids<'a, I, S>(
    mention_ids: I,
    names: &HashMap<String, Option<String>, S>,
) -> HashMap<String, Option<String>>
where
    I: IntoIterator<Item = &'a str>,
    S: BuildHasher,
{
    mention_ids
        .into_iter()
        .take(SLACK_MENTION_RESOLUTION_MAX_LOOKUPS_PER_MESSAGE)
        .map(|user_id| {
            let rendered = names
                .get(user_id)
                .and_then(Clone::clone)
                .as_deref()
                .and_then(|value| normalized_optional(Some(value)))
                .map(|name| format!("<@{user_id}> ({name})"));
            (user_id.to_owned(), rendered)
        })
        .collect()
}

fn filter_inherited_parent_files(
    files: &[SlackFile],
    is_thread_reply: bool,
    thread_starter_files: &[SlackFile],
) -> Vec<SlackFile> {
    if !is_thread_reply || files.is_empty() || thread_starter_files.is_empty() {
        return files.to_vec();
    }
    let starter_file_ids = thread_starter_files
        .iter()
        .filter_map(|file| file.id.as_deref())
        .collect::<HashSet<_>>();
    files
        .iter()
        .filter(|file| {
            file.id
                .as_deref()
                .is_none_or(|id| !starter_file_ids.contains(id))
        })
        .cloned()
        .collect()
}

fn append_slack_message_metadata(body: &str, message: &SlackMessageForContent) -> String {
    let ts = message.ts.as_deref().unwrap_or("unknown");
    let thread_info = if is_thread_reply(message) {
        format!(
            " thread_ts: {}{}",
            message.thread_ts.as_deref().unwrap_or("unknown"),
            message
                .parent_user_id
                .as_deref()
                .map_or_else(String::new, |parent| format!(" parent_user_id: {parent}"))
        )
    } else {
        String::new()
    };
    format!(
        "{body}\n[slack message id: {ts} channel: {}{thread_info}]",
        message.channel
    )
}

fn is_thread_reply(message: &SlackMessageForContent) -> bool {
    match (message.thread_ts.as_deref(), message.ts.as_deref()) {
        (Some(thread_ts), Some(ts)) => thread_ts != ts || message.parent_user_id.is_some(),
        (Some(_), None) => true,
        _ => false,
    }
}

/// Extracts Slack block fallback text without message metadata.
#[must_use]
pub fn extract_slack_block_text(blocks: &[Value]) -> Option<String> {
    resolve_blocks_text(blocks).map(|blocks| blocks.text)
}

fn resolve_blocks_text(blocks: &[Value]) -> Option<BlocksText> {
    if blocks.is_empty() {
        return None;
    }
    let mut parts = Vec::new();
    let mut has_rich_text = false;
    let mut has_native_data = false;
    for block in blocks {
        let block_type = block.get("type").and_then(Value::as_str);
        has_rich_text |= block_type == Some("rich_text");
        has_native_data |= matches!(block_type, Some("data_visualization" | "data_table"));
        if let Some(text) = block_fallback_text(block)
            .and_then(|value| normalized_optional(Some(&value)).map(ToOwned::to_owned))
        {
            parts.push(text);
        }
    }
    (!parts.is_empty()).then(|| BlocksText {
        text: parts.join("\n"),
        has_rich_text,
        has_native_data,
    })
}

fn block_fallback_text(block: &Value) -> Option<String> {
    if block.get("type").and_then(Value::as_str) == Some("rich_text") {
        return rich_text_elements_text(block.get("elements")?.as_array()?);
    }
    block
        .get("text")
        .and_then(|text| {
            text.as_str().map(ToOwned::to_owned).or_else(|| {
                text.get("text")
                    .and_then(Value::as_str)
                    .map(ToOwned::to_owned)
            })
        })
        .or_else(|| {
            block
                .get("fallback")
                .and_then(Value::as_str)
                .map(ToOwned::to_owned)
        })
}

fn rich_text_elements_text(elements: &[Value]) -> Option<String> {
    let parts = elements
        .iter()
        .filter_map(rich_text_element_text)
        .filter(|part| !part.trim().is_empty())
        .collect::<Vec<_>>();
    (!parts.is_empty()).then(|| parts.join(""))
}

fn rich_text_element_text(element: &Value) -> Option<String> {
    match element.get("type").and_then(Value::as_str)? {
        "rich_text_section" | "rich_text_preformatted" | "rich_text_quote" => element
            .get("elements")
            .and_then(Value::as_array)
            .and_then(|elements| rich_text_elements_text(elements)),
        "rich_text_list" => {
            let elements = element.get("elements")?.as_array()?;
            let style = element
                .get("style")
                .and_then(Value::as_str)
                .unwrap_or("bullet");
            let parts = elements
                .iter()
                .enumerate()
                .filter_map(|(index, item)| {
                    let text = rich_text_element_text(item)?;
                    let prefix = if style == "ordered" {
                        format!("{}. ", index + 1)
                    } else {
                        "- ".to_owned()
                    };
                    Some(format!("{prefix}{text}"))
                })
                .collect::<Vec<_>>();
            (!parts.is_empty()).then(|| parts.join("\n"))
        }
        "text" => element
            .get("text")
            .and_then(Value::as_str)
            .map(ToOwned::to_owned),
        "user" => element
            .get("user_id")
            .or_else(|| element.get("user"))
            .and_then(Value::as_str)
            .map(|user| format!("<@{user}>")),
        "channel" => element
            .get("channel_id")
            .or_else(|| element.get("channel"))
            .and_then(Value::as_str)
            .map(|channel| format!("<#{channel}>")),
        "usergroup" => element
            .get("usergroup_id")
            .or_else(|| element.get("usergroup"))
            .and_then(Value::as_str)
            .map(|group| format!("<!subteam^{group}>")),
        "link" => {
            let url = element.get("url")?.as_str()?;
            let text = element.get("text").and_then(Value::as_str);
            Some(text.map_or_else(|| format!("<{url}>"), |text| format!("<{url}|{text}>")))
        }
        "emoji" => element
            .get("name")
            .and_then(Value::as_str)
            .map(|name| format!(":{name}:")),
        "broadcast" => element
            .get("range")
            .and_then(Value::as_str)
            .map(|range| format!("<!{range}>")),
        _ => None,
    }
}

fn choose_primary_text(
    message_text: Option<&str>,
    blocks_text: Option<BlocksText>,
) -> Option<String> {
    let Some(blocks_text) = blocks_text else {
        return message_text.map(ToOwned::to_owned);
    };
    let Some(message_text) = message_text else {
        return Some(blocks_text.text);
    };
    if blocks_text.has_native_data {
        let comparable_message = collapse_whitespace(message_text);
        let comparable_blocks = collapse_whitespace(&blocks_text.text);
        if comparable_message.contains(&comparable_blocks) {
            return Some(message_text.to_owned());
        }
        return Some(if comparable_blocks.starts_with(&comparable_message) {
            blocks_text.text
        } else {
            format!("{message_text}\n{}", blocks_text.text)
        });
    }
    if blocks_text.has_rich_text && blocks_text.text.len() > message_text.len() {
        return Some(blocks_text.text);
    }
    if blocks_text.text.len() > message_text.len() && blocks_text.text.starts_with(message_text) {
        Some(blocks_text.text)
    } else {
        Some(message_text.to_owned())
    }
}

fn collapse_whitespace(value: &str) -> String {
    value.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn normalized_optional(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
}

#[derive(Debug, Clone)]
struct BlocksText {
    text: String,
    has_rich_text: bool,
    has_native_data: bool,
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn formats_file_references() {
        assert_eq!(format_slack_file_reference(None), "file");
        assert_eq!(
            format_slack_file_reference(Some(&SlackFile {
                id: Some("F1".to_owned()),
                name: Some(" report.txt ".to_owned()),
            })),
            "report.txt (fileId: F1)"
        );
    }

    #[test]
    fn resolves_message_content_with_files_attachment_mentions_and_metadata() {
        let message = slack_message_for_content_from_value(&json!({
            "channel": "C1",
            "text": "hi <@U1>",
            "ts": "100.1",
            "thread_ts": "99.9",
            "parent_user_id": "U0",
            "files": [{"id": "F1", "name": "a.txt"}],
            "attachments": [{"fallback": "fallback"}]
        }))
        .unwrap();
        let mut names = HashMap::new();
        names.insert("U1".to_owned(), Some("Ada".to_owned()));
        let rendered = build_rendered_mention_map(&names);
        let content = resolve_slack_message_content(&message, true, &[], &rendered).unwrap();
        assert!(content.raw_body.contains("hi <@U1> (Ada)"));
        assert!(content
            .raw_body
            .contains("[Slack file: a.txt (fileId: F1)]"));
        assert!(content
            .body_with_metadata
            .contains("[slack message id: 100.1 channel: C1 thread_ts: 99.9 parent_user_id: U0]"));
    }

    #[test]
    fn filters_inherited_parent_files_from_thread_replies() {
        let files = vec![
            SlackFile {
                id: Some("F1".to_owned()),
                name: Some("a.txt".to_owned()),
            },
            SlackFile {
                id: Some("F2".to_owned()),
                name: Some("b.txt".to_owned()),
            },
        ];
        let starter = vec![SlackFile {
            id: Some("F1".to_owned()),
            name: Some("a.txt".to_owned()),
        }];
        assert_eq!(
            filter_inherited_parent_files(&files, true, &starter).len(),
            1
        );
    }

    #[test]
    fn block_text_prefers_longer_rich_text() {
        let message = SlackMessageForContent {
            text: Some("short".to_owned()),
            channel: "C1".to_owned(),
            ts: Some("1.1".to_owned()),
            thread_ts: None,
            parent_user_id: None,
            user: None,
            bot_id: None,
            username: None,
            files: vec![],
            attachments: vec![],
            blocks: vec![json!({
                "type":"rich_text",
                "elements":[{
                    "type":"rich_text_section",
                    "elements":[
                        {"type":"text","text":"short plus rich "},
                        {"type":"user","user_id":"U2"},
                        {"type":"emoji","name":"white_check_mark"}
                    ]
                }]
            })],
        };
        let content = resolve_slack_message_content(&message, false, &[], &HashMap::new()).unwrap();
        assert!(content.raw_body.starts_with("short plus rich"));
        assert!(content.raw_body.contains("<@U2>"));
        assert!(content.raw_body.contains(":white_check_mark:"));
    }

    #[test]
    fn extracts_real_rich_text_block_sections_lists_and_links() {
        let blocks = vec![json!({
            "type":"rich_text",
            "elements":[{
                "type":"rich_text_list",
                "style":"ordered",
                "elements":[{
                    "type":"rich_text_section",
                    "elements":[
                        {"type":"text","text":"see "},
                        {"type":"link","url":"https://example.com","text":"doc"}
                    ]
                }]
            }]
        })];
        assert_eq!(
            extract_slack_block_text(&blocks).as_deref(),
            Some("1. see <https://example.com|doc>")
        );
    }

    #[test]
    fn mention_rendering_uses_text_order_cap_not_hashmap_order() {
        use std::fmt::Write as _;

        let mut text = String::new();
        let mut names = HashMap::new();
        for index in 0..25 {
            let id = format!("U{index}");
            let _ = write!(text, "<@{id}> ");
            names.insert(id.clone(), Some(format!("user-{index}")));
        }
        let mention_ids = collect_unique_slack_mention_ids(&[Some(text)]);
        let rendered =
            build_rendered_mention_map_for_ids(mention_ids.iter().map(String::as_str), &names);
        assert_eq!(
            rendered.len(),
            SLACK_MENTION_RESOLUTION_MAX_LOOKUPS_PER_MESSAGE
        );
        assert!(rendered.contains_key("U0"));
        assert!(rendered.contains_key("U19"));
        assert!(!rendered.contains_key("U20"));
    }
}
