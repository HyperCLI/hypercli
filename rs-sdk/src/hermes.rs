//! Client and launch contract for Hermes Agent's stable HTTP/SSE API server.
//!
//! OpenAI-compatible chat and Responses schemas deliberately stay out of this
//! crate. Use [`HermesApiClient::openai_base_url`] and
//! [`HermesApiClient::openai_api_key`] with the official OpenAI client, and use
//! this module for Hermes-native health, session, and run resources.

use std::collections::BTreeMap;
use std::pin::Pin;
use std::task::{Context, Poll};

use futures_util::Stream;
use reqwest::{Method, StatusCode};
use secrecy::{ExposeSecret, SecretString};
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;
use url::Url;
use uuid::Uuid;

use crate::{CreateDeploymentRequest, ManagedRuntime, RouteConfig, StartDeploymentRequest};

pub const HERMES_AGENT_IMAGE: &str = "ghcr.io/hypercli/hypercli-hermes-agent:latest";
pub const HERMES_API_PORT: u16 = 8642;
const HERMES_ROUTE: &str = "hermes";

/// Minimal managed launch defaults for the HyperCLI Hermes image.
///
/// `API_SERVER_KEY` authenticates clients to Hermes and is intentionally
/// distinct from the backend-injected `HYPER_AGENTS_API_KEY` used for model
/// inference. The latter must not be supplied through this helper.
pub struct HermesLaunchConfig {
    api_server_key: SecretString,
    pub image: String,
    pub route_auth: bool,
    pub route_prefix: String,
}

impl HermesLaunchConfig {
    pub fn new(api_server_key: impl Into<SecretString>) -> Self {
        Self {
            api_server_key: api_server_key.into(),
            image: HERMES_AGENT_IMAGE.to_owned(),
            route_auth: false,
            route_prefix: String::new(),
        }
    }

    /// Generate a 32-byte random gateway credential without reading user or
    /// process configuration.
    pub fn generated() -> Self {
        Self::new(format!(
            "{}{}",
            Uuid::new_v4().simple(),
            Uuid::new_v4().simple()
        ))
    }

    pub fn api_server_key(&self) -> &SecretString {
        &self.api_server_key
    }

    pub fn apply_to_create(&self, request: &mut CreateDeploymentRequest) {
        request.runtime = ManagedRuntime::HermesAgent;
        self.apply(
            &mut request.image,
            &mut request.env,
            &mut request.routes,
            &mut request.sync_root,
            &mut request.sync_enabled,
            &mut request.sync_uid,
            &mut request.sync_gid,
        );
    }

    pub fn apply_to_start(&self, request: &mut StartDeploymentRequest) {
        self.apply(
            &mut request.image,
            &mut request.env,
            &mut request.routes,
            &mut request.sync_root,
            &mut request.sync_enabled,
            &mut request.sync_uid,
            &mut request.sync_gid,
        );
    }

    #[allow(clippy::too_many_arguments)]
    fn apply(
        &self,
        image: &mut Option<String>,
        env: &mut BTreeMap<String, String>,
        routes: &mut BTreeMap<String, RouteConfig>,
        sync_root: &mut Option<String>,
        sync_enabled: &mut Option<bool>,
        sync_uid: &mut Option<u32>,
        sync_gid: &mut Option<u32>,
    ) {
        image.get_or_insert_with(|| self.image.clone());
        env.insert("API_SERVER_ENABLED".to_owned(), "true".to_owned());
        env.insert("API_SERVER_HOST".to_owned(), "0.0.0.0".to_owned());
        env.insert(
            "API_SERVER_KEY".to_owned(),
            self.api_server_key.expose_secret().to_owned(),
        );
        // Never carry the OpenClaw gateway credential into a Hermes pod.
        env.remove("OPENCLAW_GATEWAY_TOKEN");
        routes
            .entry(HERMES_ROUTE.to_owned())
            .or_insert(RouteConfig {
                port: HERMES_API_PORT,
                auth: self.route_auth,
                prefix: Some(self.route_prefix.clone()),
            });
        sync_root.get_or_insert_with(|| "/opt/data".to_owned());
        sync_enabled.get_or_insert(true);
        sync_uid.get_or_insert(10_000);
        sync_gid.get_or_insert(10_000);
    }
}

