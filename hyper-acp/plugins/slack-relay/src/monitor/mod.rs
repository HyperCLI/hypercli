//! OpenClaw-shaped Slack monitor module facade.
//!
//! The implementation stays in small Rust modules, while this tree preserves
//! the same responsibility names as `openclaw-git/extensions/slack/src/monitor`.

pub mod context;
pub mod dm_auth;
pub mod ingress;
pub mod media;
pub mod message_dispatch_dedupe;
pub mod message_handler;
pub mod reconnect_policy;
pub mod relay_source;
pub mod replies;
pub mod thread;
