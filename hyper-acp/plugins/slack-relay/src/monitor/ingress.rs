//! OpenClaw `monitor/ingress.ts` equivalent.
//!
//! The Rust connector uses JSONL durable records at the relay edge instead of
//! OpenClaw's shared channel ingress queue.

pub use crate::active::{
    ActiveSlackRelayFrameOutcome, ActiveSlackRelayLifecycle, DurableSlackRelayAction,
    DurableSlackRelayRecord, DurableSlackRelayStore, JsonlSlackRelayStore, MemorySlackRelayStore,
};
