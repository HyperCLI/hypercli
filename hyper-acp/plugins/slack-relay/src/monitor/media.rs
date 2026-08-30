//! OpenClaw `monitor/media.ts` / `monitor/media-types.ts` boundary.
//!
//! Direct and relay transports both use this module for Slack file metadata
//! admission before prompting or download planning.

use serde_json::Value;
use url::Url;

use crate::client::SlackWebApiOperation;
pub use crate::content::{SlackFile, MAX_SLACK_MEDIA_FILES};
pub use crate::history::SlackHydratedMedia;
use crate::reply::SlackRelayApiProxyRequest;

/// Download transport plan for an admitted Slack file.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SlackMediaDownloadPlan {
    /// Direct Slack Web API/client download.
    Direct {
        /// Slack-authenticated private download URL.
        url: String,
        /// Optional file size.
        size_bytes: Option<u64>,
    },
    /// HyperCLI relay proxy metadata/download request.
    Relay(SlackRelayApiProxyRequest),
}

/// Returns whether a Slack file has enough metadata to appear in prompt text.
#[must_use]
pub fn slack_file_has_prompt_metadata(file: &SlackFile) -> bool {
    file.id.as_deref().is_some_and(|id| !id.trim().is_empty())
        || file
            .name
            .as_deref()
            .is_some_and(|name| !name.trim().is_empty())
}

/// Returns true when Slack file metadata is safe to hydrate into prompt media.
#[must_use]
pub fn slack_file_metadata_allowed(file_info: &Value, media_max_bytes: Option<u64>) -> bool {
    let file = file_info.get("file").unwrap_or(file_info);
    if let (Some(size), Some(max)) = (file.get("size").and_then(Value::as_u64), media_max_bytes) {
        if size > max {
            return false;
        }
    }
    if file
        .get("mimetype")
        .or_else(|| file.get("mime_type"))
        .and_then(Value::as_str)
        .is_some_and(is_blocked_mime_type)
    {
        return false;
    }
    let Some(url) = file
        .get("url_private_download")
        .or_else(|| file.get("url_private"))
        .or_else(|| file.get("permalink"))
        .and_then(Value::as_str)
    else {
        return true;
    };
    slack_download_url_allowed(url)
}

/// Plans direct Slack file metadata hydration.
#[must_use]
pub fn plan_direct_file_info(file: &SlackFile) -> Option<SlackWebApiOperation> {
    let file_id = file.id.as_deref()?.trim();
    (!file_id.is_empty()).then(|| crate::client::files_info_operation(file_id))
}

/// Returns true for Slack-controlled HTTPS download URLs.
#[must_use]
pub fn slack_download_url_allowed(raw: &str) -> bool {
    let Ok(url) = Url::parse(raw) else {
        return false;
    };
    if url.scheme() != "https" {
        return false;
    }
    let Some(host) = url.host_str().map(str::to_ascii_lowercase) else {
        return false;
    };
    host == "files.slack.com"
        || host.ends_with(".files.slack.com")
        || host == "slack-files.com"
        || host.ends_with(".slack-files.com")
        || host == "slack.com"
        || host.ends_with(".slack.com")
}

fn is_blocked_mime_type(value: &str) -> bool {
    matches!(
        value.to_ascii_lowercase().as_str(),
        "text/html" | "application/xhtml+xml"
    )
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn file_prompt_metadata_accepts_id_or_name() {
        assert!(slack_file_has_prompt_metadata(&SlackFile {
            id: Some("F1".to_owned()),
            name: None,
        }));
        assert!(!slack_file_has_prompt_metadata(&SlackFile {
            id: Some(" ".to_owned()),
            name: None,
        }));
    }

    #[test]
    fn media_security_rejects_private_urls_html_and_oversize() {
        assert!(slack_file_metadata_allowed(
            &serde_json::json!({"file":{"url_private":"https://files.slack.com/F1","mimetype":"image/png","size":10}}),
            Some(20)
        ));
        assert!(!slack_file_metadata_allowed(
            &serde_json::json!({"file":{"url_private":"http://files.slack.com/F1"}}),
            None
        ));
        assert!(!slack_file_metadata_allowed(
            &serde_json::json!({"file":{"url_private":"https://127.0.0.1/F1"}}),
            None
        ));
        assert!(!slack_file_metadata_allowed(
            &serde_json::json!({"file":{"url_private":"https://example.com/F1"}}),
            None
        ));
        assert!(!slack_file_metadata_allowed(
            &serde_json::json!({"file":{"mimetype":"text/html"}}),
            None
        ));
        assert!(!slack_file_metadata_allowed(
            &serde_json::json!({"file":{"size":99}}),
            Some(50)
        ));
    }
}