#[derive(Clone)]
pub struct HermesApiClient {
    base_url: Url,
    api_server_key: SecretString,
    http: reqwest::Client,
}

impl HermesApiClient {
    pub fn new(
        base_url: Url,
        api_server_key: impl Into<SecretString>,
    ) -> Result<Self, HermesApiError> {
        if !matches!(base_url.scheme(), "http" | "https") || base_url.cannot_be_a_base() {
            return Err(HermesApiError::InvalidBaseUrl);
        }
        Ok(Self {
            base_url,
            api_server_key: api_server_key.into(),
            http: reqwest::Client::builder()
                .timeout(std::time::Duration::from_secs(30))
                .build()
                .map_err(|error| HermesApiError::Transport(error.to_string()))?,
        })
    }

    pub fn base_url(&self) -> &Url {
        &self.base_url
    }

    /// Base URL for an official OpenAI client (ends in `/v1`).
    pub fn openai_base_url(&self) -> Url {
        self.endpoint(&["v1"])
    }

    /// API key for an official OpenAI client. This is the inbound Hermes
    /// API-server key, not the model-provider credential injected into the pod.
    pub fn openai_api_key(&self) -> &SecretString {
        &self.api_server_key
    }

    pub async fn health(&self) -> Result<HermesHealth, HermesApiError> {
        self.json(Method::GET, &["health"], Option::<&()>::None, &[])
            .await
    }

    pub async fn detailed_health(&self) -> Result<HermesDetailedHealth, HermesApiError> {
        self.json(
            Method::GET,
            &["health", "detailed"],
            Option::<&()>::None,
            &[],
        )
        .await
    }

    pub async fn capabilities(&self) -> Result<HermesCapabilities, HermesApiError> {
        self.json(
            Method::GET,
            &["v1", "capabilities"],
            Option::<&()>::None,
            &[],
        )
        .await
    }

    pub async fn models(&self) -> Result<HermesModelList, HermesApiError> {
        self.json(Method::GET, &["v1", "models"], Option::<&()>::None, &[])
            .await
    }

    pub async fn sessions(
        &self,
        limit: Option<u32>,
        offset: Option<u32>,
    ) -> Result<HermesSessionList, HermesApiError> {
        let mut query = Vec::new();
        let limit_s = limit.map(|value| value.to_string());
        let offset_s = offset.map(|value| value.to_string());
        if let Some(value) = limit_s.as_deref() {
            query.push(("limit", value));
        }
        if let Some(value) = offset_s.as_deref() {
            query.push(("offset", value));
        }
        self.json(
            Method::GET,
            &["api", "sessions"],
            Option::<&()>::None,
            &query,
        )
        .await
    }

    pub async fn create_session(
        &self,
        request: &HermesSessionCreateRequest,
    ) -> Result<HermesSession, HermesApiError> {
        let response: SessionEnvelope = self
            .json(Method::POST, &["api", "sessions"], Some(request), &[])
            .await?;
        Ok(response.session)
    }

    pub async fn session(&self, session_id: &str) -> Result<HermesSession, HermesApiError> {
        let response: SessionEnvelope = self
            .json(
                Method::GET,
                &["api", "sessions", session_id],
                Option::<&()>::None,
                &[],
            )
            .await?;
        Ok(response.session)
    }

    pub async fn patch_session(
        &self,
        session_id: &str,
        request: &HermesSessionPatchRequest,
    ) -> Result<HermesSession, HermesApiError> {
        let response: SessionEnvelope = self
            .json(
                Method::PATCH,
                &["api", "sessions", session_id],
                Some(request),
                &[],
            )
            .await?;
        Ok(response.session)
    }

