//! OpenClaw `monitor/message-dispatch-dedupe.ts` equivalent.

pub use crate::dedupe::{
    build_slack_message_dispatch_replay_key, SLACK_MESSAGE_DISPATCH_DEDUPE_MEMORY_MAX_ENTRIES,
    SLACK_MESSAGE_DISPATCH_DEDUPE_TTL_MS,
};
