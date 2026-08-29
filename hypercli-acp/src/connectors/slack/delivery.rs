use reqwest::header::{AUTHORIZATION, RETRY_AFTER};
use serde::Deserialize;
use serde_json::json;
use thiserror::Error;
use url::Url;

use super::config::SlackRelayConfig;
use super::types::{DeliveryReceipt, SlackDeliveryRequest};

#[derive(Debug, Clone)]
pub struct SlackApiClient {
    client: reqwest::Client,
    api_url: Url,
    agents_api_key: String,
}

#[derive(Debug, Error)]
pub enum SlackApiError {
    #[error("invalid Slack API proxy method URL: {0}")]
    InvalidMethodUrl(url::ParseError),
    #[error("Slack API proxy request failed: {0}")]
    Request(#[from] reqwest::Error),
    #[error("Slack API proxy rate limited retry_after={retry_after:?}")]
    RateLimited { retry_after: Option<String> },
    #[error("Slack API proxy returned HTTP {status}: {body}")]
    Http { status: u16, body: String },
    #[error("Slack API proxy returned ok=false: {error}")]
    Slack { error: String },
}

impl SlackApiClient {
    pub fn new(config: &SlackRelayConfig) -> Self {
        Self {
            client: reqwest::Client::new(),
            api_url: config.api_url.clone(),
            agents_api_key: config.agents_api_key.clone(),
        }
    }

    pub async fn post_message(
        &self,
        request: SlackDeliveryRequest,
    ) -> Result<DeliveryReceipt, SlackApiError> {
        let url = self
            .api_url
            .join("chat.postMessage")
            .map_err(SlackApiError::InvalidMethodUrl)?;
        let response = self
            .client
            .post(url)
            .header(AUTHORIZATION, format!("Bearer {}", self.agents_api_key))
            .json(&json!({
                "channel": request.channel_id,
                "text": request.text,
                "thread_ts": request.thread_ts,
                "unfurl_links": false,
                "unfurl_media": false,
            }))
            .send()
            .await?;

        if response.status().as_u16() == 429 {
            return Err(SlackApiError::RateLimited {
                retry_after: response
                    .headers()
                    .get(RETRY_AFTER)
                    .and_then(|value| value.to_str().ok())
                    .map(ToOwned::to_owned),
            });
        }

        if !response.status().is_success() {
            let status = response.status().as_u16();
            let body = response.text().await.unwrap_or_default();
            return Err(SlackApiError::Http { status, body });
        }

        let payload: ChatPostMessageResponse = response.json().await?;
        if !payload.ok {
            return Err(SlackApiError::Slack {
                error: payload.error.unwrap_or_else(|| "unknown_error".to_owned()),
            });
        }

        Ok(DeliveryReceipt {
            provider: "slack",
            channel_id: payload.channel.unwrap_or(request.channel_id),
            message_ts: payload.ts,
            thread_ts: payload
                .message
                .and_then(|message| message.thread_ts)
                .or(request.thread_ts),
        })
    }
}

#[derive(Debug, Deserialize)]
struct ChatPostMessageResponse {
    ok: bool,
    #[serde(default)]
    error: Option<String>,
    #[serde(default)]
    channel: Option<String>,
    #[serde(default)]
    ts: Option<String>,
    #[serde(default)]
    message: Option<SlackPostedMessage>,
}

#[derive(Debug, Deserialize)]
struct SlackPostedMessage {
    #[serde(default)]
    thread_ts: Option<String>,
}