    pub async fn delete_session(
        &self,
        session_id: &str,
    ) -> Result<HermesDeletedSession, HermesApiError> {
        self.json(
            Method::DELETE,
            &["api", "sessions", session_id],
            Option::<&()>::None,
            &[],
        )
        .await
    }

    pub async fn session_messages(
        &self,
        session_id: &str,
    ) -> Result<HermesMessageList, HermesApiError> {
        self.json(
            Method::GET,
            &["api", "sessions", session_id, "messages"],
            Option::<&()>::None,
            &[],
        )
        .await
    }

    pub async fn fork_session(
        &self,
        session_id: &str,
        request: &HermesSessionForkRequest,
    ) -> Result<HermesSession, HermesApiError> {
        let response: SessionEnvelope = self
            .json(
                Method::POST,
                &["api", "sessions", session_id, "fork"],
                Some(request),
                &[],
            )
            .await?;
        Ok(response.session)
    }

    pub async fn session_chat(
        &self,
        session_id: &str,
        request: &HermesChatRequest,
    ) -> Result<HermesChatCompletion, HermesApiError> {
        self.json(
            Method::POST,
            &["api", "sessions", session_id, "chat"],
            Some(request),
            &[],
        )
        .await
    }

    pub async fn session_chat_stream(
        &self,
        session_id: &str,
        request: &HermesChatRequest,
    ) -> Result<HermesEventStream, HermesApiError> {
        self.sse(
            Method::POST,
            &["api", "sessions", session_id, "chat", "stream"],
            Some(request),
        )
        .await
    }

    pub async fn lock_session_model(
        &self,
        session_id: &str,
        request: &HermesModelLockRequest,
    ) -> Result<HermesModelLock, HermesApiError> {
        self.json(
            Method::POST,
            &["api", "sessions", session_id, "model"],
            Some(request),
            &[],
        )
        .await
    }

    pub async fn create_run(
        &self,
        request: &HermesRunRequest,
    ) -> Result<HermesRunCreated, HermesApiError> {
        self.json(Method::POST, &["v1", "runs"], Some(request), &[])
            .await
    }

    pub async fn run(&self, run_id: &str) -> Result<HermesRun, HermesApiError> {
        self.json(
            Method::GET,
            &["v1", "runs", run_id],
            Option::<&()>::None,
            &[],
        )
        .await
    }

    pub async fn run_events(&self, run_id: &str) -> Result<HermesEventStream, HermesApiError> {
        self.sse(
            Method::GET,
            &["v1", "runs", run_id, "events"],
            Option::<&()>::None,
        )
        .await
    }

    pub async fn approve_run(
        &self,
        run_id: &str,
        request: &HermesRunApprovalRequest,
    ) -> Result<HermesRunApproval, HermesApiError> {
        self.json(
            Method::POST,
            &["v1", "runs", run_id, "approval"],
            Some(request),
            &[],
        )
        .await
    }

    pub async fn stop_run(&self, run_id: &str) -> Result<HermesRun, HermesApiError> {
        self.json(
            Method::POST,
            &["v1", "runs", run_id, "stop"],
            Some(&Value::Object(Default::default())),
            &[],
        )
        .await
    }

    fn endpoint(&self, segments: &[&str]) -> Url {
        let mut url = self.base_url.clone();
        {
            let mut path = url.path_segments_mut().expect("validated hierarchical URL");
            path.pop_if_empty();
            for segment in segments {
                path.push(segment);
            }
        }
        url
    }

    fn request(&self, method: Method, segments: &[&str]) -> reqwest::RequestBuilder {
        self.http
            .request(method, self.endpoint(segments))
            .bearer_auth(self.api_server_key.expose_secret())
    }

