//! OpenClaw `monitor/message-handler/timestamp.ts` equivalent.

pub use crate::thread_ts::normalize_slack_thread_ts_candidate;

/// Converts a strict Slack timestamp to epoch milliseconds.
#[must_use]
pub fn slack_ts_to_epoch_ms(ts: Option<&str>) -> Option<u64> {
    crate::monitor::thread::resolve_slack_timestamp_ms(ts)
}

#[cfg(test)]
mod tests {
    #[test]
    fn timestamp_wrapper_rejects_non_slack_shape() {
        assert_eq!(super::slack_ts_to_epoch_ms(Some("1.001")), Some(1001));
        assert_eq!(super::slack_ts_to_epoch_ms(Some("not-a-ts")), None);
    }
}
