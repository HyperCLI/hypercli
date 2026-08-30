//! OpenClaw `send.ts` equivalent.
//!
//! HyperCLI sends through the relay API proxy using `HYPER_AGENTS_API_KEY`.

pub use crate::reply::{
    build_chat_post_message_proxy_request as build_slack_post_message_proxy_request,
    build_files_complete_upload_proxy_request, build_files_get_upload_url_proxy_request,
    plan_slack_reply_deliveries, SlackRelayApiProxyRequest, SlackRelayHttpSender,
    SlackReplyDelivery, SlackReplyDeliveryError, SlackReplyDeliveryTarget, SlackReplyPayload,
    SlackSendResult,
};
