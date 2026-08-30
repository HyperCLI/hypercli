//! OpenClaw-shaped Slack monitor modules.
//!
//! The implementation stays in small Rust modules, while this tree preserves
//! the same responsibility names as `openclaw-git/extensions/slack/src/monitor`.

pub mod allow_list;
pub mod auth;
pub mod block_text;
pub mod channel_config;
pub mod channel_type;
pub mod context;
pub mod dm_auth;
pub mod events;
pub mod ingress;
pub mod media;
pub mod message_dispatch_dedupe;
pub mod message_handler;
pub mod mrkdwn;
pub mod provider;
pub mod reconnect_policy;
pub mod relay_source;
pub mod replies;
pub mod thread;
