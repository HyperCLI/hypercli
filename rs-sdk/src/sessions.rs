//! Platform session metadata and retained history, separate from ACP wire traffic.
//! All paths are relative to the configured agents API base. Reads never dial a runtime.

use crate::{HyperCliClient, HyperCliError};
use reqwest::Method;
use secrecy::ExposeSecret;
use serde::{de::DeserializeOwned, Deserialize, Deserializer, Serialize};
use serde_json::Value;

fn null_vec<'de, D, T>(deserializer: D) -> Result<Vec<T>, D::Error>
where
    D: Deserializer<'de>,
    T: Deserialize<'de>,
{
    Ok(Option::<Vec<T>>::deserialize(deserializer)?.unwrap_or_default())
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct SessionParticipant {
    pub kind: String,
    pub participant_id: String,
    pub internal_session_id: Option<String>,
    #[serde(default)]
    pub cursor_pos: u64,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct SessionReceipt {
    pub message_id: String,
    pub role: String,
    pub created_at: Option<String>,
    pub delivered_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct SessionImportOutcome {
    pub status: String,
    pub protocol_version: Option<u64>,
    pub generation: u64,
    pub recorded_at: String,
    pub observed_updates: u64,
    pub valid_updates: u64,
    pub filtered_updates: u64,
    pub invalid_updates: u64,
    pub foreign_updates: u64,
    pub retained_rows: u64,
}

/// Catalog record plus optional detail fields. Absent detail counters are unknown,
/// not evidence of an empty session. Source and agent state remain forward-open.
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct SessionRecord {
    pub id: String,
    pub source: Option<String>,
    pub summary_text: Option<String>,
    #[serde(default, deserialize_with = "null_vec")]
    pub summary_keywords: Vec<String>,
    pub created_at: Option<String>,
    pub updated_at: Option<String>,
    #[serde(default)]
    pub participants: Vec<SessionParticipant>,
    pub import_outcome: Option<SessionImportOutcome>,
    pub last_message_id: Option<String>,
    pub message_count: Option<u64>,
    pub head_seq: Option<u64>,
    #[serde(default)]
    pub receipts: Vec<SessionReceipt>,
    /// Platform availability, never turn completion evidence.
    #[serde(rename = "agentState", alias = "agent_state")]
    pub agent_state: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct SessionMessage {
    pub session_id: String,
    /// Stable platform identity, separate from the retained ACP payload.
    pub message_id: Option<String>,
    pub seq: u64,
    pub role: String,
    pub acp: Value,
    pub participant_kind: Option<String>,
    pub participant_id: Option<String>,
    pub stop_reason: Option<String>,
    pub created_at: Option<String>,
    pub delivered_at: Option<String>,
    pub completed_at: Option<String>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct SessionPage<T> {
    pub items: Vec<T>,
    pub next_cursor: Option<String>,
    pub has_more: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct SessionMessagePage {
    #[serde(flatten)]
    pub page: SessionPage<SessionMessage>,
    pub import_outcome: Option<SessionImportOutcome>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct SessionDiscoveryStatus {
    pub status: String,
    pub history_status: Option<String>,
    pub error_code: Option<String>,
    pub discovered_count: Option<u64>,
    #[serde(default)]
    pub queued_count: u64,
    #[serde(default)]
    pub importing_count: u64,
    pub last_attempt_at: Option<String>,
    pub last_completed_at: Option<String>,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct SessionListOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct SessionMessagesOptions {
    /// Opaque REST cursor, never an ACP replay cursor.
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct SessionSearchOptions {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cursor: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub limit: Option<u32>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct SessionSearchHit {
    pub session_id: String,
    pub seq: u64,
    pub role: String,
    pub message_id: Option<String>,
    pub excerpt: String,
    pub score: Option<f64>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct SessionMessagesWindow {
    pub session_id: String,
    pub focus_seq: u64,
    pub items: Vec<SessionMessage>,
}

/// Async session reads using the parent's credentials and injected HTTP transport.
#[derive(Clone, Copy)]
pub struct SessionsClient<'a> {
    client: &'a HyperCliClient,
}

impl HyperCliClient {
    pub fn sessions(&self) -> SessionsClient<'_> {
        SessionsClient { client: self }
    }
}

impl SessionsClient<'_> {
    fn request(
        &self,
        method: Method,
        segments: &[&str],
    ) -> Result<reqwest::RequestBuilder, HyperCliError> {
        if segments
            .iter()
            .any(|segment| matches!(*segment, "" | "." | ".."))
        {
            return Err(HyperCliError::InvalidResponse(
                "session path segment must not be empty or a dot segment".into(),
            ));
        }
        let mut url = self.client.api_base.clone();
        url.set_query(None);
        url.set_fragment(None);
        url.path_segments_mut()
            .map_err(|_| HyperCliError::InvalidResponse("invalid agents API base".into()))?
            .pop_if_empty()
            .push("sessions")
            .extend(segments.iter().copied());
        Ok(self
            .client
            .async_http
            .request(method, url)
            .bearer_auth(self.client.api_key.expose_secret()))
    }

    async fn read<T: DeserializeOwned>(
        request: reqwest::RequestBuilder,
    ) -> Result<T, HyperCliError> {
        let response = request
            .send()
            .await
            .map_err(|error| HyperCliError::Transport(error.without_url().to_string()))?;
        if !response.status().is_success() {
            return Err(HyperCliError::Status(response.status()));
        }
        response
            .json()
            .await
            .map_err(|error| HyperCliError::InvalidResponse(error.without_url().to_string()))
    }

    /// Detail reads best-effort advance the caller's user read receipt to the head.
    pub async fn get_session(&self, session_id: &str) -> Result<SessionRecord, HyperCliError> {
        Self::read(self.request(Method::GET, &[session_id])?).await
    }

    pub async fn list_sessions(
        &self,
        options: &SessionListOptions,
    ) -> Result<SessionPage<SessionRecord>, HyperCliError> {
        Self::read(self.request(Method::GET, &[])?.query(options)).await
    }

    /// Retained history, newest first; no runtime attachment required.
    pub async fn get_messages(
        &self,
        session_id: &str,
        options: &SessionMessagesOptions,
    ) -> Result<SessionMessagePage, HyperCliError> {
        Self::read(
            self.request(Method::GET, &[session_id, "messages"])?
                .query(options),
        )
        .await
    }

    pub async fn get_discovery_status(
        &self,
        agent_id: &str,
    ) -> Result<SessionDiscoveryStatus, HyperCliError> {
        Self::read(
            self.request(Method::GET, &["discovery"])?
                .query(&[("agent_id", agent_id)]),
        )
        .await
    }

    /// Explicit platform discovery request. Unsupported is retained as a status.
    pub async fn request_discovery(
        &self,
        agent_id: &str,
    ) -> Result<SessionDiscoveryStatus, HyperCliError> {
        Self::read(
            self.request(Method::POST, &["discovery"])?
                .query(&[("agent_id", agent_id)]),
        )
        .await
    }

    pub async fn search_transcript(
        &self,
        query: &str,
        options: &SessionSearchOptions,
    ) -> Result<SessionPage<SessionSearchHit>, HyperCliError> {
        Self::read(
            self.request(Method::GET, &["search"])?
                .query(&[("q", query)])
                .query(options),
        )
        .await
    }

    pub async fn get_messages_around(
        &self,
        session_id: &str,
        seq: u64,
        radius: Option<u32>,
    ) -> Result<SessionMessagesWindow, HyperCliError> {
        let mut request = self
            .request(Method::GET, &[session_id, "messages", "around"])?
            .query(&[("seq", seq)]);
        if let Some(radius) = radius {
            request = request.query(&[("radius", radius)]);
        }
        Self::read(request).await
    }
}
