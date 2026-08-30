//! OpenClaw `monitor/block-text.ts` equivalent.

pub use crate::monitor::message_handler::prepare_content::extract_slack_block_text;

#[cfg(test)]
mod tests {
    use serde_json::json;

    #[test]
    fn extracts_rich_text_from_block_only_history() {
        let blocks = json!([{
            "type":"rich_text",
            "elements":[{
                "type":"rich_text_section",
                "elements":[{"type":"text","text":"from block"}]
            }]
        }]);
        assert_eq!(
            super::extract_slack_block_text(blocks.as_array().unwrap()).as_deref(),
            Some("from block")
        );
    }
}
