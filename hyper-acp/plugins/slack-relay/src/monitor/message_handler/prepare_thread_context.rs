//! OpenClaw `monitor/message-handler/prepare-thread-context.ts` equivalent.

pub use crate::history::{
    filter_slack_thread_history_for_visibility, format_slack_thread_history_body,
    hydrate_slack_thread_starter_media, should_seed_initial_thread_context, SlackContextVisibility,
    SlackHydratedMedia, SlackSessionFreshness, SlackThreadHistoryMessage,
    SlackThreadVisibilityFilterResult,
};
