//! Direct Slack Web API client boundary.
//!
//! Provenance:
//! - `openclaw-git/extensions/slack/src/client.ts` for token-scoped client
//!   creation and token cache-key behavior.
//! - `openclaw-git/extensions/slack/src/client-options.ts` and
//!   `client.web-api.test.ts` for write-client rate-limit behavior.
//!
//! HyperCLI relay mode uses the same [`SlackWebApiOperation`] values through a
//! relay proxy adapter; direct mode sends those operations to Slack with
//! `SLACK_BOT_TOKEN`.

use serde_json::{json, Value};
use sha2::{Digest, Sha256};
use thiserror::Error;

/// Direct Slack bot-token environment variable.
pub const SLACK_BOT_TOKEN_ENV: &str = "SLACK_BOT_TOKEN";

/// Direct Slack Web API base URL.
pub const DEFAULT_SLACK_WEB_API_BASE_URL: &str = "https://slack.com/api";

/// Direct Slack client configuration.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackDirectClientConfig {
    /// `xoxb-...` bot token.
    pub bot_token: String,
    /// Slack Web API base URL.
    pub api_base_url: String,
}

impl SlackDirectClientConfig {
    /// Loads direct Slack config from `SLACK_BOT_TOKEN`.
    ///
    /// # Errors
    ///
    /// Returns [`SlackDirectClientConfigError::MissingBotToken`] when no token
    /// is configured.
    pub fn from_env() -> Result<Self, SlackDirectClientConfigError> {
        let bot_token = std::env::var(SLACK_BOT_TOKEN_ENV)
            .ok()
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
            .ok_or(SlackDirectClientConfigError::MissingBotToken)?;
        Ok(Self {
            bot_token,
            api_base_url: DEFAULT_SLACK_WEB_API_BASE_URL.to_owned(),
        })
    }
}

/// Direct Slack config errors.
#[derive(Debug, Clone, PartialEq, Eq, Error)]
pub enum SlackDirectClientConfigError {
    /// Missing `SLACK_BOT_TOKEN`.
    #[error("SLACK_BOT_TOKEN is required for direct Slack Web API mode")]
    MissingBotToken,
}

/// Transport-neutral Slack Web API operation.
#[derive(Debug, Clone, PartialEq, Eq)]
pub enum SlackWebApiOperation {
    /// `chat.postMessage`.
    ChatPostMessage {
        /// JSON body.
        body: Value,
    },
    /// `chat.update`.
    ChatUpdate {
        /// JSON body.
        body: Value,
    },
    /// `assistant.threads.setStatus`.
    AssistantThreadsSetStatus {
        /// JSON body.
        body: Value,
    },
    /// `files.getUploadURLExternal`.
    FilesGetUploadUrlExternal {
        /// JSON body.
        body: Value,
    },
    /// Raw upload to Slack's returned file upload URL.
    FilesUploadBytes {
        /// Upload URL returned by Slack.
        url: String,
        /// Bytes to upload.
        bytes: Vec<u8>,
    },
    /// `files.completeUploadExternal`.
    FilesCompleteUploadExternal {
        /// JSON body.
        body: Value,
    },
    /// `reactions.add`.
    ReactionsAdd {
        /// JSON body.
        body: Value,
    },
    /// `reactions.remove`.
    ReactionsRemove {
        /// JSON body.
        body: Value,
    },
    /// `conversations.replies`.
    ConversationsReplies {
        /// JSON body.
        body: Value,
    },
    /// `files.info`.
    FilesInfo {
        /// JSON body.
        body: Value,
    },
    /// `users.info`.
    UsersInfo {
        /// JSON body.
        body: Value,
    },
}

