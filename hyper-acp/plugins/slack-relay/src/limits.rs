//! Slack limits ported from OpenClaw `extensions/slack/src/limits.ts`.

/// OpenClaw conservative Slack outbound text limit.
pub const SLACK_TEXT_LIMIT: usize = 8_000;

/// `chat.update` rejects text above 4,000 chars.
pub const SLACK_EDIT_TEXT_LIMIT: usize = 4_000;

/// Slack truncates `chat.postMessage` text above 40,000 chars.
pub const SLACK_MESSAGE_TEXT_HARD_LIMIT: usize = 40_000;
