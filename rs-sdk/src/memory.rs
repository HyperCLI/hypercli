//! Durable session memory search, relative to the agents API base.
//!
//! Mirrors the TypeScript SDK's `MemoryAPI.search` (ts-sdk/src/memory.ts).
//! Wire contract: `agents/backend/agents/memory_routes.py` — a GET on
//! `{agents}/memory/search` with snake_case query parameters, answered by a
//! `{items, next_cursor, has_more}` keyset-paginated envelope.

use std::time::Duration;

use reqwest::{Method, StatusCode};
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Deserializer};
use serde_json::Value;
use thiserror::Error;
use url::Url;

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

#[derive(Debug, Error)]
pub enum MemoryApiError {
    #[error("API key required for session memory")]
    MissingApiKey,
    #[error("memory base URL must be an http(s) hierarchical URL")]
    InvalidBaseUrl,
    #[error("could not resolve the agents API base for the memory client: {0}")]
    BaseDiscovery(#[from] crate::config::ConfigError),
    #[error("memory request could not be sent: {0}")]
    Transport(String),
    #[error("memory search returned HTTP {status}: {detail}")]
    Api { status: StatusCode, detail: String },
    #[error("memory search returned an invalid response: {0}")]
    InvalidResponse(String),
}

impl MemoryApiError {
    pub fn status(&self) -> Option<StatusCode> {
        match self {
            Self::Api { status, .. } => Some(*status),
            _ => None,
        }
    }
}

/// A null or absent keyword list normalizes to an empty vector, matching the
/// TypeScript SDK's `summaryKeywords` projection.
fn de_keywords_default<'de, D>(deserializer: D) -> Result<Vec<String>, D::Error>
where
    D: Deserializer<'de>,
{
    Ok(Option::<Vec<String>>::deserialize(deserializer)?.unwrap_or_default())
}

/// One chunk-level hit from `GET /memory/search`, ordered best-first by
/// cosine score (`1 - distance`).
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct MemorySearchHit {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub session_id: String,
    #[serde(default)]
    pub seq_start: u64,
    #[serde(default)]
    pub seq_end: u64,
    #[serde(default)]
    pub text: String,
    #[serde(default)]
    pub score: f64,
    /// Owning session's title; `None` when unset or on pre-envelope
    /// deployments.
    #[serde(default)]
    pub title: Option<String>,
    /// Owning session's generated summary; `None` when unset or absent.
    #[serde(default)]
    pub summary_text: Option<String>,
    /// Owning session's summary keywords; empty on pre-envelope deployments.
    #[serde(default, deserialize_with = "de_keywords_default")]
    pub summary_keywords: Vec<String>,
}

/// One page of [`MemorySearchHit`] plus backend keyset pagination metadata.
///
/// Rollout tolerance: pre-envelope deployments answer a bare array or
/// `{items}` without pagination keys; both decode to a single terminal page,
/// matching the TypeScript SDK.
#[derive(Clone, Debug, Default, Deserialize, PartialEq)]
pub struct MemorySearchPage {
    #[serde(default)]
    pub items: Vec<MemorySearchHit>,
    /// Opaque cursor over {distance, id} pairs; `None` when the page is
    /// exhausted. Never parse it; feed it back via
    /// [`MemorySearchOptions::cursor`].
    #[serde(default)]
    pub next_cursor: Option<String>,
    /// LIMIT+1 sentinel: more hits exist behind `next_cursor`.
    #[serde(default)]
    pub has_more: bool,
}

impl MemorySearchPage {
    fn from_value(data: Value) -> Result<Self, MemoryApiError> {
        match data {
            Value::Null => Ok(Self::default()),
            Value::Array(_) => {
                let items = serde_json::from_value(data)
                    .map_err(|error| MemoryApiError::InvalidResponse(error.to_string()))?;
                Ok(Self {
                    items,
                    next_cursor: None,
                    has_more: false,
                })
            }
            Value::Object(_) => serde_json::from_value(data)
                .map_err(|error| MemoryApiError::InvalidResponse(error.to_string())),
            _ => Err(MemoryApiError::InvalidResponse(
                "memory search response must be an object or array".to_owned(),
            )),
        }
    }
}

/// Options for [`MemoryApiClient::search`].
#[derive(Clone, Debug, Default, Eq, PartialEq)]
pub struct MemorySearchOptions {
    /// Restrict to one session (UUID).
    pub session_id: Option<String>,
    /// Restrict to sessions of one agent (UUID).
    pub agent_id: Option<String>,
    /// Opaque cursor from a previous page's `next_cursor`; omitted starts at
    /// the best matches.
    pub cursor: Option<String>,
    /// Page size; the backend clamps to 1..=100 with a default of 10.
    pub limit: Option<u32>,
}

fn response_error_detail(status: StatusCode, text: &str) -> String {
    if text.is_empty() {
        return status
            .canonical_reason()
            .unwrap_or("request failed")
            .to_owned();
    }
    if let Ok(payload) = serde_json::from_str::<Value>(text) {
        if let Some(detail) = ["detail", "message", "error"]
            .iter()
            .filter_map(|key| payload.get(key))
            .find(|value| !value.is_null())
        {
            if let Some(detail) = detail.as_str() {
                return detail.to_owned();
            }
            return serde_json::to_string(detail).unwrap_or_else(|_| text.to_owned());
        }
    }
    text.to_owned()
}

async fn handle_response(response: reqwest::Response) -> Result<Value, MemoryApiError> {
    let status = response.status();
    if status.as_u16() >= 400 {
        let text = response.text().await.unwrap_or_default();
        return Err(MemoryApiError::Api {
            status,
            detail: response_error_detail(status, &text),
        });
    }
    if status == StatusCode::NO_CONTENT || status == StatusCode::RESET_CONTENT {
        return Ok(Value::Null);
    }
    let text = response
        .text()
        .await
        .map_err(|error| MemoryApiError::Transport(error.to_string()))?;
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text).map_err(|error| MemoryApiError::InvalidResponse(error.to_string()))
}

