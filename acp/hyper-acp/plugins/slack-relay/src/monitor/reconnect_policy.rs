//! Slack relay reconnect policy.
//!
//! Provenance: `openclaw-git/extensions/slack/src/monitor/reconnect-policy.ts`
//! lines 5-14 and 161-167.

use regex::Regex;

/// Reconnect backoff policy constants from OpenClaw.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct SlackSocketReconnectPolicy {
    /// Initial delay in milliseconds.
    pub initial_ms: u64,
    /// Max delay in milliseconds.
    pub max_ms: u64,
    /// Multiplicative factor.
    pub factor: f64,
    /// Jitter fraction.
    pub jitter: f64,
}

/// OpenClaw Slack socket reconnect policy.
pub const SLACK_SOCKET_RECONNECT_POLICY: SlackSocketReconnectPolicy = SlackSocketReconnectPolicy {
    initial_ms: 2_000,
    max_ms: 30_000,
    factor: 1.8,
    jitter: 0.25,
};

/// Detects non-recoverable Slack auth failures.
#[must_use]
pub fn is_non_recoverable_slack_auth_error(error: &str) -> bool {
    let re = Regex::new(
        r"(?i)account_inactive|invalid_auth|token_revoked|token_expired|not_authed|org_login_required|team_access_not_granted|user_removed_from_team|team_disabled|missing_scope|cannot_find_service|invalid_token",
    )
    .expect("valid Slack auth regex");
    re.is_match(error)
}

/// Deterministic backoff without jitter, used by tests and callers that inject jitter externally.
#[must_use]
pub fn compute_reconnect_backoff_ms(attempt: u32) -> u64 {
    if attempt == 0 {
        return 0;
    }
    let delay = (SLACK_SOCKET_RECONNECT_POLICY.initial_ms as f64)
        * SLACK_SOCKET_RECONNECT_POLICY
            .factor
            .powi(i32::try_from(attempt - 1).unwrap_or(i32::MAX));
    delay
        .round()
        .min(SLACK_SOCKET_RECONNECT_POLICY.max_ms as f64) as u64
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn reconnect_policy_matches_openclaw_constants() {
        assert_eq!(SLACK_SOCKET_RECONNECT_POLICY.initial_ms, 2_000);
        assert_eq!(SLACK_SOCKET_RECONNECT_POLICY.max_ms, 30_000);
        assert_eq!(compute_reconnect_backoff_ms(1), 2_000);
        assert_eq!(compute_reconnect_backoff_ms(2), 3_600);
    }

    #[test]
    fn detects_non_recoverable_auth_errors() {
        assert!(is_non_recoverable_slack_auth_error("invalid_auth"));
        assert!(is_non_recoverable_slack_auth_error("missing_scope"));
        assert!(!is_non_recoverable_slack_auth_error("socket hang up"));
    }
}
