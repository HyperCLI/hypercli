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

//! HyperCLI ACP Slack relay plugin boundary.
//!
//! This crate keeps Slack relay behavior out of ACP core. It is a semantic
//! TS-to-Rust port of OpenClaw Slack relay/source behavior where possible, with
//! thin Rust equivalents for runtime-bound pieces.

pub mod active;
pub mod admission;
pub mod allowlist;
pub mod client_delivery;
pub mod commands;
pub mod content;
pub mod dedupe;
pub mod dm;
pub mod event;
pub mod history;
pub mod ingress;
pub mod manager;
mod module_map;
pub mod monitor;
pub mod output;
pub mod reconnect;
pub mod relay_source;
pub mod reply;
pub mod routing;
pub mod send;
pub mod thread_ts;
