//! Thin active Slack runtime export surface.
//!
//! OpenClaw-shaped ownership lives under `monitor/message_handler/dispatch.rs`
//! for per-frame dispatch and `monitor/provider.rs` for relay orchestration.

pub use crate::monitor::message_handler::dispatch::{
    build_slack_session_prompt_frame, handle_active_slack_relay_frame,
    run_slack_acp_output_to_replies, ActiveSlackRelayFrameOutcome, ActiveSlackRelayState,
    SlackAcpFrameDirection, SlackAcpObservedFrame, SlackAcpOutputConfig, SlackAcpOutputDelivery,
    SlackAcpOutputError, SlackAcpOutputState, SlackStatusDelivery,
};
pub use crate::monitor::provider::*;
