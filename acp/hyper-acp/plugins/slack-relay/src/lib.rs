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
//! TS-to-Rust port of OpenClaw Slack behavior where possible, driving a
//! per-conversation-scope ACP session pool from relay-sourced Slack events.

pub mod allowlist;
pub mod client;
pub mod client_delivery;
pub mod commands;
pub mod config;
pub mod config_schema;
pub mod format;
pub mod limits;
pub mod monitor;
pub mod plugin;
pub mod pool;
pub mod queue;
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
