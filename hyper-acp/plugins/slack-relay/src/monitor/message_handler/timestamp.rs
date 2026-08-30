//! OpenClaw `monitor/message-handler/timestamp.ts` equivalent.

pub use crate::history::resolve_slack_timestamp_ms as slack_ts_to_epoch_ms;
pub use crate::thread_ts::normalize_slack_thread_ts_candidate;