impl SlackWebApiOperation {
    /// Slack API method path, when the operation is a JSON Web API method.
    #[must_use]
    pub fn method(&self) -> Option<&'static str> {
        match self {
            Self::ChatPostMessage { .. } => Some("chat.postMessage"),
            Self::ChatUpdate { .. } => Some("chat.update"),
            Self::AssistantThreadsSetStatus { .. } => Some("assistant.threads.setStatus"),
            Self::FilesGetUploadUrlExternal { .. } => Some("files.getUploadURLExternal"),
            Self::FilesUploadBytes { .. } => None,
            Self::FilesCompleteUploadExternal { .. } => Some("files.completeUploadExternal"),
            Self::ReactionsAdd { .. } => Some("reactions.add"),
            Self::ReactionsRemove { .. } => Some("reactions.remove"),
            Self::ConversationsReplies { .. } => Some("conversations.replies"),
            Self::FilesInfo { .. } => Some("files.info"),
            Self::UsersInfo { .. } => Some("users.info"),
        }
    }

    /// JSON body for Slack Web API methods.
    #[must_use]
    pub fn body(&self) -> Option<&Value> {
        match self {
            Self::ChatPostMessage { body }
            | Self::ChatUpdate { body }
            | Self::AssistantThreadsSetStatus { body }
            | Self::FilesGetUploadUrlExternal { body }
            | Self::FilesCompleteUploadExternal { body }
            | Self::ReactionsAdd { body }
            | Self::ReactionsRemove { body }
            | Self::ConversationsReplies { body }
            | Self::FilesInfo { body }
            | Self::UsersInfo { body } => Some(body),
            Self::FilesUploadBytes { .. } => None,
        }
    }
}

/// Concrete HTTP request built for direct Slack Web API mode.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackDirectWebApiRequest {
    /// HTTP method.
    pub method: String,
    /// URL.
    pub url: String,
    /// Authorization header, absent for raw upload URLs.
    pub authorization: Option<String>,
    /// JSON body for Web API methods.
    pub body: Option<Value>,
    /// Raw upload bytes for `FilesUploadBytes`.
    pub bytes: Option<Vec<u8>>,
}

/// Builds a direct Slack HTTP request from a transport-neutral operation.
#[must_use]
pub fn build_direct_slack_web_api_request(
    config: &SlackDirectClientConfig,
    operation: &SlackWebApiOperation,
) -> SlackDirectWebApiRequest {
    match operation {
        SlackWebApiOperation::FilesUploadBytes { url, bytes } => SlackDirectWebApiRequest {
            method: "POST".to_owned(),
            url: url.clone(),
            authorization: None,
            body: None,
            bytes: Some(bytes.clone()),
        },
        _ => SlackDirectWebApiRequest {
            method: "POST".to_owned(),
            url: format!(
                "{}/{}",
                config.api_base_url.trim_end_matches('/'),
                operation.method().expect("json Slack Web API method")
            ),
            authorization: Some(format!("Bearer {}", config.bot_token)),
            body: operation.body().cloned(),
            bytes: None,
        },
    }
}

/// Direct Slack API sender.
#[derive(Debug, Clone)]
pub struct SlackDirectWebApiClient {
    client: reqwest::Client,
    config: SlackDirectClientConfig,
}

impl SlackDirectWebApiClient {
    /// Creates a direct Slack API sender.
    #[must_use]
    pub fn new(config: SlackDirectClientConfig) -> Self {
        Self {
            client: reqwest::Client::new(),
            config,
        }
    }

    /// Sends one operation to Slack.
    ///
    /// # Errors
    ///
    /// Returns HTTP, rate-limit, or Slack `ok:false` errors.
    pub async fn send(
        &self,
        operation: &SlackWebApiOperation,
    ) -> Result<SlackWebApiResponse, SlackWebApiError> {
        let request = build_direct_slack_web_api_request(&self.config, operation);
        let response = if let Some(bytes) = request.bytes {
            self.client.post(request.url).body(bytes).send().await?
        } else {
            let mut builder = self.client.post(request.url);
            if let Some(auth) = request.authorization {
                builder = builder.header(reqwest::header::AUTHORIZATION, auth);
            }
            if let Some(body) = request.body {
                builder = builder.json(&body);
            }
            builder.send().await?
        };
        if response.status() == reqwest::StatusCode::TOO_MANY_REQUESTS {
            let retry_after_seconds = response
                .headers()
                .get(reqwest::header::RETRY_AFTER)
                .and_then(|value| value.to_str().ok())
                .and_then(|value| value.parse::<u64>().ok());
            return Err(SlackWebApiError::RateLimited {
                retry_after_seconds,
            });
        }
        let url = response.url().to_string();
        let value = response.error_for_status()?.json::<Value>().await?;
        if value.get("ok").and_then(Value::as_bool) == Some(false) {
            return Err(SlackWebApiError::SlackApi {
                method: operation.method().unwrap_or("upload").to_owned(),
                error: value
                    .get("error")
                    .and_then(Value::as_str)
                    .unwrap_or("unknown_error")
                    .to_owned(),
            });
        }
        Ok(SlackWebApiResponse { url, body: value })
    }
}

