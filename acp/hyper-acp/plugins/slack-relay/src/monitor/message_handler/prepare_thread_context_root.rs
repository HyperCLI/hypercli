//! OpenClaw `monitor/message-handler/prepare-thread-context-root.ts` equivalent.

pub use crate::monitor::message_handler::prepare_dm_history::{
    extract_thread_starter_files, hydrate_active_thread_starter_media,
};

/// Returns true when a Slack event has thread-starter file metadata that should
/// be considered for root context hydration.
#[must_use]
pub fn has_thread_context_root_files(payload: &serde_json::Value) -> bool {
    !extract_thread_starter_files(payload).is_empty()
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn detects_thread_root_files() {
        assert!(super::has_thread_context_root_files(&json!({
            "thread_starter": {"files": [{"id":"F1","name":"a.txt"}]}
        })));
    }
}
