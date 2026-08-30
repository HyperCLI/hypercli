//! OpenClaw `monitor/reconnect-policy.ts` equivalent.

pub use crate::reconnect::{
    compute_reconnect_backoff_ms, is_non_recoverable_slack_auth_error,
    SLACK_SOCKET_RECONNECT_POLICY,
};