/// Async client for session memory, mounted directly on the agents API base.
#[derive(Clone)]
pub struct MemoryApiClient {
    api_base: Url,
    api_key: SecretString,
    http: reqwest::Client,
}

impl MemoryApiClient {
    pub fn new(api_base: Url, api_key: impl Into<SecretString>) -> Result<Self, MemoryApiError> {
        Self::with_timeout(api_base, api_key, DEFAULT_TIMEOUT)
    }

    pub fn with_timeout(
        api_base: Url,
        api_key: impl Into<SecretString>,
        timeout: Duration,
    ) -> Result<Self, MemoryApiError> {
        if !matches!(api_base.scheme(), "http" | "https") || api_base.cannot_be_a_base() {
            return Err(MemoryApiError::InvalidBaseUrl);
        }
        let api_key = api_key.into();
        if api_key.expose_secret().is_empty() {
            return Err(MemoryApiError::MissingApiKey);
        }
        let http = reqwest::Client::builder()
            .timeout(timeout)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| MemoryApiError::Transport(error.to_string()))?;
        Ok(Self {
            api_base,
            api_key,
            http,
        })
    }

    /// Build a client from an agents API base URL. Unlike the `/routines` and
    /// `/workspaces` mounts, memory routes hang directly off the agents
    /// base, so no path derivation is needed.
    pub fn from_agents_api_base(
        agents_api_base: Option<&str>,
        api_key: impl Into<SecretString>,
    ) -> Result<Self, MemoryApiError> {
        let api_base = match agents_api_base
            .map(str::trim)
            .filter(|base| !base.is_empty())
        {
            Some(raw) => {
                let with_scheme = if raw.contains("://") {
                    raw.to_owned()
                } else {
                    format!("https://{raw}")
                };
                Url::parse(with_scheme.trim_end_matches('/'))
                    .map_err(|_| MemoryApiError::InvalidBaseUrl)?
            }
            None => crate::config::discover_agents_api_base()?,
        };
        Self::new(api_base, api_key)
    }

    pub fn base_url(&self) -> &Url {
        &self.api_base
    }

    fn endpoint(&self, path: &str) -> String {
        format!("{}{path}", self.api_base.as_str().trim_end_matches('/'))
    }

    async fn request(&self, path: &str, query: &[(&str, &str)]) -> Result<Value, MemoryApiError> {
        let response = self
            .http
            .request(Method::GET, self.endpoint(path))
            .bearer_auth(self.api_key.expose_secret())
            .query(query)
            .send()
            .await
            .map_err(|error| MemoryApiError::Transport(error.to_string()))?;
        handle_response(response).await
    }

    /// Best-first page over indexed session-memory chunks. Feed
    /// [`MemorySearchPage::next_cursor`] back through
    /// [`MemorySearchOptions::cursor`] to continue.
    pub async fn search(
        &self,
        q: &str,
        options: &MemorySearchOptions,
    ) -> Result<MemorySearchPage, MemoryApiError> {
        let limit = options.limit.map(|limit| limit.to_string());
        let mut query = vec![("q", q)];
        if let Some(session_id) = options.session_id.as_deref() {
            query.push(("session_id", session_id));
        }
        if let Some(agent_id) = options.agent_id.as_deref() {
            query.push(("agent_id", agent_id));
        }
        if let Some(cursor) = options
            .cursor
            .as_deref()
            .filter(|cursor| !cursor.is_empty())
        {
            query.push(("cursor", cursor));
        }
        if let Some(limit) = limit.as_deref() {
            query.push(("limit", limit));
        }
        let data = self.request("/memory/search", &query).await?;
        MemorySearchPage::from_value(data)
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::{Matcher, Server};
    use serde_json::json;

    fn client(server: &Server) -> MemoryApiClient {
        MemoryApiClient::new(Url::parse(&server.url()).unwrap(), "key").unwrap()
    }

    fn hit_json() -> Value {
        json!({
            "id": "11111111-2222-3333-4444-555555555555",
            "session_id": "66666666-7777-8888-9999-000000000000",
            "seq_start": 1,
            "seq_end": 40,
            "text": "user: ship notes?\nassistant: drafted",
            "score": 0.87,
            "title": "Release notes session",
            "summary_text": "Drafted the release notes outline.",
            "summary_keywords": ["release", "notes"]
        })
    }

    #[tokio::test]
    async fn sends_query_only_by_default_and_parses_envelope() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("GET", "/memory/search")
            .match_query(Matcher::Exact("q=release+%26+notes%3F".into()))
            .match_header("authorization", "Bearer key")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "items": [hit_json()],
                    "next_cursor": "opaque-cursor-1",
                    "has_more": true
                })
                .to_string(),
            )
            .expect(1)
            .create_async()
            .await;
        let page = client(&server)
            .search("release & notes?", &MemorySearchOptions::default())
            .await
            .unwrap();
        assert_eq!(page.next_cursor.as_deref(), Some("opaque-cursor-1"));
        assert!(page.has_more);
        let hit = &page.items[0];
        assert_eq!(hit.id, "11111111-2222-3333-4444-555555555555");
        assert_eq!(hit.session_id, "66666666-7777-8888-9999-000000000000");
        assert_eq!(hit.seq_start, 1);
        assert_eq!(hit.seq_end, 40);
        assert_eq!(hit.score, 0.87);
        assert_eq!(hit.title.as_deref(), Some("Release notes session"));
        assert_eq!(
            hit.summary_text.as_deref(),
            Some("Drafted the release notes outline.")
        );
        assert_eq!(hit.summary_keywords, ["release", "notes"]);
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn serializes_session_agent_cursor_and_limit_filters() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("GET", "/memory/search")
            .match_query(Matcher::Exact(
                "q=notes&session_id=66666666-7777-8888-9999-000000000000&agent_id=aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee&cursor=opaque-cursor-1&limit=25".into(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({ "items": [], "next_cursor": null, "has_more": false }).to_string())
            .expect(1)
            .create_async()
            .await;
        let page = client(&server)
            .search(
                "notes",
                &MemorySearchOptions {
                    session_id: Some("66666666-7777-8888-9999-000000000000".to_owned()),
                    agent_id: Some("aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee".to_owned()),
                    cursor: Some("opaque-cursor-1".to_owned()),
                    limit: Some(25),
                },
            )
            .await
            .unwrap();
        assert!(page.items.is_empty());
        assert_eq!(page.next_cursor, None);
        assert!(!page.has_more);
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn tolerates_pre_envelope_flat_and_null_shapes() {
        // {items: [...]}, no pagination keys, legacy hits without the session
        // join fields: a single terminal page.
        let mut server = Server::new_async().await;
        let mock = server
            .mock("GET", "/memory/search")
            .match_query(Matcher::Exact("q=legacy".into()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "items": [{
                        "id": "11111111-2222-3333-4444-555555555555",
                        "session_id": "66666666-7777-8888-9999-000000000000",
                        "seq_start": 5,
                        "seq_end": 9,
                        "text": "plain legacy chunk",
                        "score": 0.5
                    }, {
                        "id": "22222222-3333-4444-5555-666666666666",
                        "session_id": "66666666-7777-8888-9999-000000000000",
                        "seq_start": 10,
                        "seq_end": 14,
                        "text": "null join fields",
                        "score": 0.4,
                        "title": null,
                        "summary_text": null,
                        "summary_keywords": null
                    }]
                })
                .to_string(),
            )
            .expect(1)
            .create_async()
            .await;
        let page = client(&server)
            .search("legacy", &MemorySearchOptions::default())
            .await
            .unwrap();
        assert_eq!(page.items.len(), 2);
        assert_eq!(page.next_cursor, None);
        assert!(!page.has_more);
        for hit in &page.items {
            assert_eq!(hit.title, None);
            assert_eq!(hit.summary_text, None);
            assert!(hit.summary_keywords.is_empty());
        }
        assert_eq!(page.items[1].text, "null join fields");
        mock.assert_async().await;

        // Bare array: also a single terminal page.
        let mut server = Server::new_async().await;
        let mock = server
            .mock("GET", "/memory/search")
            .match_query(Matcher::Exact("q=legacy".into()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!([hit_json()]).to_string())
            .expect(1)
            .create_async()
            .await;
        let page = client(&server)
            .search("legacy", &MemorySearchOptions::default())
            .await
            .unwrap();
        assert_eq!(page.items.len(), 1);
        assert_eq!(page.next_cursor, None);
        assert!(!page.has_more);
        assert_eq!(page.items[0].summary_keywords, ["release", "notes"]);
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn surfaces_api_error_detail() {
        let mut server = Server::new_async().await;
        server
            .mock("GET", "/memory/search")
            .match_query(Matcher::Exact("q=offline".into()))
            .with_status(503)
            .with_header("content-type", "application/json")
            .with_body(json!({ "detail": "Session memory worker disabled" }).to_string())
            .expect(1)
            .create_async()
            .await;
        let error = client(&server)
            .search("offline", &MemorySearchOptions::default())
            .await
            .unwrap_err();
        match error {
            MemoryApiError::Api { status, detail } => {
                assert_eq!(status, StatusCode::SERVICE_UNAVAILABLE);
                assert_eq!(detail, "Session memory worker disabled");
            }
            other => panic!("{other:?}"),
        }
    }
}
