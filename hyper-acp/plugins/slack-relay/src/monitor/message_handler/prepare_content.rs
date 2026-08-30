//! OpenClaw `monitor/message-handler/prepare-content.ts` equivalent.

pub use crate::content::{
    collect_unique_slack_mention_ids, format_slack_file_reference,
    format_slack_file_reference_list, render_slack_user_mentions, resolve_slack_message_content,
    slack_message_for_content_from_value, SlackAttachment, SlackFile, SlackMessageForContent,
    SlackResolvedMessageContent, MAX_SLACK_MEDIA_FILES,
    SLACK_MENTION_RESOLUTION_MAX_LOOKUPS_PER_MESSAGE,
};
