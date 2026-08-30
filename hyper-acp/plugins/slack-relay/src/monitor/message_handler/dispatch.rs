//! OpenClaw `monitor/message-handler/dispatch.ts` equivalent.

pub use crate::active::{
    build_slack_session_prompt_frame, handle_active_slack_relay_frame,
    run_slack_relay_to_acp_client_frames, run_slack_relay_to_acp_client_frames_with_control,
    ActiveSlackRelayError, ActiveSlackRelayFrameOutcome, ActiveSlackRelayState,
};
pub use crate::output::{
    run_slack_acp_output_to_replies, SlackAcpFrameDirection, SlackAcpObservedFrame,
    SlackAcpOutputConfig, SlackAcpOutputDelivery, SlackAcpOutputError, SlackAcpOutputState,
};
