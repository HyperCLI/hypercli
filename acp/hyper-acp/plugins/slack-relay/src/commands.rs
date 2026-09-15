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

/// Parsed Slack pairing approval command.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackPairingApprovalCommand {
    /// Pairing code supplied by the operator.
    pub code: String,
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

/// Parses `/approve slack CODE` or `approve slack CODE`.
#[must_use]
pub fn parse_slack_pairing_approval_command(text: &str) -> Option<SlackPairingApprovalCommand> {
    let stripped = strip_slack_mentions_for_command_detection(text);
    let mut parts = stripped.split_whitespace();
    let command = parts.next()?.trim_start_matches('/');
    if !command.eq_ignore_ascii_case("approve") {
        return None;
    }
    if !parts.next()?.eq_ignore_ascii_case("slack") {
        return None;
    }
    let code = parts.next()?.trim();
    (!code.is_empty()).then(|| SlackPairingApprovalCommand {
        code: code.to_owned(),
    })
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

    #[test]
    fn parses_pairing_approval_command() {
        assert_eq!(
            parse_slack_pairing_approval_command("<@UBOT> /approve slack ABC123"),
            Some(SlackPairingApprovalCommand {
                code: "ABC123".to_owned()
            })
        );
        assert_eq!(
            parse_slack_pairing_approval_command("/approve github ABC123"),
            None
        );
    }
}
