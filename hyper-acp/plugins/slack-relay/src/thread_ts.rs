//! Slack thread timestamp helpers.
//!
//! Provenance: `openclaw-git/extensions/slack/src/thread-ts.ts` lines 4-23.

use regex::Regex;

/// Normalizes a Slack thread timestamp candidate.
#[must_use]
pub fn normalize_slack_thread_ts_candidate(value: Option<&str>) -> Option<String> {
    let normalized = value?.trim();
    let re = Regex::new(r"^\d+\.\d+$").expect("valid Slack thread ts regex");
    (!normalized.is_empty() && re.is_match(normalized)).then(|| normalized.to_owned())
}

/// Resolves Slack thread timestamp from reply id then thread id.
#[must_use]
pub fn resolve_slack_thread_ts_value(
    reply_to_id: Option<&str>,
    thread_id: Option<&str>,
) -> Option<String> {
    normalize_slack_thread_ts_candidate(reply_to_id)
        .or_else(|| normalize_slack_thread_ts_candidate(thread_id))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn thread_ts_requires_decimal_slack_shape() {
        assert_eq!(
            normalize_slack_thread_ts_candidate(Some(" 100.200 ")),
            Some("100.200".to_owned())
        );
        assert_eq!(normalize_slack_thread_ts_candidate(Some("100")), None);
        assert_eq!(
            resolve_slack_thread_ts_value(Some("bad"), Some("1.2")),
            Some("1.2".to_owned())
        );
    }
}
