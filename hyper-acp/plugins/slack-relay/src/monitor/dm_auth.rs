//! OpenClaw `monitor/dm-auth.ts` equivalent.

pub use crate::dm::{
    authorize_slack_direct_message, build_users_info_proxy_request,
    format_pairing_challenge_text as build_pairing_challenge_text,
    resolve_slack_user_name_from_info, SlackDirectMessageAuthorization,
    SlackDirectMessageAuthorizationInput,
};
