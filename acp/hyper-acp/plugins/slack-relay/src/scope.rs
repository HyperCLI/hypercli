//! Slack session scope: the typed key that partitions ACP sessions.
//!
//! Replaces the (deleted) global `HYPER_ACP_SLACK_SESSION_ID` and the stringly
//! `build_slack_acp_session_key` with a hashable typed key derived ONCE at
//! admission and carried through the queue. One ACP session per scope lands in
//! phase 4 (agent pool); this module owns the derivation rules.
//!
//! Anchor rules under the default thread policy:
//! - thread reply → the message `thread_ts` (the Slack thread root)
//! - top-level channel message → the message's own `ts` (it IS the root of
//!   its eventual thread — matches `build_slack_acp_session_key`'s
//!   `thread_ts.or(ts)` anchor choice)
//! - relay `thread_affinity` route → the root ts parsed from the affinity key
//!   (`thread:{enterprise}:{team}:{channel}:{root_ts}`, backend
//!   `slack-relay/app/main.py`) wins over the message fields when present,
//!   because the relay's routing decision is the authoritative thread
//!   association (reparent audit 6.7).

use serde::{Deserialize, Serialize};

use crate::monitor::events::messages::SlackAcceptedEvent;
use crate::monitor::message_handler::prepare::SlackAdmissionFacts;
use crate::monitor::message_handler::prepare_content::SlackMessageForContent;
use crate::monitor::relay_source::{SlackRelayRoute, SlackRelayRouteKind};
use crate::thread_ts::{normalize_slack_thread_ts_candidate, resolve_slack_thread_ts_value};

/// How ACP sessions are scoped per Slack conversation.
#[derive(Debug, Clone, Copy, Default, PartialEq, Eq, clap::ValueEnum)]
pub enum SessionPolicy {
    /// One session per Slack thread (DMs stay conversation-scoped).
    #[default]
    Thread,
    /// One session per Slack channel/DM (OpenClaw's legacy behavior).
    Channel,
}

/// Hashable typed session key for one Slack conversation scope.
///
/// Invariants: `thread_ts` is always `None` for DMs (DMs are
/// conversation-scoped under every policy) and always `None` under
/// [`SessionPolicy::Channel`]. Under thread policy, `Some(thread_ts)` is the
/// normalized Slack root timestamp (`\d+\.\d+`).
#[derive(Debug, Clone, PartialEq, Eq, Hash, Serialize, Deserialize)]
pub struct SlackSessionScope {
    /// Slack team id (`unknown-team` when the relay payload omitted it).
    pub team_id: String,
    /// Slack channel id (`C…`, `D…`, …).
    pub channel_id: String,
    /// Normalized thread root ts when thread-scoped.
    pub thread_ts: Option<String>,
    /// Direct-message conversation.
    pub is_dm: bool,
}

impl SlackSessionScope {
    /// Log-safe label: first 8 chars per component, never full ids.
    #[must_use]
    pub fn telemetry_label(&self) -> String {
        let channel: String = self.channel_id.chars().take(8).collect();
        if self.is_dm {
            return format!("dm:{channel}");
        }
        match &self.thread_ts {
            Some(thread_ts) => {
                let short: String = thread_ts.chars().take(8).collect();
                format!("thread:{channel}:{short}")
            }
            None => format!("channel:{channel}"),
        }
    }

    /// The legacy string session key (`slack:{team}:{dm|thread}:{channel}:{anchor}`),
    /// kept for parity assertions against `build_slack_acp_session_key`.
    #[must_use]
    pub fn session_key(&self) -> String {
        let kind = if self.is_dm { "dm" } else { "thread" };
        let anchor = self.thread_ts.as_deref().unwrap_or("root");
        format!("slack:{}:{kind}:{}:{anchor}", self.team_id, self.channel_id)
    }
}

/// Derive the session scope for one admitted event. Called exactly once per
/// event, at the dispatch terminal step, after admission has passed.
#[must_use]
pub fn slack_session_scope(
    event: &SlackAcceptedEvent,
    facts: &SlackAdmissionFacts,
    message: Option<&SlackMessageForContent>,
    policy: SessionPolicy,
) -> SlackSessionScope {
    let team_id = event
        .team_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .unwrap_or("unknown-team")
        .to_owned();
    let is_dm = facts.is_direct_message;
    let thread_ts = if is_dm || matches!(policy, SessionPolicy::Channel) {
        None
    } else {
        affinity_thread_root(&event.route).or_else(|| {
            message.and_then(|message| {
                resolve_slack_thread_ts_value(message.thread_ts.as_deref(), message.ts.as_deref())
            })
        })
    };
    SlackSessionScope {
        team_id,
        channel_id: facts.channel_id.clone(),
        thread_ts,
        is_dm,
    }
}