/// Direct Slack API response.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackWebApiResponse {
    /// Request URL.
    pub url: String,
    /// JSON response body.
    pub body: Value,
}

/// Direct Slack Web API errors.
#[derive(Debug, Error)]
pub enum SlackWebApiError {
    /// HTTP client failure.
    #[error("Slack Web API HTTP request failed: {0}")]
    Http(#[from] reqwest::Error),
    /// Slack rate limit; OpenClaw write client rejects rather than sleeping.
    #[error("Slack Web API rate limited")]
    RateLimited {
        /// `Retry-After` seconds, when supplied.
        retry_after_seconds: Option<u64>,
    },
    /// Slack `ok:false`.
    #[error("Slack API rejected {method}: {error}")]
    SlackApi {
        /// Method.
        method: String,
        /// Error.
        error: String,
    },
}

/// Creates OpenClaw-style stable token cache key.
#[must_use]
pub fn create_slack_token_cache_key(token: &str) -> String {
    let mut hasher = Sha256::new();
    hasher.update(token.as_bytes());
    format!("sha256:{}", hex_lower(&hasher.finalize()))
}

/// Builds a `conversations.replies` operation.
#[must_use]
pub fn conversations_replies_operation(
    channel: &str,
    ts: &str,
    limit: usize,
) -> SlackWebApiOperation {
    SlackWebApiOperation::ConversationsReplies {
        body: json!({
            "channel": channel,
            "ts": ts,
            "include_all_metadata": true,
            "limit": limit,
        }),
    }
}

/// Builds a `files.info` operation.
#[must_use]
pub fn files_info_operation(file_id: &str) -> SlackWebApiOperation {
    SlackWebApiOperation::FilesInfo {
        body: json!({ "file": file_id }),
    }
}

/// Builds a `users.info` operation.
#[must_use]
pub fn users_info_operation(user_id: &str) -> SlackWebApiOperation {
    SlackWebApiOperation::UsersInfo {
        body: json!({ "user": user_id }),
    }
}

fn hex_lower(bytes: &[u8]) -> String {
    const HEX: &[u8; 16] = b"0123456789abcdef";
    let mut out = String::with_capacity(bytes.len() * 2);
    for byte in bytes {
        out.push(HEX[(byte >> 4) as usize] as char);
        out.push(HEX[(byte & 0x0f) as usize] as char);
    }
    out
}

#[cfg(test)]
mod tests {
    use serde_json::json;

    use super::*;

    #[test]
    fn direct_config_uses_slack_bot_token_not_hyper_agents_key() {
        let _env = crate::test_env_lock();
        std::env::remove_var(SLACK_BOT_TOKEN_ENV);
        std::env::set_var("HYPER_AGENTS_API_KEY", "relay-key");
        assert!(matches!(
            SlackDirectClientConfig::from_env(),
            Err(SlackDirectClientConfigError::MissingBotToken)
        ));
        std::env::set_var(SLACK_BOT_TOKEN_ENV, "xoxb-direct");
        let config = SlackDirectClientConfig::from_env().unwrap();
        assert_eq!(config.bot_token, "xoxb-direct");
        std::env::remove_var(SLACK_BOT_TOKEN_ENV);
    }

    #[test]
    fn direct_request_uses_bot_token_and_slack_method_url() {
        let config = SlackDirectClientConfig {
            bot_token: "xoxb-1".to_owned(),
            api_base_url: "https://slack.test/api/".to_owned(),
        };
        let request = build_direct_slack_web_api_request(
            &config,
            &SlackWebApiOperation::ChatPostMessage {
                body: json!({"channel":"C1","text":"hi"}),
            },
        );
        assert_eq!(request.url, "https://slack.test/api/chat.postMessage");
        assert_eq!(request.authorization.as_deref(), Some("Bearer xoxb-1"));
        assert_eq!(request.body.unwrap()["channel"], "C1");
    }

    #[test]
    fn direct_history_and_file_operations_are_not_relay_proxy_requests() {
        assert_eq!(
            conversations_replies_operation("C1", "100.1", 20).method(),
            Some("conversations.replies")
        );
        assert_eq!(files_info_operation("F1").method(), Some("files.info"));
        assert_eq!(users_info_operation("U1").method(), Some("users.info"));
    }

    #[test]
    fn token_cache_key_is_sha256_scoped() {
        let key = create_slack_token_cache_key("xoxb-token");
        assert!(key.starts_with("sha256:"));
        assert_eq!(key.len(), "sha256:".len() + 64);
    }
}
