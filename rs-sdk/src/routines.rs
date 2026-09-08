//! Scheduled agent routines: cron-driven prompts run by the platform.
//!
//! Mirrors the Python SDK's `RoutinesAPI` (sdk/hypercli/routines.py) and the
//! TypeScript SDK's `RoutinesAPI` (ts-sdk/src/routines.ts), including the
//! `/routines` host-root mount, snake_case wire payloads, and the
//! `HYPER_ROUTINES_API_BASE` environment override.

use std::time::Duration;

use reqwest::{Method, StatusCode};
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use url::Url;

use crate::DEFAULT_AGENTS_API_BASE;

const DEFAULT_TIMEOUT: Duration = Duration::from_secs(30);

/// Derive the routines API base URL from an agents API base URL.
///
/// Mirrors the Python SDK's `_derive_routines_base`: an explicit
/// `HYPER_ROUTINES_API_BASE` environment override wins, then the given
/// agents base, then the default agents base. A path ending in `/routines`
/// is kept; a trailing `/agents` segment is stripped; anything else gets
/// `/routines` appended.
pub fn derive_routines_api_base(agents_api_base: Option<&str>) -> Result<Url, RoutinesApiError> {
    let configured = std::env::var("HYPER_ROUTINES_API_BASE")
        .ok()
        .filter(|value| !value.trim().is_empty());
    derive_routines_api_base_from(configured.as_deref(), agents_api_base)
}

