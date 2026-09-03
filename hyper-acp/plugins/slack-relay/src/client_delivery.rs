//! OpenClaw `client-delivery.ts` equivalent.
//!
//! Exposes the shared reply delivery plan and concrete relay/direct client
//! delivery boundaries.

pub use crate::client::{SlackDirectClientConfig, SlackDirectWebApiClient, SlackWebApiOperation};
pub use crate::monitor::replies::{
    deliver_slack_reply_payloads, deliver_slack_reply_payloads_direct, direct_request_for_delivery,
    plan_slack_reply_deliveries, relay_request_for_operation, SlackDeliveryTransport,
    SlackRelayHttpSender, SlackReplyDelivery, SlackReplyDeliveryError, SlackReplyDeliveryTarget,
    SlackReplyPayload, SlackSendResult,
};
