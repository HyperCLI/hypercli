//! Logical Slack message dispatch dedupe.
//!
//! Provenance: `openclaw-git/extensions/slack/src/monitor/message-dispatch-dedupe.ts`
//! lines 1-21 and `buildSlackMessageDispatchReplayKey` lines 29-42.

use std::collections::HashMap;
use std::time::{Duration, Instant};

/// Logical dedupe TTL: 24 hours.
pub const SLACK_MESSAGE_DISPATCH_DEDUPE_TTL_MS: u64 = 24 * 60 * 60 * 1000;
/// In-memory dedupe entry cap.
pub const SLACK_MESSAGE_DISPATCH_DEDUPE_MEMORY_MAX_ENTRIES: usize = 20_000;
/// Durable state entry cap.
pub const SLACK_MESSAGE_DISPATCH_DEDUPE_STATE_MAX_ENTRIES: usize = 20_000;
/// Dedupe namespace.
pub const SLACK_MESSAGE_DISPATCH_DEDUPE_NAMESPACE: &str = "global";
/// Dedupe namespace prefix.
pub const SLACK_MESSAGE_DISPATCH_DEDUPE_NAMESPACE_PREFIX: &str = "slack.message-dispatch-dedupe";
/// Dedupe state plugin id.
pub const SLACK_MESSAGE_DISPATCH_DEDUPE_STATE_PLUGIN_ID: &str = "slack-message-dispatch-dedupe";

/// Builds the permanent logical message replay key.
#[must_use]
pub fn build_slack_message_dispatch_replay_key(
    account_id: &str,
    channel_id: Option<&str>,
    ts: Option<&str>,
    team_id: Option<&str>,
) -> Option<String> {
    let channel_id = channel_id?.trim();
    let ts = ts?.trim();
    if channel_id.is_empty() || ts.is_empty() {
        return None;
    }
    let team_id = team_id
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("");
    serde_json::to_string(&["message", account_id, team_id, channel_id, ts]).ok()
}

/// Logical dispatch dedupe state.
#[derive(Debug, Default)]
pub struct SlackDispatchDedupeState {
    accepted: HashMap<String, Instant>,
    pending: HashMap<String, Instant>,
}

impl SlackDispatchDedupeState {
    /// Checks and reserves one logical dispatch key.
    #[must_use]
    pub fn check_and_reserve(&mut self, key: &str, now: Instant) -> SlackDispatchDedupeDecision {
        self.prune(now);
        if self.accepted.contains_key(key) {
            return SlackDispatchDedupeDecision::DuplicateAccepted;
        }
        if self.pending.contains_key(key) {
            return SlackDispatchDedupeDecision::DuplicatePending;
        }
        trim_oldest(&mut self.accepted);
        trim_oldest(&mut self.pending);
        self.pending.insert(key.to_owned(), now);
        SlackDispatchDedupeDecision::FirstSeen
    }

    /// Commits a pending key as accepted.
    pub fn commit(&mut self, key: &str, now: Instant) {
        self.pending.remove(key);
        trim_oldest(&mut self.accepted);
        self.accepted.insert(key.to_owned(), now);
    }

    /// Releases a pending key so a later delivery can run gates again.
    pub fn release(&mut self, key: &str) {
        self.pending.remove(key);
    }

    /// Loads an accepted key from durable state.
    pub fn load_accepted(&mut self, key: String, now: Instant) {
        trim_oldest(&mut self.accepted);
        self.accepted.insert(key, now);
    }

    fn prune(&mut self, now: Instant) {
        prune_map(&mut self.accepted, now);
        prune_map(&mut self.pending, now);
    }
}

/// Logical dedupe decision.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum SlackDispatchDedupeDecision {
    /// First sighting; caller owns a pending reservation.
    FirstSeen,
    /// A previous dispatch committed this logical message.
    DuplicateAccepted,
    /// A sibling delivery is currently being processed.
    DuplicatePending,
}

fn prune_map(map: &mut HashMap<String, Instant>, now: Instant) {
    let ttl = Duration::from_millis(SLACK_MESSAGE_DISPATCH_DEDUPE_TTL_MS);
    map.retain(|_, claimed_at| now.duration_since(*claimed_at) <= ttl);
}

fn trim_oldest(map: &mut HashMap<String, Instant>) {
    if map.len() >= SLACK_MESSAGE_DISPATCH_DEDUPE_MEMORY_MAX_ENTRIES {
        if let Some(oldest) = map
            .iter()
            .min_by_key(|(_, claimed_at)| **claimed_at)
            .map(|(key, _)| key.clone())
        {
            map.remove(&oldest);
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replay_key_matches_openclaw_shape() {
        assert_eq!(
            build_slack_message_dispatch_replay_key(
                "acct",
                Some(" C1 "),
                Some(" 100.1 "),
                Some(" T1 ")
            )
            .unwrap(),
            r#"["message","acct","T1","C1","100.1"]"#
        );
        assert!(
            build_slack_message_dispatch_replay_key("acct", Some(""), Some("100.1"), None)
                .is_none()
        );
    }

    #[test]
    fn reserve_commit_release_state_machine_tracks_pending_and_accepted() {
        let mut state = SlackDispatchDedupeState::default();
        let now = Instant::now();
        assert_eq!(
            state.check_and_reserve("k1", now),
            SlackDispatchDedupeDecision::FirstSeen
        );
        assert_eq!(
            state.check_and_reserve("k1", now),
            SlackDispatchDedupeDecision::DuplicatePending
        );
        state.release("k1");
        assert_eq!(
            state.check_and_reserve("k1", now),
            SlackDispatchDedupeDecision::FirstSeen
        );
        state.commit("k1", now);
        assert_eq!(
            state.check_and_reserve("k1", now),
            SlackDispatchDedupeDecision::DuplicateAccepted
        );
    }
}
