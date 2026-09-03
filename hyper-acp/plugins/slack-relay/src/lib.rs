#![allow(
    clippy::cast_possible_truncation,
    clippy::cast_precision_loss,
    clippy::cast_sign_loss,
    clippy::doc_markdown,
    clippy::exhaustive_enums,
    clippy::exhaustive_structs,
    clippy::missing_panics_doc,
    clippy::multiple_crate_versions,
    clippy::struct_excessive_bools
)]

//! HyperCLI ACP Slack connector.
//!
//! This crate keeps Slack behavior out of ACP core. It is a semantic
//! TS-to-Rust port of OpenClaw Slack behavior where possible, with HyperCLI
//! relay and direct Slack bot-token transports sharing the same core shapes.

pub mod active;
pub mod admission;
pub mod allowlist;
pub mod client;
pub mod client_delivery;
pub mod commands;
pub mod config;
pub mod config_schema;
pub mod content;
pub mod dedupe;
pub mod dm;
pub mod event;
pub mod format;
pub mod history;
pub mod ingress;
pub mod limits;
pub mod manager;
mod module_map;
pub mod monitor;
pub mod output;
pub mod plugin;
pub mod pool;
pub mod queue;
pub mod reconnect;
pub mod relay_source;
pub mod reply;
pub mod routing;
pub mod scope;
pub mod send;
pub mod thread_ts;
pub mod truncate;

#[cfg(test)]
pub(crate) static TEST_ENV_LOCK: std::sync::Mutex<()> = std::sync::Mutex::new(());

#[cfg(test)]
pub(crate) fn test_env_lock() -> std::sync::MutexGuard<'static, ()> {
    TEST_ENV_LOCK.lock().unwrap()
}
