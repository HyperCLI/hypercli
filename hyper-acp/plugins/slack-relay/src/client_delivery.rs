//! OpenClaw `client-delivery.ts` equivalent.
//!
//! The Rust side plans and sends relay-proxy Slack delivery requests; the
//! backend relay owns direct Slack client credentials.

pub use crate::reply::{
    deliver_slack_reply_payloads, plan_slack_reply_deliveries, SlackRelayHttpSender,
    SlackReplyDelivery, SlackReplyDeliveryError, SlackReplyDeliveryTarget, SlackReplyPayload,
    SlackSendResult,
};
