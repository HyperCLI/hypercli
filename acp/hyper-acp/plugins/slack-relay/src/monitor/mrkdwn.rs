//! OpenClaw `monitor/mrkdwn.ts` boundary for Slack text normalization.
//!
//! Converts agent Markdown into Slack mrkdwn while preserving Slack-native
//! tokens in already-Slack-formatted text.

use regex::Regex;

use crate::format::escape_slack_mrkdwn_text;

/// Converts common Markdown constructs into Slack mrkdwn.
#[must_use]
pub fn markdown_to_slack_mrkdwn(text: &str) -> String {
    let mut converted = String::new();
    let mut in_fence = false;
    for line in text.lines() {
        let trimmed = line.trim_start();
        if trimmed.starts_with("```") {
            in_fence = !in_fence;
            converted.push_str(line);
            converted.push('\n');
            continue;
        }
        if in_fence {
            converted.push_str(line);
            converted.push('\n');
            continue;
        }
        let without_heading = trimmed
            .strip_prefix("### ")
            .or_else(|| trimmed.strip_prefix("## "))
            .or_else(|| trimmed.strip_prefix("# "))
            .unwrap_or(line);
        converted.push_str(&convert_inline_markdown(without_heading));
        converted.push('\n');
    }
    converted.trim_end_matches('\n').to_owned()
}

/// Backward-compatible alias for callers that already provide Slack mrkdwn.
#[must_use]
pub fn preserve_slack_mrkdwn(text: &str) -> String {
    markdown_to_slack_mrkdwn(text)
}

fn convert_inline_markdown(text: &str) -> String {
    let escaped = escape_slack_mrkdwn_text(text);
    let linked = Regex::new(r"\[([^\]\n]+)\]\((https?://[^)\s]+|mailto:[^)\s]+)\)")
        .expect("valid markdown link regex")
        .replace_all(&escaped, |captures: &regex::Captures<'_>| {
            format!("<{}|{}>", &captures[2], &captures[1])
        })
        .into_owned();
    Regex::new(r"\*\*([^*\n]+)\*\*")
        .expect("valid markdown strong regex")
        .replace_all(&linked, "*$1*")
        .into_owned()
}

#[cfg(test)]
mod tests {
    #[test]
    fn converts_markdown_and_preserves_slack_tokens() {
        let text = "# Hello <@U1>\nSee [docs](https://example.com?a=1&b=2) and **ship**";
        assert_eq!(
            super::markdown_to_slack_mrkdwn(text),
            "Hello <@U1>\nSee <https://example.com?a=1&amp;b=2|docs> and *ship*"
        );
    }

    #[test]
    fn leaves_fenced_code_content_unescaped() {
        assert_eq!(
            super::markdown_to_slack_mrkdwn("```rust\nif a < b && c > d {}\n```"),
            "```rust\nif a < b && c > d {}\n```"
        );
    }
}
