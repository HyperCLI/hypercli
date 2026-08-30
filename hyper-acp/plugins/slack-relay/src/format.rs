//! Slack mrkdwn formatting ported from OpenClaw `extensions/slack/src/format.ts`.
//!
//! Rust deviation: this crate keeps the formatting surface focused on the
//! outbound primitives used by the relay/direct Slack transports rather than
//! importing OpenClaw's full markdown IR renderer.

use crate::limits::{SLACK_MESSAGE_TEXT_HARD_LIMIT, SLACK_TEXT_LIMIT};

/// Escapes Slack mrkdwn text while preserving valid Slack angle tokens.
#[must_use]
pub fn escape_slack_mrkdwn_text(text: &str) -> String {
    text.split('\n')
        .map(|line| {
            if let Some(quoted) = line.strip_prefix("> ") {
                format!("> {}", escape_slack_mrkdwn_content(quoted))
            } else {
                escape_slack_mrkdwn_content(line)
            }
        })
        .collect::<Vec<_>>()
        .join("\n")
}

/// Chunks Slack text without splitting UTF-8 scalar boundaries.
#[must_use]
pub fn chunk_slack_text_for_outbound(text: &str, limit: usize) -> Vec<String> {
    let effective_limit = limit
        .clamp(1, SLACK_TEXT_LIMIT)
        .min(SLACK_MESSAGE_TEXT_HARD_LIMIT);
    if text.is_empty() {
        return Vec::new();
    }
    let mut chunks = Vec::new();
    let mut current = String::new();
    for token in tokenize_slack_mrkdwn(text) {
        if !current.is_empty() && current.len() + token.len() > effective_limit {
            chunks.push(current);
            current = String::new();
        }
        if token.len() > effective_limit {
            chunks.extend(chunk_token_on_scalars(&token, effective_limit));
        } else {
            current.push_str(&token);
        }
    }
    if !current.is_empty() {
        chunks.push(current);
    }
    chunks
}

fn tokenize_slack_mrkdwn(text: &str) -> Vec<String> {
    let mut tokens = Vec::new();
    let mut index = 0;
    while index < text.len() {
        let rest = &text[index..];
        if rest.starts_with("```") {
            tokens.push("```".to_owned());
            index += 3;
            continue;
        }
        if let Some(entity) = ["&amp;", "&lt;", "&gt;"]
            .iter()
            .find(|entity| rest.starts_with(**entity))
        {
            tokens.push((*entity).to_owned());
            index += entity.len();
            continue;
        }
        if rest.starts_with('<') {
            if let Some(end) = rest.find('>') {
                let token = &rest[..=end];
                if !token.contains('\n') && is_allowed_slack_angle_token(token) {
                    tokens.push(token.to_owned());
                    index += token.len();
                    continue;
                }
            }
        }
        let Some(ch) = rest.chars().next() else {
            break;
        };
        tokens.push(ch.to_string());
        index += ch.len_utf8();
    }
    tokens
}

fn chunk_token_on_scalars(token: &str, limit: usize) -> Vec<String> {
    let mut chunks = Vec::new();
    let mut current = String::new();
    for ch in token.chars() {
        if !current.is_empty() && current.len() + ch.len_utf8() > limit {
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

fn escape_slack_mrkdwn_content(text: &str) -> String {
    let mut out = String::new();
    let mut index = 0;
    while index < text.len() {
        let rest = &text[index..];
        if rest.starts_with('<') {
            if let Some(end) = rest.find('>') {
                let token = &rest[..=end];
                if !token.contains('\n') && is_allowed_slack_angle_token(token) {
                    out.push_str(token);
                    index += token.len();
                    continue;
                }
            }
        }
        let Some(ch) = rest.chars().next() else {
            break;
        };
        match ch {
            '&' => out.push_str("&amp;"),
            '<' => out.push_str("&lt;"),
            '>' => out.push_str("&gt;"),
            _ => out.push(ch),
        }
        index += ch.len_utf8();
    }
    out
}

fn is_allowed_slack_angle_token(token: &str) -> bool {
    let Some(inner) = token.strip_prefix('<').and_then(|v| v.strip_suffix('>')) else {
        return false;
    };
    inner.starts_with('@')
        || inner.starts_with('#')
        || inner.starts_with('!')
        || inner.starts_with("mailto:")
        || inner.starts_with("tel:")
        || inner.starts_with("http://")
        || inner.starts_with("https://")
        || inner.starts_with("slack://")
}

#[cfg(test)]
mod tests {
    #[test]
    fn escapes_text_but_preserves_slack_tokens() {
        assert_eq!(
            super::escape_slack_mrkdwn_text("hi <@U1> & <bad>"),
            "hi <@U1> &amp; &lt;bad&gt;"
        );
    }

    #[test]
    fn chunks_on_utf8_boundaries() {
        let chunks = super::chunk_slack_text_for_outbound("a🙂b", 5);
        assert_eq!(chunks, vec!["a🙂".to_owned(), "b".to_owned()]);
    }

    #[test]
    fn chunks_keep_entities_and_slack_tokens_whole() {
        let chunks = super::chunk_slack_text_for_outbound("a&amp;<@U1>```code```", 6);
        assert_eq!(chunks.concat(), "a&amp;<@U1>```code```");
        assert!(!chunks
            .iter()
            .any(|chunk| chunk.contains("&am") && !chunk.contains("&amp;")));
        assert!(!chunks
            .iter()
            .any(|chunk| chunk.contains("p;") && !chunk.contains("&amp;")));
        assert!(chunks.iter().any(|chunk| chunk == "<@U1>"));
        assert!(!chunks.iter().any(|chunk| chunk == "``"));
    }
}