fn derive_routines_api_base_from(
    configured: Option<&str>,
    agents_api_base: Option<&str>,
) -> Result<Url, RoutinesApiError> {
    let raw = configured
        .or(agents_api_base)
        .unwrap_or(DEFAULT_AGENTS_API_BASE)
        .trim_end_matches('/');
    let with_scheme = if raw.contains("://") {
        raw.to_owned()
    } else {
        format!("https://{raw}")
    };
    let mut url = Url::parse(&with_scheme).map_err(|_| RoutinesApiError::InvalidBaseUrl)?;
    if !matches!(url.scheme(), "http" | "https") || url.host_str().is_none() {
        return Err(RoutinesApiError::InvalidBaseUrl);
    }
    let path = url.path().trim_end_matches('/').to_owned();
    if !path.ends_with("/routines") {
        let stem = path.strip_suffix("/agents").unwrap_or(&path);
        url.set_path(&format!("{stem}/routines"));
    }
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

#[derive(Debug, Error)]
pub enum RoutinesApiError {
    #[error("API key required for routines")]
    MissingApiKey,
    #[error("routines base URL must be an http(s) hierarchical URL")]
    InvalidBaseUrl,
    #[error("routines request could not be sent: {0}")]
    Transport(String),
    #[error("routines returned HTTP {status}: {detail}")]
    Api { status: StatusCode, detail: String },
    #[error("routines returned an invalid response: {0}")]
    InvalidResponse(String),
}

impl RoutinesApiError {
    pub fn status(&self) -> Option<StatusCode> {
        match self {
            Self::Api { status, .. } => Some(*status),
            _ => None,
        }
    }
}

/// One scheduled routine. Timestamps stay on the wire as ISO 8601 strings;
/// `next_run_at` is `null` while a disabled routine has no upcoming run.
#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
pub struct Routine {
    #[serde(default)]
    pub id: String,
    #[serde(default)]
    pub user_id: String,
    #[serde(default)]
    pub agent_id: String,
    #[serde(default)]
    pub cron: String,
    #[serde(default)]
    pub prompt: String,
    #[serde(default = "default_true")]
    pub enabled: bool,
    #[serde(default)]
    pub next_run_at: Option<String>,
    #[serde(default)]
    pub created_at: Option<String>,
    #[serde(default)]
    pub updated_at: Option<String>,
}

#[derive(Clone, Debug, Serialize)]
pub struct RoutineCreate {
    pub agent_id: String,
    pub cron: String,
    pub prompt: String,
    pub enabled: bool,
}

impl RoutineCreate {
    /// Wire default is `enabled = true`, matching the Python and TypeScript
    /// SDKs.
    pub fn new(
        agent_id: impl Into<String>,
        cron: impl Into<String>,
        prompt: impl Into<String>,
    ) -> Self {
        Self {
            agent_id: agent_id.into(),
            cron: cron.into(),
            prompt: prompt.into(),
            enabled: true,
        }
    }
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct RoutinePatch {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub agent_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub cron: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub enabled: Option<bool>,
}

fn default_true() -> bool {
    true
}

/// Percent-encode a single path segment, matching the TypeScript SDK's
/// `encodeURIComponent`-based `encodeRef` (spaces encode as `%20`).
fn encode_ref(value: &str) -> String {
    url::form_urlencoded::byte_serialize(value.as_bytes())
        .collect::<String>()
        .replace('+', "%20")
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

async fn handle_response(response: reqwest::Response) -> Result<Value, RoutinesApiError> {
    let status = response.status();
    if status.as_u16() >= 400 {
        let text = response.text().await.unwrap_or_default();
        return Err(RoutinesApiError::Api {
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
        .map_err(|error| RoutinesApiError::Transport(error.to_string()))?;
    if text.trim().is_empty() {
        return Ok(Value::Null);
    }
    serde_json::from_str(&text)
        .map_err(|error| RoutinesApiError::InvalidResponse(error.to_string()))
}

/// Async client for the routines service mounted at `/routines`.
#[derive(Clone)]
pub struct RoutinesApiClient {
    api_base: Url,
    api_key: SecretString,
    http: reqwest::Client,
}

impl RoutinesApiClient {
    pub fn new(api_base: Url, api_key: impl Into<SecretString>) -> Result<Self, RoutinesApiError> {
        Self::with_timeout(api_base, api_key, DEFAULT_TIMEOUT)
    }

    pub fn with_timeout(
        api_base: Url,
        api_key: impl Into<SecretString>,
        timeout: Duration,
    ) -> Result<Self, RoutinesApiError> {
        if !matches!(api_base.scheme(), "http" | "https") || api_base.cannot_be_a_base() {
            return Err(RoutinesApiError::InvalidBaseUrl);
        }
        let api_key = api_key.into();
        if api_key.expose_secret().is_empty() {
            return Err(RoutinesApiError::MissingApiKey);
        }
        let http = reqwest::Client::builder()
            .timeout(timeout)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| RoutinesApiError::Transport(error.to_string()))?;
        Ok(Self {
            api_base,
            api_key,
            http,
        })
    }

    /// Build a client from an agents API base URL, honoring the
    /// `HYPER_ROUTINES_API_BASE` environment override.
    pub fn from_agents_api_base(
        agents_api_base: Option<&str>,
        api_key: impl Into<SecretString>,
    ) -> Result<Self, RoutinesApiError> {
        Self::new(derive_routines_api_base(agents_api_base)?, api_key)
    }

    pub fn base_url(&self) -> &Url {
        &self.api_base
    }

    fn endpoint(&self, path: &str) -> String {
        format!("{}{path}", self.api_base.as_str().trim_end_matches('/'))
    }

    async fn request<B>(
        &self,
        method: Method,
        path: &str,
        query: &[(&str, &str)],
        body: Option<&B>,
    ) -> Result<Value, RoutinesApiError>
    where
        B: Serialize + ?Sized,
    {
        let mut builder = self
            .http
            .request(method, self.endpoint(path))
            .bearer_auth(self.api_key.expose_secret())
            .query(query);
        if let Some(body) = body {
            builder = builder.json(body);
        }
        let response = builder
            .send()
            .await
            .map_err(|error| RoutinesApiError::Transport(error.to_string()))?;
        handle_response(response).await
    }

    fn decode<T: serde::de::DeserializeOwned>(data: Value) -> Result<T, RoutinesApiError> {
        serde_json::from_value(data)
            .map_err(|error| RoutinesApiError::InvalidResponse(error.to_string()))
    }

    pub async fn list(&self, agent_id: Option<&str>) -> Result<Vec<Routine>, RoutinesApiError> {
        let query: Vec<(&str, &str)> = agent_id
            .filter(|value| !value.is_empty())
            .map(|value| ("agent_id", value))
            .into_iter()
            .collect();
        let data = self
            .request(Method::GET, "", &query, Option::<&()>::None)
            .await?;
        match data {
            Value::Null => Ok(Vec::new()),
            Value::Array(_) => Self::decode(data),
            _ => Err(RoutinesApiError::InvalidResponse(
                "Routines response must be an array.".to_owned(),
            )),
        }
    }

    pub async fn get(&self, routine_id: &str) -> Result<Routine, RoutinesApiError> {
        let data = self
            .request(
                Method::GET,
                &format!("/{}", encode_ref(routine_id)),
                &[],
                Option::<&()>::None,
            )
            .await?;
        Self::decode(data)
    }

    pub async fn create(&self, request: &RoutineCreate) -> Result<Routine, RoutinesApiError> {
        let data = self.request(Method::POST, "", &[], Some(request)).await?;
        Self::decode(data)
    }

    pub async fn update(
        &self,
        routine_id: &str,
        patch: &RoutinePatch,
    ) -> Result<Routine, RoutinesApiError> {
        let data = self
            .request(
                Method::PATCH,
                &format!("/{}", encode_ref(routine_id)),
                &[],
                Some(patch),
            )
            .await?;
        Self::decode(data)
    }

    pub async fn delete(&self, routine_id: &str) -> Result<(), RoutinesApiError> {
        self.request(
            Method::DELETE,
            &format!("/{}", encode_ref(routine_id)),
            &[],
            Option::<&()>::None,
        )
        .await?;
        Ok(())
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::{Matcher, Server};
    use serde_json::json;

    fn client(server: &Server) -> RoutinesApiClient {
        RoutinesApiClient::new(Url::parse(&server.url()).unwrap(), "key").unwrap()
    }

    fn json_response(
        server: &mut Server,
        method: &str,
        path: &str,
        status: usize,
        body: Value,
    ) -> mockito::Mock {
        server
            .mock(method, path)
            .match_header("authorization", "Bearer key")
            .with_status(status)
            .with_header("content-type", "application/json")
            .with_body(body.to_string())
            .expect(1)
    }

    fn routine_json(id: &str) -> Value {
        json!({
            "id": id,
            "user_id": "user-1",
            "agent_id": "agent-1",
            "cron": "*/15 * * * *",
            "prompt": "Summarize open pull requests",
            "enabled": true,
            "next_run_at": "2026-09-08T12:15:00Z",
            "created_at": "2026-09-01T09:00:00Z",
            "updated_at": "2026-09-02T10:00:00Z"
        })
    }

    #[test]
    fn derives_routines_base_from_agents_base() {
        assert_eq!(
            derive_routines_api_base_from(None, Some("https://api.hypercli.com/agents"))
                .unwrap()
                .as_str(),
            "https://api.hypercli.com/routines"
        );
        assert_eq!(
            derive_routines_api_base_from(None, Some("https://example.com/routines"))
                .unwrap()
                .as_str(),
            "https://example.com/routines"
        );
        assert_eq!(
            derive_routines_api_base_from(Some("https://override.example.com/api"), None)
                .unwrap()
                .as_str(),
            "https://override.example.com/api/routines"
        );
        assert_eq!(
            derive_routines_api_base_from(None, None).unwrap().as_str(),
            "https://api.hypercli.com/routines"
        );
        assert_eq!(
            derive_routines_api_base_from(None, Some("api.hypercli.com/agents"))
                .unwrap()
                .as_str(),
            "https://api.hypercli.com/routines"
        );
    }

    #[test]
    fn create_defaults_to_enabled_and_patch_omits_unset_fields() {
        let create = RoutineCreate::new("agent-1", "0 * * * *", "ping");
        assert_eq!(
            serde_json::to_value(&create).unwrap(),
            json!({
                "agent_id": "agent-1",
                "cron": "0 * * * *",
                "prompt": "ping",
                "enabled": true
            })
        );

        let patch = RoutinePatch {
            prompt: Some("pong".to_owned()),
            ..RoutinePatch::default()
        };
        assert_eq!(
            serde_json::to_value(&patch).unwrap(),
            json!({ "prompt": "pong" })
        );
    }

    #[test]
    fn routine_decodes_snake_case_and_null_schedule() {
        let routine: Routine = serde_json::from_value(json!({
            "id": "routine-1",
            "user_id": "user-1",
            "agent_id": "agent-1",
            "cron": "*/15 * * * *",
            "prompt": "ping",
            "enabled": false,
            "next_run_at": null,
            "created_at": "2026-09-01T09:00:00Z",
            "updated_at": "2026-09-02T10:00:00Z"
        }))
        .unwrap();
        assert_eq!(routine.id, "routine-1");
        assert!(!routine.enabled);
        assert_eq!(routine.next_run_at, None);
        assert_eq!(routine.created_at.as_deref(), Some("2026-09-01T09:00:00Z"));
    }

    #[tokio::test]
    async fn creates_routines_with_bearer_auth() {
        let mut server = Server::new_async().await;
        let mock = server
            .mock("POST", "/")
            .match_header("authorization", "Bearer key")
            .match_body(Matcher::Json(json!({
                "agent_id": "agent-1",
                "cron": "*/15 * * * *",
                "prompt": "Summarize open pull requests",
                "enabled": true
            })))
            .with_status(201)
            .with_header("content-type", "application/json")
            .with_body(routine_json("routine-1").to_string())
            .expect(1)
            .create_async()
            .await;

        let routine = client(&server)
            .create(&RoutineCreate::new(
                "agent-1",
                "*/15 * * * *",
                "Summarize open pull requests",
            ))
            .await
            .unwrap();

        assert_eq!(routine.id, "routine-1");
        assert_eq!(routine.agent_id, "agent-1");
        assert!(routine.enabled);
        assert_eq!(routine.next_run_at.as_deref(), Some("2026-09-08T12:15:00Z"));
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn lists_routines_with_optional_agent_filter() {
        let mut server = Server::new_async().await;
        let all_mock = json_response(&mut server, "GET", "/", 200, json!([routine_json("r-1")]))
            .create_async()
            .await;
        let routines = client(&server).list(None).await.unwrap();
        assert_eq!(routines.len(), 1);
        assert_eq!(routines[0].id, "r-1");
        all_mock.assert_async().await;

        let mut server = Server::new_async().await;
        let filtered_mock = server
            .mock("GET", "/?agent_id=agent-1")
            .match_header("authorization", "Bearer key")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!([routine_json("r-2")]).to_string())
            .expect(1)
            .create_async()
            .await;
        let routines = client(&server).list(Some("agent-1")).await.unwrap();
        assert_eq!(routines.len(), 1);
        assert_eq!(routines[0].id, "r-2");
        filtered_mock.assert_async().await;
    }

    #[tokio::test]
    async fn gets_updates_and_deletes_routines_by_id() {
        let mut server = Server::new_async().await;
        let get_mock = json_response(
            &mut server,
            "GET",
            "/routine-1",
            200,
            routine_json("routine-1"),
        )
        .create_async()
        .await;
        let routine = client(&server).get("routine-1").await.unwrap();
        assert_eq!(routine.prompt, "Summarize open pull requests");
        get_mock.assert_async().await;

        let mut server = Server::new_async().await;
        let update_mock = server
            .mock("PATCH", "/routine-1")
            .match_header("authorization", "Bearer key")
            .match_body(Matcher::Json(json!({ "enabled": false })))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "id": "routine-1",
                    "user_id": "user-1",
                    "agent_id": "agent-1",
                    "cron": "*/15 * * * *",
                    "prompt": "Summarize open pull requests",
                    "enabled": false,
                    "next_run_at": null,
                    "created_at": "2026-09-01T09:00:00Z",
                    "updated_at": "2026-09-08T11:00:00Z"
                })
                .to_string(),
            )
            .expect(1)
            .create_async()
            .await;
        let routine = client(&server)
            .update(
                "routine-1",
                &RoutinePatch {
                    enabled: Some(false),
                    ..RoutinePatch::default()
                },
            )
            .await
            .unwrap();
        assert!(!routine.enabled);
        assert_eq!(routine.next_run_at, None);
        update_mock.assert_async().await;

        let mut server = Server::new_async().await;
        let delete_mock = server
            .mock("DELETE", "/routine-1")
            .match_header("authorization", "Bearer key")
            .with_status(204)
            .expect(1)
            .create_async()
            .await;
        client(&server).delete("routine-1").await.unwrap();
        delete_mock.assert_async().await;
    }

    #[tokio::test]
    async fn encodes_routine_ids_and_surfaces_api_errors() {
        let mut server = Server::new_async().await;
        let mock = json_response(
            &mut server,
            "GET",
            "/routine%20%231",
            200,
            routine_json("routine #1"),
        )
        .create_async()
        .await;
        let routine = client(&server).get("routine #1").await.unwrap();
        assert_eq!(routine.id, "routine #1");
        mock.assert_async().await;

        let mut server = Server::new_async().await;
        json_response(
            &mut server,
            "GET",
            "/missing",
            404,
            json!({ "detail": "routine not found" }),
        )
        .create_async()
        .await;
        let error = client(&server).get("missing").await.unwrap_err();
        assert_eq!(error.status(), Some(StatusCode::NOT_FOUND));
        assert!(error.to_string().contains("routine not found"));
    }
}