/// Parse the thread root ts from a relay `thread_affinity` route key
/// (`thread:{enterprise}:{team}:{channel}:{root_ts}` — the root is the tail).
fn affinity_thread_root(route: &SlackRelayRoute) -> Option<String> {
    if !matches!(route.kind, SlackRelayRouteKind::ThreadAffinity) {
        return None;
    }
    let tail = route.key.rsplit(':').next()?;
    normalize_slack_thread_ts_candidate(Some(tail))
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    fn facts(channel_id: &str, is_dm: bool) -> SlackAdmissionFacts {
        SlackAdmissionFacts {
            channel_id: channel_id.to_owned(),
            user_id: Some("U1".to_owned()),
            bot_id: None,
            text: "hello".to_owned(),
            is_direct_message: is_dm,
            is_room: !is_dm,
            current_bot_user_id: Some("UBOT".to_owned()),
            current_bot_id: None,
        }
    }

    fn message(ts: Option<&str>, thread_ts: Option<&str>) -> SlackMessageForContent {
        let mut value = json!({
            "type": "message",
            "channel": "C1",
            "text": "hello",
            "user": "U1",
        });
        if let Some(ts) = ts {
            value["ts"] = json!(ts);
        }
        if let Some(thread_ts) = thread_ts {
            value["thread_ts"] = json!(thread_ts);
        }
        crate::monitor::message_handler::prepare_content::slack_message_for_content_from_value(
            &value,
        )
        .expect("valid message for content")
    }

    fn event(route: SlackRelayRoute) -> SlackAcceptedEvent {
        SlackAcceptedEvent {
            transport: crate::monitor::events::messages::SlackAcceptedEventTransport::Relay,
            delivery_id: "d1".to_owned(),
            team_id: Some("T1".to_owned()),
            message: json!({"type": "message", "channel": "C1"}),
            payload: json!({}),
            route,
        }
    }

    fn channel_default_route() -> SlackRelayRoute {
        SlackRelayRoute {
            kind: SlackRelayRouteKind::ChannelDefault,
            key: "agent:abc".to_owned(),
        }
    }

    #[test]
    fn thread_reply_scopes_to_normalized_root() {
        let scope = slack_session_scope(
            &event(channel_default_route()),
            &facts("C1", false),
            Some(&message(Some("101.500"), Some(" 100.200 "))),
            SessionPolicy::Thread,
        );
        assert_eq!(
            scope,
            SlackSessionScope {
                team_id: "T1".to_owned(),
                channel_id: "C1".to_owned(),
                thread_ts: Some("100.200".to_owned()),
                is_dm: false,
            }
        );
    }

    #[test]
    fn top_level_message_anchors_to_its_own_ts() {
        let scope = slack_session_scope(
            &event(channel_default_route()),
            &facts("C1", false),
            Some(&message(Some("100.200"), None)),
            SessionPolicy::Thread,
        );
        assert_eq!(scope.thread_ts.as_deref(), Some("100.200"));
    }

    #[test]
    fn invalid_thread_anchor_collapses_to_channel_scope() {
        let scope = slack_session_scope(
            &event(channel_default_route()),
            &facts("C1", false),
            Some(&message(Some("not-a-ts"), Some("also-bad"))),
            SessionPolicy::Thread,
        );
        assert_eq!(scope.thread_ts, None);
    }

    #[test]
    fn dm_scoping_ignores_thread_ts_under_every_policy() {
        let facts = facts("D1", true);
        let message = message(Some("100.200"), Some("100.100"));
        for policy in [SessionPolicy::Thread, SessionPolicy::Channel] {
            let scope = slack_session_scope(
                &event(channel_default_route()),
                &facts,
                Some(&message),
                policy,
            );
            assert!(scope.is_dm);
            assert_eq!(scope.thread_ts, None);
        }
    }

    #[test]
    fn channel_policy_collapses_threads_to_channel_scope() {
        let scope = slack_session_scope(
            &event(channel_default_route()),
            &facts("C1", false),
            Some(&message(Some("101.500"), Some("100.200"))),
            SessionPolicy::Channel,
        );
        assert_eq!(scope.thread_ts, None);
        assert!(!scope.is_dm);
    }

    #[test]
    fn thread_affinity_route_wins_over_message_fields() {
        let route = SlackRelayRoute {
            kind: SlackRelayRouteKind::ThreadAffinity,
            key: "thread:E1:T1:C1:999.001".to_owned(),
        };
        let scope = slack_session_scope(
            &event(route),
            &facts("C1", false),
            Some(&message(Some("101.500"), Some("100.200"))),
            SessionPolicy::Thread,
        );
        assert_eq!(scope.thread_ts.as_deref(), Some("999.001"));
    }

    #[test]
    fn thread_affinity_route_supplies_anchor_and_falls_back_when_malformed() {
        let route = SlackRelayRoute {
            kind: SlackRelayRouteKind::ThreadAffinity,
            key: "thread::T1:C1:888.001".to_owned(),
        };
        let scope = slack_session_scope(
            &event(route),
            &facts("C1", false),
            None,
            SessionPolicy::Thread,
        );
        assert_eq!(scope.thread_ts.as_deref(), Some("888.001"));

        let bad_route = SlackRelayRoute {
            kind: SlackRelayRouteKind::ThreadAffinity,
            key: "thread:E1:T1:C1:not-a-ts".to_owned(),
        };
        let scope = slack_session_scope(
            &event(bad_route),
            &facts("C1", false),
            Some(&message(Some("100.200"), None)),
            SessionPolicy::Thread,
        );
        assert_eq!(scope.thread_ts.as_deref(), Some("100.200"));
    }

    #[test]
    fn telemetry_label_truncates_every_component() {
        let scope = SlackSessionScope {
            team_id: "T0123456789ABC".to_owned(),
            channel_id: "C0123456789ABC".to_owned(),
            thread_ts: Some("1717000000.000100".to_owned()),
            is_dm: false,
        };
        let label = scope.telemetry_label();
        assert_eq!(label, "thread:C0123456:17170000");
        assert!(!label.contains("T0123456789ABC"));
        assert!(!label.contains("1717000000.000100"));

        let dm = SlackSessionScope {
            is_dm: true,
            thread_ts: None,
            ..scope.clone()
        };
        assert_eq!(dm.telemetry_label(), "dm:C0123456");
    }
}
