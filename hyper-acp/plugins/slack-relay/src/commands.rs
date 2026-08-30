//! Slack command text helpers.
//!
//! Provenance: `openclaw-git/extensions/slack/src/monitor/commands.ts`
//! lines 5-39.

use regex::Regex;

/// Slash command config.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackSlashCommandConfig {
    /// Enabled.
    pub enabled: bool,
    /// Command name without leading slash.
    pub name: String,
    /// Session prefix.
    pub session_prefix: String,
    /// Ephemeral response mode.
    pub ephemeral: bool,
}

/// Strips Slack user mentions so command detection can see command text.
#[must_use]
pub fn strip_slack_mentions_for_command_detection(text: &str) -> String {
    let mentions = Regex::new(r"<@[^>]+>").expect("valid mention regex");
    let whitespace = Regex::new(r"\s+").expect("valid whitespace regex");
    whitespace
        .replace_all(&mentions.replace_all(text, " "), " ")
        .trim()
        .to_owned()
}

/// Resolves slash command config defaults.
#[must_use]
pub fn resolve_slack_slash_command_config(
    enabled: bool,
    name: Option<&str>,
    session_prefix: Option<&str>,
    ephemeral: Option<bool>,
) -> SlackSlashCommandConfig {
    let normalized = normalize_slash_command_name(name.unwrap_or("openclaw").trim());
    SlackSlashCommandConfig {
        enabled,
        name: if normalized.is_empty() {
            "openclaw".to_owned()
        } else {
            normalized
        },
        session_prefix: session_prefix
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .unwrap_or("slack:slash")
            .to_owned(),
        ephemeral: ephemeral.unwrap_or(true),
    }
}

/// Returns true when command text matches with or without leading slash.
#[must_use]
pub fn slack_slash_command_matches(name: &str, candidate: &str) -> bool {
    normalize_slash_command_name(name) == normalize_slash_command_name(candidate)
}

fn normalize_slash_command_name(raw: &str) -> String {
    raw.trim_start_matches('/').to_owned()
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn strips_slack_mentions_for_command_detection() {
        assert_eq!(
            strip_slack_mentions_for_command_detection("<@U123|bot>   /new  project"),
            "/new project"
        );
    }

    #[test]
    fn slash_command_matches_with_optional_slash() {
        assert!(slack_slash_command_matches("/openclaw", "openclaw"));
        assert!(slack_slash_command_matches("openclaw", "/openclaw"));
    }
}