    async fn json<T, B>(
        &self,
        method: Method,
        segments: &[&str],
        body: Option<&B>,
        query: &[(&str, &str)],
    ) -> Result<T, HermesApiError>
    where
        T: DeserializeOwned,
        B: Serialize + ?Sized,
    {
        let mut request = self.request(method, segments).query(query);
        if let Some(body) = body {
            request = request.json(body);
        }
        decode_response(request.send().await.map_err(HermesApiError::from)?).await
    }

    async fn sse<B: Serialize + ?Sized>(
        &self,
        method: Method,
        segments: &[&str],
        body: Option<&B>,
    ) -> Result<HermesEventStream, HermesApiError> {
        let mut request = self
            .request(method, segments)
            .header(reqwest::header::ACCEPT, "text/event-stream");
        if let Some(body) = body {
            request = request.json(body);
        }
        let response = request.send().await.map_err(HermesApiError::from)?;
        if !response.status().is_success() {
            return Err(decode_error(response).await);
        }
        Ok(HermesEventStream::new(response))
    }
}

#[derive(Clone, Debug, Deserialize, Eq, PartialEq)]
pub struct HermesOpenAiError {
    pub message: String,
    #[serde(rename = "type", default)]
    pub error_type: Option<String>,
    #[serde(default)]
    pub param: Option<Value>,
    #[serde(default)]
    pub code: Option<Value>,
}

#[derive(Debug, Error)]
pub enum HermesApiError {
    #[error("Hermes base URL must be an http(s) hierarchical URL")]
    InvalidBaseUrl,
    #[error("Hermes request could not be sent: {0}")]
    Transport(String),
    #[error("Hermes returned HTTP {status}: {error}", error = .error.message)]
    Api {
        status: StatusCode,
        error: HermesOpenAiError,
    },
    #[error("Hermes returned an invalid response: {0}")]
    InvalidResponse(String),
}

impl From<reqwest::Error> for HermesApiError {
    fn from(error: reqwest::Error) -> Self {
        Self::Transport(error.to_string())
    }
}

async fn decode_response<T: DeserializeOwned>(
    response: reqwest::Response,
) -> Result<T, HermesApiError> {
    if !response.status().is_success() {
        return Err(decode_error(response).await);
    }
    response
        .json()
        .await
        .map_err(|error| HermesApiError::InvalidResponse(error.to_string()))
}

async fn decode_error(response: reqwest::Response) -> HermesApiError {
    let status = response.status();
    let body = response.bytes().await.unwrap_or_default();
    #[derive(Deserialize)]
    struct Envelope {
        error: HermesOpenAiError,
    }
    let error = serde_json::from_slice::<Envelope>(&body)
        .map(|value| value.error)
        .unwrap_or_else(|_| HermesOpenAiError {
            message: String::from_utf8_lossy(&body)
                .trim()
                .to_owned()
                .if_empty_then(status.canonical_reason().unwrap_or("request failed")),
            error_type: None,
            param: None,
            code: None,
        });
    HermesApiError::Api { status, error }
}

trait IfEmpty {
    fn if_empty_then(self, fallback: &str) -> String;
}
impl IfEmpty for String {
    fn if_empty_then(self, fallback: &str) -> String {
        if self.is_empty() {
            fallback.to_owned()
        } else {
            self
        }
    }
}

pub struct HermesEventStream {
    inner: Pin<Box<dyn Stream<Item = Result<HermesSseEvent, HermesApiError>> + Send>>,
}

