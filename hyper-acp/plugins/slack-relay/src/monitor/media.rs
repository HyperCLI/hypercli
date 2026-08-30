//! OpenClaw `monitor/media.ts` / `monitor/media-types.ts` boundary.
//!
//! HyperCLI currently hydrates Slack file metadata through the relay proxy and
//! leaves direct file downloads to the relay/backend side.

pub use crate::content::{SlackFile, MAX_SLACK_MEDIA_FILES};
pub use crate::history::SlackHydratedMedia;
