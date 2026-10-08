//! Platform session metadata and retained history, separate from ACP wire traffic.
//! All paths are relative to the configured agents API base. Reads never dial a runtime.

use std::collections::{HashMap, HashSet};
use std::time::Duration;

use reqwest::Method;
use secrecy::ExposeSecret;
use serde::{de::DeserializeOwned, Deserialize, Deserializer, Serialize};
use serde_json::Value;
use thiserror::Error;

use crate::{AcpPromptAcceptance, HyperCliClient, HyperCliError};

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

/// Exact platform evidence, not an ACP prompt response or synthesized wire event.
#[derive(Clone, Debug, PartialEq)]
pub struct SessionPromptCompletion {
    pub session_id: String,
    pub message_id: String,
    pub agent_id: String,
    pub stop_reason: String,
    pub completed_at: String,
}

#[derive(Debug, Error)]
pub enum SessionCompletionError {
    #[error(
        "completion observation expired for {session_id}/{message_id}; do not resend the input"
    )]
    Timeout {
        session_id: String,
        message_id: String,
    },
    #[error("completion observation failed for {session_id}/{message_id}: {source}")]
    Read {
        session_id: String,
        message_id: String,
        #[source]
        source: HyperCliError,
    },
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

    /// Match the admitted ID, target agent, original input sequence and completion
    /// timestamp to a retained terminal record. Detail receipts or idle alone do
    /// not establish a stop reason. Missing evidence returns `None`.
    pub async fn get_prompt_completion(
        &self,
        session_id: &str,
        message_id: &str,
        agent_id: &str,
    ) -> Result<Option<SessionPromptCompletion>, HyperCliError> {
        let mut evidence = CompletionEvidence::default();
        let mut options = SessionMessagesOptions {
            cursor: None,
            limit: Some(100),
        };
        let mut visited = HashSet::new();
        loop {
            let page = self.get_messages(session_id, &options).await?.page;
            for row in page.items {
                if let Some(completion) = evidence.observe(row, session_id, message_id, agent_id) {
                    return Ok(completion);
                }
            }
            if !page.has_more {
                return Ok(None);
            }
            let cursor = page
                .next_cursor
                .filter(|cursor| !cursor.is_empty())
                .ok_or_else(|| {
                    HyperCliError::InvalidResponse(
                        "session history has_more without a cursor".into(),
                    )
                })?;
            if !visited.insert(cursor.clone()) {
                return Err(HyperCliError::InvalidResponse(
                    "session history repeated a cursor".into(),
                ));
            }
            options.cursor = Some(cursor);
        }
    }

    /// Observe one acceptance through REST, including after ACP disconnect. The
    /// timeout bounds observation only: it neither cancels nor resubmits execution.
    /// Polls once per second; errors preserve the accepted identity for recovery.
    pub async fn wait_prompt_completion(
        &self,
        accepted: &AcpPromptAcceptance,
        agent_id: &str,
        timeout: Duration,
    ) -> Result<SessionPromptCompletion, SessionCompletionError> {
        let observe = async {
            loop {
                match self
                    .get_prompt_completion(&accepted.session_id, &accepted.message_id, agent_id)
                    .await
                {
                    Ok(Some(completion)) => return Ok(completion),
                    Ok(None) => tokio::time::sleep(Duration::from_secs(1)).await,
                    Err(source) => {
                        return Err(SessionCompletionError::Read {
                            session_id: accepted.session_id.clone(),
                            message_id: accepted.message_id.clone(),
                            source,
                        });
                    }
                }
            }
        };
        tokio::time::timeout(timeout, observe)
            .await
            .unwrap_or_else(|_| {
                Err(SessionCompletionError::Timeout {
                    session_id: accepted.session_id.clone(),
                    message_id: accepted.message_id.clone(),
                })
            })
    }
}

#[derive(Default)]
struct CompletionEvidence {
    // History is newest-first. Keep the newest terminal even if it lacks a
    // completion stamp: falling back to an older attempt would fabricate proof.
    turns: HashMap<u64, SessionMessage>,
}

impl CompletionEvidence {
    fn observe(
        &mut self,
        row: SessionMessage,
        session_id: &str,
        message_id: &str,
        agent_id: &str,
    ) -> Option<Option<SessionPromptCompletion>> {
        if row.session_id != session_id {
            return None;
        }
        if row.acp["type"] == "turn_result"
            && row.participant_kind.as_deref() == Some("agent")
            && row.participant_id.as_deref() == Some(agent_id)
        {
            if let Some(seq) = row.acp["messageSeq"].as_u64() {
                self.turns.entry(seq).or_insert(row);
            }
            return None;
        }
        if row.role != "user"
            || row.acp["type"] != "user_message"
            || row.acp["messageId"] != message_id
            || row.acp["agentId"] != agent_id
        {
            return None;
        }
        let completion = self.turns.get(&row.seq).and_then(|terminal| {
            let completed_at = row
                .completed_at
                .as_ref()
                .filter(|stamp| !stamp.is_empty())?;
            if terminal.seq <= row.seq || terminal.completed_at.as_ref() != Some(completed_at) {
                return None;
            }
            let stop_reason = terminal
                .stop_reason
                .as_ref()
                .filter(|reason| !reason.is_empty())?;
            Some(SessionPromptCompletion {
                session_id: session_id.to_owned(),
                message_id: message_id.to_owned(),
                agent_id: agent_id.to_owned(),
                stop_reason: stop_reason.clone(),
                completed_at: completed_at.clone(),
            })
        });
        Some(completion)
    }
}