impl HermesEventStream {
    fn new(response: reqwest::Response) -> Self {
        let state = (response, Vec::<u8>::new(), false);
        let inner = futures_util::stream::unfold(
            state,
            |(mut response, mut buffer, mut finished)| async move {
                loop {
                    if let Some((frame, consumed)) = take_sse_frame(&buffer) {
                        let frame = frame.to_vec();
                        buffer.drain(..consumed);
                        if let Some(event) = parse_sse_frame(&frame) {
                            return Some((event, (response, buffer, finished)));
                        }
                        continue;
                    }
                    if finished {
                        if buffer.is_empty() {
                            return None;
                        }
                        let frame = std::mem::take(&mut buffer);
                        return parse_sse_frame(&frame)
                            .map(|event| (event, (response, buffer, finished)));
                    }
                    match response.chunk().await {
                        Ok(Some(bytes)) => buffer.extend_from_slice(&bytes),
                        Err(error) => {
                            return Some((
                                Err(HermesApiError::Transport(error.to_string())),
                                (response, buffer, true),
                            ))
                        }
                        Ok(None) => finished = true,
                    }
                }
            },
        );
        Self {
            inner: Box::pin(inner),
        }
    }
}

impl Stream for HermesEventStream {
    type Item = Result<HermesSseEvent, HermesApiError>;
    fn poll_next(mut self: Pin<&mut Self>, cx: &mut Context<'_>) -> Poll<Option<Self::Item>> {
        self.inner.as_mut().poll_next(cx)
    }
}

#[derive(Clone, Debug, PartialEq)]
pub struct HermesSseEvent {
    pub event: Option<String>,
    pub data: Value,
}

fn take_sse_frame(buffer: &[u8]) -> Option<(&[u8], usize)> {
    for (needle, width) in [(&b"\r\n\r\n"[..], 4), (&b"\n\n"[..], 2)] {
        if let Some(index) = buffer.windows(needle.len()).position(|part| part == needle) {
            return Some((&buffer[..index], index + width));
        }
    }
    None
}

