//! OpenClaw `monitor/message-handler/prepare.ts` equivalent.

pub use crate::admission::{
    decide_slack_admission, resolve_slack_bot_loop_protection, SlackAdmissionDecision,
    SlackAdmissionFacts, SlackAdmissionPolicy, SlackMentionFacts,
};
pub use crate::event::{
    normalize_slack_event, slack_event_source, NormalizedSlackEvent, SlackEventSource,
};
