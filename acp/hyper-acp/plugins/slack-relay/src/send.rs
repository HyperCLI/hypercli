//! OpenClaw `send.ts` equivalent.
//!
//! Owns Slack send operation exports for both HyperCLI relay proxy transport
//! and direct Slack bot-token Web API transport.

pub use crate::client::{
    build_direct_slack_web_api_request, SlackDirectClientConfig, SlackDirectWebApiClient,
    SlackDirectWebApiRequest, SlackWebApiError, SlackWebApiOperation, SlackWebApiResponse,
    SLACK_BOT_TOKEN_ENV,
};
pub use crate::monitor::replies::{
    build_assistant_thread_status_operation, build_chat_post_message_operation,
    build_chat_post_message_proxy_request as build_slack_post_message_proxy_request,
    build_chat_update_operation, build_files_complete_upload_operation,
    build_files_complete_upload_proxy_request, build_files_get_upload_url_operation,
    build_files_get_upload_url_proxy_request, build_reaction_add_operation,
    build_reaction_remove_operation, deliver_slack_reply_payloads_direct,
    direct_request_for_delivery, plan_slack_reply_deliveries, relay_request_for_operation,
    SlackDeliveryTransport, SlackRelayApiProxyRequest, SlackRelayHttpSender, SlackReplyDelivery,
    SlackReplyDeliveryError, SlackReplyDeliveryTarget, SlackReplyPayload, SlackSendResult,
};