fn parse_sse_frame(frame: &[u8]) -> Option<Result<HermesSseEvent, HermesApiError>> {
    let text = String::from_utf8_lossy(frame);
    let mut event = None;
    let mut data = Vec::new();
    for line in text.lines() {
        if line.starts_with(':') {
            continue;
        }
        if let Some(value) = line.strip_prefix("event:") {
            event = Some(value.trim_start().to_owned());
        }
        if let Some(value) = line.strip_prefix("data:") {
            data.push(value.trim_start());
        }
    }
    if data.is_empty() {
        return None;
    }
    let raw = data.join("\n");
    let value = serde_json::from_str(&raw).unwrap_or(Value::String(raw));
    Some(Ok(HermesSseEvent { event, data: value }))
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct HermesHealth {
    pub status: String,
    pub platform: String,
    pub version: String,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct HermesDetailedHealth {
    pub status: String,
    pub platform: String,
    pub version: String,
    #[serde(default)]
    pub readiness: Value,
    #[serde(default)]
    pub gateway_state: Option<String>,
    #[serde(default)]
    pub gateway_busy: bool,
    #[serde(default)]
    pub gateway_drainable: bool,
    #[serde(default)]
    pub pid: Option<u32>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct HermesCapabilities {
    pub object: String,
    pub platform: String,
    pub model: String,
    #[serde(default)]
    pub auth: Value,
    #[serde(default)]
    pub runtime: Value,
    #[serde(default)]
    pub features: BTreeMap<String, Value>,
    #[serde(default)]
    pub endpoints: BTreeMap<String, Value>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct HermesModel {
    pub id: String,
    pub object: String,
    #[serde(default)]
    pub created: i64,
    #[serde(default)]
    pub owned_by: String,
    #[serde(default)]
    pub root: Option<String>,
    #[serde(default)]
    pub parent: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct HermesModelList {
    pub object: String,
    #[serde(default)]
    pub data: Vec<HermesModel>,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct HermesSession {
    pub id: String,
    #[serde(default)]
    pub source: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub title: Option<String>,
    #[serde(default)]
    pub started_at: Option<f64>,
    #[serde(default)]
    pub ended_at: Option<f64>,
    #[serde(default)]
    pub end_reason: Option<String>,
    #[serde(default)]
    pub message_count: Option<u64>,
    #[serde(default)]
    pub parent_session_id: Option<String>,
    #[serde(default)]
    pub has_system_prompt: bool,
    #[serde(default)]
    pub has_model_config: bool,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}
#[derive(Deserialize)]
struct SessionEnvelope {
    session: HermesSession,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct HermesSessionList {
    pub object: String,
    #[serde(default)]
    pub data: Vec<HermesSession>,
    pub limit: u32,
    pub offset: u32,
    pub has_more: bool,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct HermesSessionCreateRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub system_prompt: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_options: Option<Value>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub require_model_lock: bool,
}
#[derive(Clone, Debug, Default, Serialize)]
pub struct HermesSessionPatchRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub end_reason: Option<String>,
}
#[derive(Clone, Debug, Default, Serialize)]
pub struct HermesSessionForkRequest {
    #[serde(skip_serializing_if = "Option::is_none")]
    pub id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub title: Option<String>,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct HermesDeletedSession {
    pub object: String,
    pub id: String,
    pub deleted: bool,
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct HermesMessage {
    #[serde(default)]
    pub id: Value,
    pub session_id: String,
    pub role: String,
    #[serde(default)]
    pub content: Value,
    #[serde(default)]
    pub timestamp: Option<f64>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct HermesMessageList {
    pub object: String,
    pub session_id: String,
    #[serde(default)]
    pub data: Vec<HermesMessage>,
}

#[derive(Clone, Debug, Serialize)]
pub struct HermesChatRequest {
    pub message: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_options: Option<Value>,
    #[serde(default, skip_serializing_if = "std::ops::Not::not")]
    pub require_model_lock: bool,
}
impl HermesChatRequest {
    pub fn text(message: impl Into<String>) -> Self {
        Self {
            message: Value::String(message.into()),
            instructions: None,
            model: None,
            provider: None,
            model_options: None,
            require_model_lock: false,
        }
    }
}

#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct HermesChatCompletion {
    pub object: String,
    pub session_id: String,
    pub message: Value,
    #[serde(default)]
    pub usage: Value,
    #[serde(default)]
    pub runtime: Value,
}

#[derive(Clone, Debug, Default, Serialize)]
pub struct HermesModelLockRequest {
    pub provider: String,
    pub model: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model_options: Option<Value>,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct HermesModelLock {
    pub object: String,
    pub session_id: String,
    #[serde(default)]
    pub runtime: Value,
}

#[derive(Clone, Debug, Serialize)]
pub struct HermesRunRequest {
    pub input: Value,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub instructions: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub session_id: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub model: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub provider: Option<String>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub previous_response_id: Option<String>,
    #[serde(default, skip_serializing_if = "Vec::is_empty")]
    pub conversation_history: Vec<Value>,
}
impl HermesRunRequest {
    pub fn text(input: impl Into<String>) -> Self {
        Self {
            input: Value::String(input.into()),
            instructions: None,
            session_id: None,
            model: None,
            provider: None,
            previous_response_id: None,
            conversation_history: Vec::new(),
        }
    }
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct HermesRunCreated {
    pub run_id: String,
    pub status: String,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct HermesRun {
    pub run_id: String,
    pub status: String,
    #[serde(default)]
    pub object: Option<String>,
    #[serde(default)]
    pub created_at: Option<f64>,
    #[serde(default)]
    pub updated_at: Option<f64>,
    #[serde(default)]
    pub output: Option<Value>,
    #[serde(default)]
    pub usage: Option<Value>,
    #[serde(default)]
    pub error: Option<Value>,
    #[serde(default)]
    pub last_event: Option<String>,
    #[serde(flatten)]
    pub extra: BTreeMap<String, Value>,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq, Serialize)]
#[serde(rename_all = "lowercase")]
pub enum HermesRunApprovalChoice {
    Once,
    Session,
    Always,
    Deny,
}
#[derive(Clone, Debug, Serialize)]
pub struct HermesRunApprovalRequest {
    pub choice: HermesRunApprovalChoice,
    #[serde(default, skip_serializing_if = "std::ops::Not::not", rename = "all")]
    pub resolve_all: bool,
}
#[derive(Clone, Debug, Deserialize, PartialEq)]
pub struct HermesRunApproval {
    pub object: String,
    pub run_id: String,
    pub choice: String,
    pub resolved: u32,
}

#[cfg(test)]
mod tests {
    use super::*;
    use futures_util::StreamExt;
    use mockito::Matcher;

    #[test]
    fn managed_runtime_and_launch_contract_are_hermes_specific() {
        assert_eq!(
            serde_json::to_value(ManagedRuntime::HermesAgent).unwrap(),
            "hermes-agent"
        );
        let launch = HermesLaunchConfig::new("gateway-secret-only");
        let mut request = CreateDeploymentRequest::new(ManagedRuntime::Openclaw);
        request
            .env
            .insert("OPENCLAW_GATEWAY_TOKEN".into(), "wrong".into());
        launch.apply_to_create(&mut request);
        assert_eq!(request.runtime, ManagedRuntime::HermesAgent);
        assert_eq!(request.image.as_deref(), Some(HERMES_AGENT_IMAGE));
        assert_eq!(request.sync_root.as_deref(), Some("/opt/data"));
        assert_eq!(
            (request.sync_uid, request.sync_gid),
            (Some(10_000), Some(10_000))
        );
        assert_eq!(request.routes[HERMES_ROUTE].port, HERMES_API_PORT);
        assert_eq!(request.env["API_SERVER_KEY"], "gateway-secret-only");
        assert!(!request.env.contains_key("OPENCLAW_GATEWAY_TOKEN"));
        assert!(!request.env.contains_key("HYPER_AGENTS_API_KEY"));
    }

    #[tokio::test]
    async fn normalizes_openai_errors_and_encodes_resource_ids() {
        let mut server = mockito::Server::new_async().await;
        let mock = server.mock("GET", "/api/sessions/a%2Fb").match_header("authorization", "Bearer inbound-key").with_status(404).with_header("content-type", "application/json").with_body(r#"{"error":{"message":"gone","type":"invalid_request_error","code":"session_not_found"}}"#).create_async().await;
        let client =
            HermesApiClient::new(Url::parse(&server.url()).unwrap(), "inbound-key").unwrap();
        let error = client.session("a/b").await.unwrap_err();
        match error {
            HermesApiError::Api { status, error } => {
                assert_eq!(status, StatusCode::NOT_FOUND);
                assert_eq!(error.message, "gone");
                assert_eq!(error.code, Some(Value::String("session_not_found".into())));
            }
            other => panic!("{other:?}"),
        }
        mock.assert_async().await;
    }

    #[tokio::test]
    async fn streams_named_and_unknown_sse_events_without_schema_loss() {
        let mut server = mockito::Server::new_async().await;
        let mock = server
            .mock("GET", "/v1/runs/run_1/events")
            .match_header("accept", Matcher::Exact("text/event-stream".into()))
            .with_status(200)
            .with_header("content-type", "text/event-stream")
            .with_body("event: future.event\ndata: {\"new_field\":7}\n\ndata: [DONE]\n\n")
            .create_async()
            .await;
        let client = HermesApiClient::new(Url::parse(&server.url()).unwrap(), "key").unwrap();
        let mut events = client.run_events("run_1").await.unwrap();
        assert_eq!(
            events.next().await.unwrap().unwrap(),
            HermesSseEvent {
                event: Some("future.event".into()),
                data: serde_json::json!({"new_field": 7})
            }
        );
        assert_eq!(
            events.next().await.unwrap().unwrap().data,
            Value::String("[DONE]".into())
        );
        assert!(events.next().await.is_none());
        mock.assert_async().await;
    }
}
