use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant, SystemTime, UNIX_EPOCH};

use futures_util::{SinkExt, StreamExt};
use reqwest::blocking::{Client as HttpClient, RequestBuilder};
use reqwest::Client as AsyncHttpClient;
use reqwest::StatusCode;
use secrecy::ExposeSecret;
use serde::de::DeserializeOwned;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;
use tokio::net::TcpStream;
use tokio_tungstenite::{
    connect_async,
    tungstenite::Message,
    MaybeTlsStream, WebSocketStream,
};
use url::Url;

use crate::runtime_auth::{auth_status_command, RuntimeShellTokenResponse};
use crate::{
    AgentAccessIdentity, AgentCapacity, AgentDirectoryListing, AgentFileEntry,
    AgentLaunchValueMutation, ApiKey, AuthMe, ClientConfig, CompleteDeploymentLaunchConfig,
    CreateApiKeyRequest, CreateDeploymentRequest, DeleteDeploymentResponse, Deployment,
    DeploymentEnvironment, DeploymentEvent, DeploymentFileWriteResponse, DeploymentListFilters,
    DeploymentProfileImageResponse, DeploymentRoutes, DeploymentSecret, DeploymentSecretNames,
    ExecDeploymentRequest, ExecDeploymentResponse, HyperAgentCurrentPlan, HyperAgentEntitlement,
    HyperAgentEntitlementsSummary, HyperAgentPlan, NativeRuntime, RuntimeAuthError,
    JobLifecycleEvent, RuntimeAuthStatus, RuntimeLoginSession, RuntimeShellToken,
    SetDeploymentRouteRequest, SetDeploymentRoutesRequest, StartDeploymentRequest,
    UpdateDeploymentRequest,
};

type DeploymentEventSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// Consumer-side settling window before the first request to a newly issued
/// hostname.  The API commits the Cloudflare record and returns immediately;
/// callers avoid a transient NXDOMAIN by waiting locally instead of holding a
/// backend transaction open.
///
/// This is a fixed guess, not a readiness signal. Callers that are about to use
/// the agent's file API should follow it with
/// [`HyperCliClient::wait_deployment_file_api_ready`], which observes the API
/// actually serving instead of assuming a duration.
pub const DEFAULT_HOSTNAME_SETTLE_DELAY: Duration = Duration::from_secs(15);
const DEFAULT_DEPLOYMENT_STATE_POLL_INTERVAL: Duration = Duration::from_secs(5);

/// Tuning for [`HyperCliClient::wait_deployment_file_api_ready`].
#[derive(Clone, Copy, Debug, Eq, PartialEq)]
pub struct FileApiReadyOptions {
    /// Give up after this long.
    pub timeout: Duration,
    /// Successful listings required in a row before declaring the API ready.
    /// Values below 1 are treated as 1.
    pub consecutive: u32,
    /// Delay between attempts.
    pub poll_interval: Duration,
}

impl Default for FileApiReadyOptions {
    fn default() -> Self {
        Self {
            timeout: Duration::from_secs(90),
            consecutive: 2,
            poll_interval: Duration::from_secs(1),
        }
    }
}

#[derive(Deserialize)]
struct DeploymentEventTokenResponse {
    token: String,
    ws_url: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OperationToken {
    agent_id: String,
    jwt: String,
    expires_at: String,
    ws_url: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct FileToken {
    url: String,
    token: String,
    expires_at: String,
}

pub struct HyperCliClient {
    api_base: Url,
    api_key: secrecy::SecretString,
    http: HttpClient,
    async_http: AsyncHttpClient,
    trace_file: Option<PathBuf>,
}

#[derive(Debug, Error)]
pub enum HyperCliError {
    #[error("HyperCLI request could not be sent: {0}")]
    Transport(String),
    #[error("HyperCLI returned HTTP {0}")]
    Status(StatusCode),
    #[error("HyperCLI returned an invalid response: {0}")]
    InvalidResponse(String),
}

impl HyperCliError {
    pub fn status(&self) -> Option<StatusCode> {
        match self {
            Self::Status(status) => Some(*status),
            _ => None,
        }
    }
}

fn deployment_request_body<T: Serialize>(request: &T) -> Result<Value, HyperCliError> {
    let mut body = serde_json::to_value(request)
        .map_err(|error| HyperCliError::InvalidResponse(error.to_string()))?;
    let object = body.as_object_mut().ok_or_else(|| {
        HyperCliError::InvalidResponse("deployment request must serialize as an object".to_owned())
    })?;
    let launch = if object.contains_key("launch_config") {
        object
            .get_mut("launch_config")
            .and_then(Value::as_object_mut)
            .ok_or_else(|| {
                HyperCliError::InvalidResponse("launch_config must be an object".into())
            })?
    } else {
        object
    };
    let has_sync_include = launch.contains_key("sync_include");
    let has_sync_exclude = launch.contains_key("sync_exclude");
    if has_sync_include && has_sync_exclude {
        return Err(HyperCliError::InvalidResponse(
            "launch config cannot carry both sync_include and sync_exclude".into(),
        ));
    }
    if !has_sync_include && !has_sync_exclude {
        launch.insert("sync_exclude".to_owned(), Value::Array(Vec::new()));
    }
    if launch
        .get("sync_include")
        .and_then(Value::as_array)
        .is_some_and(Vec::is_empty)
    {
        return Err(HyperCliError::InvalidResponse(
            "sync_include must contain at least one path; omit it to sync all".into(),
        ));
    }
    if launch
        .get("sync_exclude")
        .and_then(Value::as_array)
        .is_some_and(|values| values.iter().any(|value| value == "*" || value == "**"))
    {
        return Err(HyperCliError::InvalidResponse(
            "sync_exclude cannot exclude the entire sync root; omit it to sync all".into(),
        ));
    }
    for field in ["sync_uid", "sync_gid"] {
        if launch
            .get(field)
            .and_then(Value::as_u64)
            .is_some_and(|value| value > 4_294_967_294)
        {
            return Err(HyperCliError::InvalidResponse(format!(
                "{field} must be at most 4294967294"
            )));
        }
    }
    Ok(body)
}

fn redacted_launch_trace(mut body: Value) -> Value {
    fn r(o: &mut serde_json::Map<String, Value>) {
        for k in ["secrets", "registry_auth"] {
            if o.contains_key(k) {
                o.insert(k.into(), json!("<omitted>"));
            }
        }
    }
    if let Some(o) = body.as_object_mut() {
        r(o);
        if let Some(l) = o.get_mut("launch_config").and_then(Value::as_object_mut) {
            r(l)
        }
    }
    body
}

fn permanent_deployment_event_error(error: &HyperCliError) -> bool {
    error
        .status()
        .is_some_and(|status| matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN))
}

/// Percent-encode a single path segment (env/secret keys can contain
/// characters outside the unreserved set). Spaces encode as %20, not `+`.
fn encode_path_key(key: &str) -> String {
    url::form_urlencoded::byte_serialize(key.as_bytes())
        .collect::<String>()
        .replace('+', "%20")
}

/// Reef file writes traverse the Cloudflare-proxied agent hostname
/// (`https://<agent>.hypercli.app/_reef/...`), whose edge rejects request
/// bodies above 100 MB. Enforced client-side so oversized writes fail fast
/// with a clear error instead of an opaque edge `413 Payload Too Large`.
pub const AGENT_FILE_WRITE_MAX_BYTES: usize = 100 * 1024 * 1024;

/// Validate a minted Reef locator down to its exact `/_reef` root.
///
/// A token that does not resolve to `https://<host>/_reef` with no
/// credentials, query, or fragment is refused outright: the returned URL is
/// used verbatim with the bearer token attached, so a locator that points
/// anywhere else would leak that token.
fn reef_base_url(token: &FileToken) -> Result<Url, HyperCliError> {
    let url = Url::parse(&token.url)
        .map_err(|error| HyperCliError::InvalidResponse(error.to_string()))?;
    if url.scheme() != "https"
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/_reef"
        || token.token.is_empty()
        || token.expires_at.is_empty()
    {
        return Err(HyperCliError::InvalidResponse("invalid Reef token".into()));
    }
    Ok(url)
}

/// Normalize a caller path to a sync-root-relative one.
///
/// `allow_root` is set only by the directory listing, which addresses the sync
/// root itself with an empty path. File operations always name a file.
fn reef_relative_path(path: &str, allow_root: bool) -> Result<String, HyperCliError> {
    let path = path.replace('\\', "/");
    let rejected = if path.is_empty() {
        !allow_root
    } else {
        path.starts_with('/')
            || path
                .split('/')
                .any(|segment| segment.is_empty() || segment == "." || segment == "..")
    };
    if rejected {
        return Err(HyperCliError::InvalidResponse(
            "file path must be sync-root relative".into(),
        ));
    }
    Ok(path)
}

fn encode_reef_path(path: &str) -> String {
    path.split('/')
        .map(encode_path_key)
        .collect::<Vec<_>>()
        .join("/")
}

fn reef_file_url(token: &FileToken, path: &str) -> Result<(Url, String), HyperCliError> {
    let path = reef_relative_path(path, false)?;
    let mut url = reef_base_url(token)?;
    url.set_path(&format!("/_reef/files/{}", encode_reef_path(&path)));
    Ok((url, path))
}

fn reef_directory_url(token: &FileToken, path: &str) -> Result<(Url, String), HyperCliError> {
    let path = reef_relative_path(path, true)?;
    let mut url = reef_base_url(token)?;
    if path.is_empty() {
        url.set_path("/_reef/directories");
    } else {
        url.set_path(&format!("/_reef/directories/{}", encode_reef_path(&path)));
    }
    Ok((url, path))
}

impl HyperCliClient {
    pub fn new(config: ClientConfig) -> Result<Self, HyperCliError> {
        Self::new_with_timeout(config, std::time::Duration::from_secs(30))
    }

    pub fn new_with_timeout(
        config: ClientConfig,
        timeout: std::time::Duration,
    ) -> Result<Self, HyperCliError> {
        let http = HttpClient::builder()
            .timeout(timeout)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| HyperCliError::Transport(error.to_string()))?;
        let async_http = AsyncHttpClient::builder()
            .timeout(timeout)
            .redirect(reqwest::redirect::Policy::none())
            .build()
            .map_err(|error| HyperCliError::Transport(error.to_string()))?;
        Ok(Self {
            api_base: config.api_base,
            api_key: config.api_key,
            http,
            async_http,
            trace_file: config.trace_file,
        })
    }

    fn endpoint(&self, path: &str) -> String {
        format!(
            "{}/{}",
            self.api_base.as_str().trim_end_matches('/'),
            path.trim_start_matches('/')
        )
    }

    async fn one_shot(
        &self,
        id: &str,
        purpose: &str,
        request: Option<Value>,
        timeout: Duration,
    ) -> Result<Value, HyperCliError> {
        let r = self
            .async_http
            .post(self.endpoint(&format!("deployments/{id}/{purpose}/token")))
            .bearer_auth(self.api_key.expose_secret())
            .send()
            .await
            .map_err(|e| HyperCliError::Transport(e.to_string()))?;
        if !r.status().is_success() {
            return Err(HyperCliError::Status(r.status()));
        }
        let t: OperationToken = r
            .json()
            .await
            .map_err(|e| HyperCliError::InvalidResponse(e.to_string()))?;
        let mut u =
            Url::parse(&t.ws_url).map_err(|e| HyperCliError::InvalidResponse(e.to_string()))?;
        let suffix = format!("/ws/{purpose}/{id}");
        if t.agent_id != id
            || t.jwt.is_empty()
            || t.expires_at.is_empty()
            || !matches!(u.scheme(), "ws" | "wss")
            || u.host_str().is_none()
            || !u.username().is_empty()
            || u.password().is_some()
            || u.query().is_some()
            || u.fragment().is_some()
            || u.path() != suffix
        {
            return Err(HyperCliError::InvalidResponse(
                "invalid operation token".into(),
            ));
        }
        u.query_pairs_mut().append_pair("jwt", &t.jwt);
        tokio::time::timeout(timeout, async {
            // The URL now contains the short-lived JWT. Never let a
            // connector error render that URL into an SDK error or trace.
            let (mut s, _) = connect_async(u.as_str()).await.map_err(|_| {
                HyperCliError::Transport("operation websocket connection failed".into())
            })?;
            if let Some(v) = request {
                s.send(Message::Text(v.to_string().into()))
                    .await
                    .map_err(|_| {
                        HyperCliError::Transport("operation websocket connection failed".into())
                    })?
            }
            let mut out = None;
            while let Some(m) = s.next().await {
                match m.map_err(|_| {
                    HyperCliError::Transport("operation websocket connection failed".into())
                })? {
                    Message::Text(v) if out.is_none() => {
                        out = Some(
                            serde_json::from_str(v.as_ref())
                                .map_err(|e| HyperCliError::InvalidResponse(e.to_string()))?,
                        )
                    }
                    Message::Text(_) | Message::Binary(_) => {
                        return Err(HyperCliError::InvalidResponse(
                            "multiple operation frames".into(),
                        ))
                    }
                    Message::Close(f) => {
                        if f.as_ref().is_some_and(|f| f.code != 1000.into()) {
                            return Err(HyperCliError::InvalidResponse(
                                "abnormal operation close".into(),
                            ));
                        }
                        return out.ok_or_else(|| {
                            HyperCliError::InvalidResponse("missing operation frame".into())
                        });
                    }
                    Message::Ping(v) => s.send(Message::Pong(v)).await.map_err(|_| {
                        HyperCliError::Transport("operation websocket connection failed".into())
                    })?,
                    _ => {}
                }
            }
            Err(HyperCliError::InvalidResponse(
                "missing operation frame".into(),
            ))
        })
        .await
        .map_err(|_| HyperCliError::Transport("operation timed out".into()))?
    }

    fn get_json<T: DeserializeOwned>(&self, path: &str) -> Result<T, HyperCliError> {
        let url = self.endpoint(path);
        let builder = self
            .http
            .get(&url)
            .bearer_auth(self.api_key.expose_secret());
        self.send_json(path, "GET", &url, None, builder)
    }

    pub fn list_deployments(&self) -> Result<Vec<Deployment>, HyperCliError> {
        Ok(self.list_deployments_with_capacity()?.items)
    }

    pub fn deployment_env(
        &self,
        deployment_id: &str,
    ) -> Result<DeploymentEnvironment, HyperCliError> {
        self.get_json(&format!("deployments/{deployment_id}/env"))
    }

    pub fn deployment_secret_names(
        &self,
        deployment_id: &str,
    ) -> Result<DeploymentSecretNames, HyperCliError> {
        self.get_json(&format!("deployments/{deployment_id}/secrets"))
    }

    pub fn deployment_secret(
        &self,
        deployment_id: &str,
        key: &str,
    ) -> Result<DeploymentSecret, HyperCliError> {
        self.get_json(&format!(
            "deployments/{deployment_id}/secrets/{}",
            encode_path_key(key)
        ))
    }

    /// Set one stored launch-environment key. Matches the TypeScript SDK's
    /// `setEnv` and the Python SDK's `set_env`.
    pub fn set_deployment_env(
        &self,
        deployment_id: &str,
        key: &str,
        value: &str,
    ) -> Result<AgentLaunchValueMutation, HyperCliError> {
        self.mutate_launch_value("env", deployment_id, key, Some(value))
    }

    /// Remove one stored launch-environment key.
    pub fn delete_deployment_env(
        &self,
        deployment_id: &str,
        key: &str,
    ) -> Result<AgentLaunchValueMutation, HyperCliError> {
        self.mutate_launch_value("env", deployment_id, key, None)
    }

    /// Set one stored launch secret. The value travels in the request body
    /// and is redacted from the optional HTTP trace.
    pub fn set_deployment_secret(
        &self,
        deployment_id: &str,
        key: &str,
        value: &str,
    ) -> Result<AgentLaunchValueMutation, HyperCliError> {
        self.mutate_launch_value("secrets", deployment_id, key, Some(value))
    }

    /// Remove one stored launch secret.
    pub fn delete_deployment_secret(
        &self,
        deployment_id: &str,
        key: &str,
    ) -> Result<AgentLaunchValueMutation, HyperCliError> {
        self.mutate_launch_value("secrets", deployment_id, key, None)
    }

    fn mutate_launch_value(
        &self,
        family: &str,
        deployment_id: &str,
        key: &str,
        value: Option<&str>,
    ) -> Result<AgentLaunchValueMutation, HyperCliError> {
        if key.trim().is_empty() {
            return Err(HyperCliError::InvalidResponse(
                "launch env/secret key is required".to_owned(),
            ));
        }
        let url = self.endpoint(&format!(
            "deployments/{deployment_id}/{family}/{}",
            encode_path_key(key)
        ));
        let name = match (family, value.is_some()) {
            ("env", true) => "set_deployment_env",
            ("env", false) => "delete_deployment_env",
            ("secrets", true) => "set_deployment_secret",
            _ => "delete_deployment_secret",
        };
        // The trace must never carry a secret value; record the key only.
        let trace = Some(json!({ "key": key, "value": value.map(|_| "<omitted>") }));
        match value {
            Some(value) => self.send_json(
                name,
                "PATCH",
                &url,
                trace,
                self.http
                    .patch(&url)
                    .bearer_auth(self.api_key.expose_secret())
                    .json(&json!({ "value": value })),
            ),
            None => self.send_json(
                name,
                "DELETE",
                &url,
                trace,
                self.http
                    .delete(&url)
                    .bearer_auth(self.api_key.expose_secret()),
            ),
        }
    }

    /// The account's current agent resource budget and usage (cores/GB).
    /// The shape is backend-owned; newer SDKs expose it untyped as well.
    pub fn deployments_budget(&self) -> Result<Value, HyperCliError> {
        self.get_json("deployments/budget")
    }

    /// Live CPU/memory metrics for a running deployment from the cluster
    /// metrics server. The shape is backend-owned; newer SDKs expose it
    /// untyped as well.
    pub async fn deployment_metrics(&self, deployment_id: &str) -> Result<Value, HyperCliError> {
        let v = self
            .one_shot(deployment_id, "metrics", None, Duration::from_secs(45))
            .await?;
        let o = v
            .as_object()
            .ok_or_else(|| HyperCliError::InvalidResponse("invalid metrics frame".into()))?;
        if o.len() == 3
            && o.get("event") == Some(&json!("agent_metrics_result"))
            && o.get("ok") == Some(&json!(false))
        {
            if let Some(error) = o
                .get("error")
                .and_then(Value::as_str)
                .filter(|v| !v.is_empty())
            {
                return Err(HyperCliError::InvalidResponse(error.into()));
            }
        }
        if o.len() != 5
            || o.get("event") != Some(&json!("agent_metrics_result"))
            || o.get("ok") != Some(&json!(true))
            || o.get("cpu").and_then(Value::as_str).is_none()
            || o.get("memory").and_then(Value::as_str).is_none()
            || o.get("timestamp").and_then(Value::as_i64).is_none()
        {
            return Err(HyperCliError::InvalidResponse(
                "invalid metrics frame".into(),
            ));
        }
        Ok(v)
    }

    pub fn list_deployments_with_capacity(&self) -> Result<AgentCapacity, HyperCliError> {
        self.list_deployments_filtered_with_capacity(&DeploymentListFilters::default())
    }

    pub fn list_deployments_filtered(
        &self,
        filters: &DeploymentListFilters,
    ) -> Result<Vec<Deployment>, HyperCliError> {
        Ok(self.list_deployments_filtered_with_capacity(filters)?.items)
    }

    pub fn list_deployments_by_handle(
        &self,
        handle: &str,
    ) -> Result<Vec<Deployment>, HyperCliError> {
        Ok(self.list_deployments_by_handle_with_capacity(handle)?.items)
    }

    pub fn list_deployments_by_handle_with_capacity(
        &self,
        handle: &str,
    ) -> Result<AgentCapacity, HyperCliError> {
        self.list_deployments_filtered_with_capacity(&DeploymentListFilters {
            handle: Some(handle.to_owned()),
            ..DeploymentListFilters::default()
        })
    }

    pub fn list_deployments_filtered_with_capacity(
        &self,
        filters: &DeploymentListFilters,
    ) -> Result<AgentCapacity, HyperCliError> {
        let url = self.endpoint("deployments");
        let request = serde_json::to_value(filters).ok();
        let started = Instant::now();
        let request_builder = self
            .http
            .get(&url)
            .bearer_auth(self.api_key.expose_secret())
            .query(filters);
        let response = match request_builder.send() {
            Ok(response) => response,
            Err(error) => {
                let error = HyperCliError::Transport(error.to_string());
                self.trace_http(
                    "list_deployments",
                    "GET",
                    &url,
                    request.as_ref(),
                    started,
                    None,
                    BTreeMap::new(),
                    Err(&error),
                );
                return Err(error);
            }
        };
        let status = response.status();
        let headers = trace_headers(&response);
        let result: Result<AgentCapacity, HyperCliError> = decode_json(response);
        self.trace_http(
            "list_deployments",
            "GET",
            &url,
            request.as_ref(),
            started,
            Some(status),
            headers,
            result.as_ref().map(|_| ()),
        );
        result
    }

    pub fn plans(&self) -> Result<Vec<HyperAgentPlan>, HyperCliError> {
        #[derive(Deserialize)]
        struct PlanPage {
            #[serde(default)]
            plans: Vec<HyperAgentPlan>,
        }
        Ok(self.get_json::<PlanPage>("plans")?.plans)
    }

    pub fn current_plan(&self) -> Result<HyperAgentCurrentPlan, HyperCliError> {
        self.get_json("plans/current")
    }

    pub fn subscription_summary(&self) -> Result<HyperAgentEntitlementsSummary, HyperCliError> {
        self.get_json("subscriptions/summary")
    }

    /// Effective HyperClaw entitlement summary. A scoped key without the
    /// `user` scope family returns 403; callers should treat that as unknown,
    /// not as an explicit inactive-plan result.
    pub fn entitlements_summary(&self) -> Result<HyperAgentEntitlementsSummary, HyperCliError> {
        self.subscription_summary()
    }

    pub fn entitlements(&self) -> Result<HyperAgentEntitlementsSummary, HyperCliError> {
        self.get_json("entitlements")
    }

    /// Claim the authenticated fresh user's introductory trial entitlement.
    pub fn claim_trial_entitlement(&self) -> Result<HyperAgentEntitlement, HyperCliError> {
        let url = self.endpoint("plans/trial");
        let builder = self
            .http
            .post(&url)
            .bearer_auth(self.api_key.expose_secret());
        self.send_json("claim_trial_entitlement", "POST", &url, None, builder)
    }

    pub fn get_deployment(&self, deployment_id: &str) -> Result<Deployment, HyperCliError> {
        let url = self.endpoint(&format!("deployments/{deployment_id}"));
        let started = Instant::now();
        let response = match self
            .http
            .get(&url)
            .bearer_auth(self.api_key.expose_secret())
            .send()
        {
            Ok(response) => response,
            Err(error) => {
                let error = HyperCliError::Transport(error.to_string());
                self.trace_http(
                    "get_deployment",
                    "GET",
                    &url,
                    None,
                    started,
                    None,
                    BTreeMap::new(),
                    Err(&error),
                );
                return Err(error);
            }
        };
        let status = response.status();
        let headers = trace_headers(&response);
        let result = decode_json(response);
        self.trace_http(
            "get_deployment",
            "GET",
            &url,
            None,
            started,
            Some(status),
            headers,
            result.as_ref().map(|_| ()),
        );
        result
    }

    async fn async_get_json<T: DeserializeOwned>(&self, path: &str) -> Result<T, HyperCliError> {
        let response = self
            .async_http
            .get(self.endpoint(path))
            .bearer_auth(self.api_key.expose_secret())
            .send()
            .await
            .map_err(|error| HyperCliError::Transport(error.to_string()))?;
        if !response.status().is_success() {
            return Err(HyperCliError::Status(response.status()));
        }
        response
            .json()
            .await
            .map_err(|error| HyperCliError::InvalidResponse(error.to_string()))
    }

    async fn create_deployment_event_token(
        &self,
    ) -> Result<DeploymentEventTokenResponse, HyperCliError> {
        let url = self.endpoint("deployments/events/token");
        let response = self
            .async_http
            .post(&url)
            .bearer_auth(self.api_key.expose_secret())
            .send()
            .await
            .map_err(|error| HyperCliError::Transport(error.to_string()))?;
        if !response.status().is_success() {
            return Err(HyperCliError::Status(response.status()));
        }
        response
            .json()
            .await
            .map_err(|error| HyperCliError::InvalidResponse(error.to_string()))
    }

    async fn connect_deployment_events(&self) -> Result<DeploymentEventSocket, HyperCliError> {
        let token = self.create_deployment_event_token().await?;
        let (mut socket, _) = connect_async(token.ws_url.as_str())
            .await
            .map_err(|error| HyperCliError::Transport(error.to_string()))?;
        socket
            .send(Message::Text(
                serde_json::to_string(&json!({
                    "type": "auth",
                    "token": token.token,
                }))
                .map_err(|error| HyperCliError::InvalidResponse(error.to_string()))?
                .into(),
            ))
            .await
            .map_err(|error| HyperCliError::Transport(error.to_string()))?;
        let ready = tokio::time::timeout(Duration::from_secs(10), socket.next())
            .await
            .map_err(|_| HyperCliError::Transport("deployment event ready timed out".to_owned()))?
            .ok_or_else(|| HyperCliError::Transport("deployment event socket closed".to_owned()))?
            .map_err(|error| HyperCliError::Transport(error.to_string()))?;
        let Message::Text(ready) = ready else {
            return Err(HyperCliError::InvalidResponse(
                "deployment event socket did not send ready".to_owned(),
            ));
        };
        let ready: Value = serde_json::from_str(ready.as_ref())
            .map_err(|error| HyperCliError::InvalidResponse(error.to_string()))?;
        if ready != json!({"type": "ready"}) {
            return Err(HyperCliError::InvalidResponse(
                "deployment event socket did not send ready".to_owned(),
            ));
        }
        Ok(socket)
    }

    /// Hydrate from REST, then invoke `handler` for flat deployment
    /// invalidations. Cancel by aborting or dropping the returned future.
    pub async fn subscribe_deployments<F>(&self, mut handler: F) -> Result<(), HyperCliError>
    where
        F: FnMut(DeploymentEvent),
    {
        let mut retry_delay = Duration::from_millis(250);
        loop {
            let mut socket = match self.connect_deployment_events().await {
                Ok(socket) => socket,
                Err(error) if permanent_deployment_event_error(&error) => return Err(error),
                Err(_) => {
                    tokio::time::sleep(retry_delay).await;
                    retry_delay = (retry_delay * 2).min(Duration::from_secs(5));
                    continue;
                }
            };
            retry_delay = Duration::from_millis(250);
            while let Some(message) = socket.next().await {
                match message {
                    Ok(Message::Text(value)) => {
                        let Ok(event) = serde_json::from_str::<DeploymentEvent>(value.as_ref())
                        else {
                            break;
                        };
                        if matches!(
                            event.event_type.as_str(),
                            "deployment.transition" | "deployment.import_status"
                        ) && !event.agent_id.is_empty()
                        {
                            handler(event);
                        }
                    }
                    Ok(Message::Ping(value)) => match socket.send(Message::Pong(value)).await {
                        Ok(()) => {}
                        Err(_) => break,
                    },
                    Ok(Message::Close(_)) | Err(_) => break,
                    _ => {}
                }
            }
            tokio::time::sleep(retry_delay).await;
            retry_delay = (retry_delay * 2).min(Duration::from_secs(5));
        }
    }

    /// Subscribe to job-scoped GPU/job lifecycle ticks using the job key.
    ///
    /// Events are low-latency wakeups. Refresh the job over REST when an
    /// authoritative snapshot is required.
    pub async fn subscribe_job_lifecycle<F>(
        &self,
        job_key: &str,
        mut handler: F,
    ) -> Result<(), HyperCliError>
    where
        F: FnMut(JobLifecycleEvent),
    {
        let url = self.product_ws_url(&["orchestra", "ws", "lifecycle", job_key])?;
        let mut retry_delay = Duration::from_millis(250);
        loop {
            let (mut socket, _) = match connect_async(url.as_str()).await {
                Ok(connection) => connection,
                Err(_) => {
                    tokio::time::sleep(retry_delay).await;
                    retry_delay = (retry_delay * 2).min(Duration::from_secs(5));
                    continue;
                }
            };
            retry_delay = Duration::from_millis(250);
            while let Some(message) = socket.next().await {
                match message {
                    Ok(Message::Text(value)) => {
                        if let Ok(event) = serde_json::from_str::<JobLifecycleEvent>(value.as_ref())
                        {
                            handler(event);
                        }
                    }
                    Ok(Message::Ping(value)) => match socket.send(Message::Pong(value)).await {
                        Ok(()) => {}
                        Err(_) => break,
                    },
                    Ok(Message::Close(_)) | Err(_) => break,
                    _ => {}
                }
            }
            tokio::time::sleep(retry_delay).await;
            retry_delay = (retry_delay * 2).min(Duration::from_secs(5));
        }
    }

    /// Get one GPU job metrics snapshot over the Orchestra job-key metrics WebSocket.
    pub async fn job_metrics(&self, job_key: &str) -> Result<Value, HyperCliError> {
        let mut seen = None;
        self.job_metrics_stream(job_key, Duration::from_secs(60), true, |metrics| {
            if seen.is_none() {
                seen = Some(metrics);
            }
        })
        .await?;
        seen.ok_or_else(|| HyperCliError::InvalidResponse("metrics stream closed before first snapshot".into()))
    }

    /// Subscribe to GPU job metrics snapshots over the Orchestra job-key metrics WebSocket.
    pub async fn subscribe_job_metrics<F>(
        &self,
        job_key: &str,
        interval: Duration,
        handler: F,
    ) -> Result<(), HyperCliError>
    where
        F: FnMut(Value),
    {
        self.job_metrics_stream(job_key, interval, false, handler).await
    }

    async fn job_metrics_stream<F>(
        &self,
        job_key: &str,
        interval: Duration,
        once: bool,
        mut handler: F,
    ) -> Result<(), HyperCliError>
    where
        F: FnMut(Value),
    {
        let interval = interval.as_secs_f64().clamp(1.0, 60.0).to_string();
        let mut url = self.product_ws_url(&["orchestra", "ws", "metrics", "jobs", job_key])?;
        url.query_pairs_mut().append_pair("interval", &interval);
        let (mut socket, _) = connect_async(url.as_str())
            .await
            .map_err(|_| HyperCliError::Transport("metrics websocket connection failed".into()))?;
        while let Some(message) = socket.next().await {
            match message {
                Ok(Message::Text(value)) => {
                    let parsed: Value = serde_json::from_str(value.as_ref()).map_err(|error| {
                        HyperCliError::InvalidResponse(format!("invalid metrics frame: {error}"))
                    })?;
                    if parsed.get("event") == Some(&json!("metrics_error")) {
                        let detail = parsed
                            .get("detail")
                            .and_then(Value::as_str)
                            .unwrap_or("metrics stream failed");
                        return Err(HyperCliError::InvalidResponse(detail.to_owned()));
                    }
                    if parsed.get("event") == Some(&json!("metrics_snapshot")) {
                        handler(parsed.get("data").cloned().unwrap_or(Value::Null));
                        if once {
                            break;
                        }
                    }
                }
                Ok(Message::Ping(value)) => {
                    socket
                        .send(Message::Pong(value))
                        .await
                        .map_err(|_| HyperCliError::Transport("metrics websocket closed".into()))?;
                }
                Ok(Message::Close(_)) | Err(_) => break,
                _ => {}
            }
        }
        Ok(())
    }

    /// Wait for a deployment state using WebSocket wakeups and REST confirmation.
    pub async fn wait_deployment_state(
        &self,
        deployment_id: &str,
        states: &[&str],
        failure_states: &[&str],
        timeout: Duration,
    ) -> Result<Deployment, HyperCliError> {
        self.wait_deployment_state_with_poll_interval(
            deployment_id,
            states,
            failure_states,
            timeout,
            DEFAULT_DEPLOYMENT_STATE_POLL_INTERVAL,
        )
        .await
    }

    async fn wait_deployment_state_with_poll_interval(
        &self,
        deployment_id: &str,
        states: &[&str],
        failure_states: &[&str],
        timeout: Duration,
        poll_interval: Duration,
    ) -> Result<Deployment, HyperCliError> {
        if states.is_empty() {
            return Err(HyperCliError::InvalidResponse(
                "deployment wait states must not be empty".to_owned(),
            ));
        }
        let check = |deployment: Deployment| -> Result<Option<Deployment>, HyperCliError> {
            if states
                .iter()
                .any(|state| deployment.state.eq_ignore_ascii_case(state))
            {
                return Ok(Some(deployment));
            }
            if failure_states
                .iter()
                .any(|state| deployment.state.eq_ignore_ascii_case(state))
            {
                return Err(HyperCliError::InvalidResponse(format!(
                    "deployment entered {} while waiting for {}",
                    deployment.state,
                    states.join(", ")
                )));
            }
            Ok(None)
        };
        let effective_poll_interval = if poll_interval.is_zero() {
            Duration::from_millis(1)
        } else {
            poll_interval
        };
        let waited = tokio::time::timeout(timeout, async {
            let mut retry_delay = Duration::from_millis(250);
            let mut reconcile = tokio::time::interval(effective_poll_interval);
            reconcile.set_missed_tick_behavior(tokio::time::MissedTickBehavior::Delay);
            reconcile.tick().await;
            loop {
                if let Some(deployment) = check(
                    self.async_get_json(&format!("deployments/{deployment_id}"))
                        .await?,
                )? {
                    return Ok(deployment);
                }
                let connection = self.connect_deployment_events();
                tokio::pin!(connection);
                let mut socket = match tokio::select! {
                    connection = &mut connection => Some(connection),
                    _ = reconcile.tick() => None,
                } {
                    None => continue,
                    Some(result) => match result {
                    Ok(socket) => {
                        retry_delay = Duration::from_millis(250);
                        socket
                    }
                    Err(_) => {
                        tokio::select! {
                            _ = tokio::time::sleep(retry_delay) => {},
                            _ = reconcile.tick() => {},
                        }
                        retry_delay = (retry_delay * 2).min(Duration::from_secs(5));
                        continue;
                    }
                }};
                'socket: loop {
                    tokio::select! {
                        _ = reconcile.tick() => {
                            if let Some(deployment) = check(
                                self.async_get_json(&format!("deployments/{deployment_id}"))
                                    .await?,
                            )? {
                                return Ok(deployment);
                            }
                        }
                        message = socket.next() => {
                            let Some(message) = message else { break 'socket; };
                            let value = match message {
                                Ok(Message::Text(value)) => value,
                                Ok(Message::Ping(value)) => {
                                    if socket.send(Message::Pong(value)).await.is_err() {
                                        break 'socket;
                                    }
                                    continue;
                                }
                                Ok(Message::Close(_)) | Err(_) => break 'socket,
                                _ => continue,
                            };
                            let Ok(event) = serde_json::from_str::<DeploymentEvent>(value.as_ref()) else {
                                break 'socket;
                            };
                            if event.event_type != "deployment.transition"
                                || event.agent_id != deployment_id
                            {
                                continue;
                            }
                            if let Some(deployment) = check(
                                self.async_get_json(&format!("deployments/{deployment_id}"))
                                    .await?,
                            )? {
                                return Ok(deployment);
                            }
                        }
                    }
                }
                tokio::select! {
                    _ = tokio::time::sleep(retry_delay) => {},
                    _ = reconcile.tick() => {},
                }
                retry_delay = (retry_delay * 2).min(Duration::from_secs(5));
            }
        })
        .await;
        match waited {
            Ok(result) => result,
            Err(_) => {
                if let Some(deployment) = check(
                    self.async_get_json(&format!("deployments/{deployment_id}"))
                        .await?,
                )? {
                    return Ok(deployment);
                }
                Err(HyperCliError::Transport(
                    "deployment wait timed out".to_owned(),
                ))
            }
        }
    }

    /// Wait for RUNNING using WebSocket wakeups and REST confirmation.
    pub async fn wait_deployment_running(
        &self,
        deployment_id: &str,
        timeout: Duration,
    ) -> Result<Deployment, HyperCliError> {
        self.wait_deployment_state(
            deployment_id,
            &["running"],
            &["stopped", "archived", "deleted", "failed"],
            timeout,
        )
        .await
    }

    /// Wait for RUNNING, then allow a newly issued hostname to settle locally.
    ///
    /// This deliberately performs no DNS lookup.  Consumers should use the
    /// returned deployment to make their first health request after the
    /// bounded settle window.  Passing `Some(Duration::ZERO)` is useful for
    /// already-propagated/reused hostnames and for deterministic tests.
    ///
    /// The settle window is a fixed delay, so it can only ever be a guess about
    /// edge convergence. When the next step is a file operation, prefer
    /// [`Self::wait_deployment_file_api_ready`], which polls the file API until
    /// it demonstrably serves and fails fast on a terminal agent state.
    pub async fn wait_deployment_running_settled(
        &self,
        deployment_id: &str,
        timeout: Duration,
        settle_delay: Option<Duration>,
    ) -> Result<Deployment, HyperCliError> {
        let settle_delay = settle_delay.unwrap_or(DEFAULT_HOSTNAME_SETTLE_DELAY);
        let state_timeout = timeout.saturating_sub(settle_delay);
        let deployment = self
            .wait_deployment_running(deployment_id, state_timeout)
            .await?;
        tokio::time::sleep(settle_delay).await;
        Ok(deployment)
    }

    pub fn create_deployment(
        &self,
        request: &CreateDeploymentRequest,
    ) -> Result<Deployment, HyperCliError> {
        let url = self.endpoint("deployments");
        let request_body = deployment_request_body(request)?;
        let request_trace = Some(redacted_launch_trace(request_body.clone()));
        let started = Instant::now();
        let response = match self
            .http
            .post(&url)
            .bearer_auth(self.api_key.expose_secret())
            .json(&request_body)
            .send()
        {
            Ok(response) => response,
            Err(error) => {
                let error = HyperCliError::Transport(error.to_string());
                self.trace_http(
                    "create_deployment",
                    "POST",
                    &url,
                    request_trace.as_ref(),
                    started,
                    None,
                    BTreeMap::new(),
                    Err(&error),
                );
                return Err(error);
            }
        };
        let status = response.status();
        let headers = trace_headers(&response);
        let result: Result<Deployment, HyperCliError> = decode_json(response);
        self.trace_http(
            "create_deployment",
            "POST",
            &url,
            request_trace.as_ref(),
            started,
            Some(status),
            headers,
            result.as_ref().map(|_| ()),
        );
        result
    }

    /// Update mutable deployment metadata and/or replace the persisted launch
    /// configuration. The backend requires launch-affecting edits while the
    /// deployment is stopped.
    pub fn update_deployment(
        &self,
        deployment_id: &str,
        request: &UpdateDeploymentRequest,
    ) -> Result<Deployment, HyperCliError> {
        let url = self.endpoint(&format!("deployments/{deployment_id}"));
        let request_trace = serde_json::to_value(request).ok();
        let builder = self
            .http
            .patch(&url)
            .bearer_auth(self.api_key.expose_secret())
            .json(request);
        self.send_json("update_deployment", "PATCH", &url, request_trace, builder)
    }

    /// Mint one short-lived Reef credential for an agent's retained file
    /// volume. The token is single-purpose and never surfaced to callers.
    fn deployment_file_token(&self, deployment_id: &str) -> Result<FileToken, HyperCliError> {
        let url = self.endpoint(&format!("deployments/{deployment_id}/files/token"));
        self.send_json(
            "deployment_file_token",
            "POST",
            &url,
            None,
            self.http
                .post(&url)
                .bearer_auth(self.api_key.expose_secret()),
        )
    }

    /// List one sync-root-relative directory through the agent's retained Reef
    /// server. An empty `path` lists the sync root itself.
    ///
    /// Directories are returned before files, matching the Python SDK's
    /// `files_list` and the TypeScript SDK's `filesList`.
    pub fn list_deployment_files(
        &self,
        deployment_id: &str,
        path: &str,
    ) -> Result<Vec<AgentFileEntry>, HyperCliError> {
        let token = self.deployment_file_token(deployment_id)?;
        let (url, path) = reef_directory_url(&token, path)?;
        let listing: AgentDirectoryListing = self.send_json(
            "list_deployment_files",
            "GET",
            url.as_str(),
            Some(json!({ "path": path })),
            self.http.get(url.as_str()).bearer_auth(token.token),
        )?;
        if listing.listing_type != "directory" {
            return Err(HyperCliError::InvalidResponse(
                "Reef returned an invalid directory listing".into(),
            ));
        }
        Ok(listing.into_entries())
    }

    /// Wait until an agent's Reef file API is actually serving.
    ///
    /// Probing the agent hostname alone cannot answer this. The agent domain is
    /// a wildcard, so a host with no route still resolves and the edge answers a
    /// plain-text `404 page not found` -- byte for byte what a route that has
    /// not converged yet returns. A caller polling the hostname therefore cannot
    /// tell "not ready" from "never will be", and will keep retrying until its
    /// deadline against a host that was never going to work.
    ///
    /// So ask the API for the authoritative agent state first: a deleted or
    /// failed agent fails immediately with that state instead of timing out.
    /// Then require consecutive successful reads, because one success only
    /// proves the route answered once -- the next request can still 404 while
    /// the edge settles.
    ///
    /// This is the answer to the question [`Self::wait_deployment_running_settled`]
    /// can only guess at with a fixed delay. It is blocking, like every other
    /// file call on this client; drive it from `tokio::task::spawn_blocking`
    /// when the caller is async.
    pub fn wait_deployment_file_api_ready(
        &self,
        deployment_id: &str,
        options: FileApiReadyOptions,
    ) -> Result<(), HyperCliError> {
        self.wait_file_api_ready_with(deployment_id, options, || {
            self.list_deployment_files(deployment_id, "").map(|_| ())
        })
    }

    /// The readiness loop itself, with the file read left injectable so the
    /// consecutive-streak contract is testable without a live Reef host.
    fn wait_file_api_ready_with<P>(
        &self,
        deployment_id: &str,
        options: FileApiReadyOptions,
        mut probe: P,
    ) -> Result<(), HyperCliError>
    where
        P: FnMut() -> Result<(), HyperCliError>,
    {
        let consecutive = options.consecutive.max(1);
        let deadline = Instant::now() + options.timeout;
        let mut streak = 0u32;
        let mut last_error: Option<HyperCliError> = None;
        loop {
            let deployment = self.get_deployment(deployment_id)?;
            let state = deployment.state.to_ascii_uppercase();
            if state == "DELETED" || state == "FAILED" {
                return Err(HyperCliError::InvalidResponse(format!(
                    "agent {deployment_id} is {state}; its Reef file API will not serve, so waiting longer cannot help"
                )));
            }
            match probe() {
                Ok(()) => {
                    streak += 1;
                    if streak >= consecutive {
                        return Ok(());
                    }
                }
                Err(error) => {
                    last_error = Some(error);
                    streak = 0;
                }
            }
            if Instant::now() >= deadline {
                let last_error = last_error
                    .as_ref()
                    .map_or_else(|| "none".to_owned(), ToString::to_string);
                return Err(HyperCliError::Transport(format!(
                    "agent {deployment_id} Reef file API did not serve {consecutive} consecutive reads within {}s (agent state={}, last error={last_error})",
                    options.timeout.as_secs(),
                    if state.is_empty() { "unknown" } else { &state },
                )));
            }
            std::thread::sleep(options.poll_interval);
        }
    }

    /// Write a file through the managed agent file API without placing its
    /// content in argv, query strings, or HTTP traces. Paths are deliberately
    /// restricted to simple workspace-relative segments and always use Reef.
    ///
    /// Per-file writes are limited to 100 MiB
    /// ([`AGENT_FILE_WRITE_MAX_BYTES`], the Cloudflare edge request-body cap
    /// on the agent hostname). Larger data should be split across files or
    /// synced via the agent's own tooling.
    pub fn put_deployment_file(
        &self,
        deployment_id: &str,
        path: &str,
        content: &[u8],
    ) -> Result<DeploymentFileWriteResponse, HyperCliError> {
        if content.len() > AGENT_FILE_WRITE_MAX_BYTES {
            return Err(HyperCliError::InvalidResponse(format!(
                "agent file writes are limited to {} MiB (Cloudflare request-body cap on the agent hostname); split larger data or sync it via the agent's own tooling",
                AGENT_FILE_WRITE_MAX_BYTES / 1024 / 1024
            )));
        }
        let token = self.deployment_file_token(deployment_id)?;
        let (url, path) = reef_file_url(&token, path)?;
        self.send_json(
            "put_deployment_file",
            "PUT",
            url.as_str(),
            Some(json!({"path":path,"size":content.len(),"content":"<omitted>"})),
            self.http
                .put(url.as_str())
                .bearer_auth(token.token)
                .header(reqwest::header::CONTENT_TYPE, "application/octet-stream")
                .body(content.to_vec()),
        )
    }

    /// Upload raw image bytes to a deployment's durable public profile-image
    /// slot. The backend validates the supported image type and size.
    ///
    /// Image bytes remain in the HTTP body and are represented only by their
    /// size in the optional redacted HTTP trace.
    pub fn upload_deployment_profile_image(
        &self,
        deployment_id: &str,
        content: &[u8],
        content_type: &str,
    ) -> Result<DeploymentProfileImageResponse, HyperCliError> {
        let url = self.endpoint(&format!("deployments/{deployment_id}/profile-image"));
        let request_trace = json!({
            "content_type": content_type,
            "size": content.len(),
            "content": "<omitted>",
        });
        let builder = self
            .http
            .post(&url)
            .bearer_auth(self.api_key.expose_secret())
            .header(reqwest::header::CONTENT_TYPE, content_type)
            .body(content.to_vec());
        self.send_json(
            "upload_deployment_profile_image",
            "POST",
            &url,
            Some(request_trace),
            builder,
        )
    }

    /// Remove a deployment's durable public profile image and clear its stored
    /// `avatar_url`.
    pub fn delete_deployment_profile_image(
        &self,
        deployment_id: &str,
    ) -> Result<DeploymentProfileImageResponse, HyperCliError> {
        let url = self.endpoint(&format!("deployments/{deployment_id}/profile-image"));
        self.send_json(
            "delete_deployment_profile_image",
            "DELETE",
            &url,
            None,
            self.http
                .delete(&url)
                .bearer_auth(self.api_key.expose_secret()),
        )
    }

    /// Read back every launch secret value the owner-facing projection refuses
    /// to return.
    ///
    /// Agent projections list secret *names* and expose values only through the
    /// per-secret retrieval endpoint, so a complete `secrets` map has to be
    /// reassembled one key at a time. Every response is checked against
    /// `launch_epoch` so a rebuild never silently mixes values from an older
    /// launch generation into a new one; pass the `launch_epoch` of the
    /// [`Deployment`] the rebuilt configuration is meant to match.
    pub fn recover_deployment_secrets(
        &self,
        deployment_id: &str,
        launch_epoch: u64,
    ) -> Result<BTreeMap<String, String>, HyperCliError> {
        let names = self.deployment_secret_names(deployment_id)?;
        if names.launch_epoch < launch_epoch {
            return Err(HyperCliError::InvalidResponse(
                "agent secret names belong to an older launch epoch".into(),
            ));
        }
        let mut secrets = BTreeMap::new();
        for name in names.names {
            let secret = self.deployment_secret(deployment_id, &name)?;
            if secret.launch_epoch < launch_epoch {
                return Err(HyperCliError::InvalidResponse(
                    "agent secret belongs to an older launch epoch".into(),
                ));
            }
            secrets.insert(name, secret.value);
        }
        Ok(secrets)
    }

    /// Rebuild the complete replacement launch configuration START requires
    /// from nothing but an agent's stored projection.
    ///
    /// WHY THIS EXISTS -- do not delete it as convenience sugar. The backend's
    /// owner-facing agent projection deliberately strips `secrets` and
    /// `registry_auth` before returning an agent to a user-scoped caller
    /// (`hydrate_managed_agent` pops both), and [`crate::DeploymentLaunchConfig`]
    /// strips them again so a redacted projection can never be mistaken for a
    /// launch payload. START, by contrast, is a *full replacement* and demands
    /// every key. The read side is therefore structurally incapable of
    /// returning what the write side requires, and this is the only thing that
    /// closes the loop:
    ///
    /// ```no_run
    /// # use hypercli_sdk::{HyperCliClient, StartDeploymentRequest};
    /// # fn main() -> Result<(), Box<dyn std::error::Error>> {
    /// # let client: HyperCliClient = unimplemented!();
    /// let launch_config = client.stored_launch_config("agent-1", None)?;
    /// client.start_deployment("agent-1", &StartDeploymentRequest::new(launch_config))?;
    /// # Ok(()) }
    /// ```
    ///
    /// The fix is to complete the object honestly, never to weaken the
    /// completeness contract -- START must stay a replacement, not a merge, so
    /// [`CompleteDeploymentLaunchConfig`] keeps every field required.
    ///
    /// `secrets` are recoverable because values can be read back one name at a
    /// time. `registry_auth` is NOT: it is caller-held, write-only, and never
    /// stored server-side. It therefore comes from `registry_auth` when
    /// supplied, and otherwise defaults to empty only when the configuration
    /// pulls from no `registry_url`; when a registry IS configured an empty
    /// credential would silently break the image pull, so the caller is told to
    /// supply it instead.
    ///
    /// Legacy projections are canonicalized on the way through: a nullable
    /// `restart` becomes an explicit `false`, and a projection carrying both or
    /// neither sync policy is reduced to the exactly-one form START accepts
    /// (includes win; neither becomes the explicit sync-everything exclusion).
    pub fn stored_launch_config(
        &self,
        deployment_id: &str,
        registry_auth: Option<&BTreeMap<String, String>>,
    ) -> Result<CompleteDeploymentLaunchConfig, HyperCliError> {
        let deployment = self.get_deployment(deployment_id)?;
        let mut launch: serde_json::Map<String, Value> = deployment
            .launch_config
            .as_map()
            .iter()
            .map(|(key, value)| (key.clone(), value.clone()))
            .collect();
        if launch.is_empty() {
            return Err(HyperCliError::InvalidResponse(format!(
                "agent {} has no stored launch_config projection",
                deployment.id
            )));
        }

        // Legacy projections may still carry the old nullable restart
        // representation; START receives one explicit boolean.
        if launch.get("restart").is_some_and(Value::is_null) {
            launch.insert("restart".to_owned(), Value::Bool(false));
        }

        let secrets = self.recover_deployment_secrets(&deployment.id, deployment.launch_epoch)?;
        launch.insert(
            "secrets".to_owned(),
            serde_json::to_value(secrets)
                .map_err(|error| HyperCliError::InvalidResponse(error.to_string()))?,
        );

        let registry_url = launch
            .get("registry_url")
            .and_then(Value::as_str)
            .unwrap_or_default()
            .trim()
            .to_owned();
        let registry_auth = match registry_auth {
            Some(registry_auth) => registry_auth.clone(),
            None if !registry_url.is_empty() => {
                return Err(HyperCliError::InvalidResponse(format!(
                    "agent {} pulls from registry_url {registry_url:?}; registry_auth is caller-held and never stored server-side, so the owner-facing projection can never return it and the SDK will not substitute an empty credential that would break the private-registry pull -- pass registry_auth explicitly",
                    deployment.id
                )));
            }
            None => BTreeMap::new(),
        };
        launch.insert(
            "registry_auth".to_owned(),
            serde_json::to_value(registry_auth)
                .map_err(|error| HyperCliError::InvalidResponse(error.to_string()))?,
        );

        // START requires exactly one sync policy. Includes win when a legacy
        // projection carries both; carrying neither canonicalizes to the
        // explicit sync-everything exclusion list.
        let has_include = launch
            .get("sync_include")
            .is_some_and(|value| !value.is_null());
        let has_exclude = launch
            .get("sync_exclude")
            .is_some_and(|value| !value.is_null());
        if has_include {
            launch.remove("sync_exclude");
        } else if has_exclude {
            launch.remove("sync_include");
        } else {
            launch.remove("sync_include");
            launch.insert("sync_exclude".to_owned(), Value::Array(Vec::new()));
        }

        serde_json::from_value(Value::Object(launch)).map_err(|error| {
            HyperCliError::InvalidResponse(format!(
                "agent {} stored launch_config is not a complete START configuration: {error}",
                deployment.id
            ))
        })
    }

    pub fn start_deployment(
        &self,
        deployment_id: &str,
        request: &StartDeploymentRequest,
    ) -> Result<Deployment, HyperCliError> {
        let url = self.endpoint(&format!("deployments/{deployment_id}/start"));
        let request_body = deployment_request_body(request)?;
        let request_trace = Some(redacted_launch_trace(request_body.clone()));
        let started = Instant::now();
        let response = match self
            .http
            .post(&url)
            .bearer_auth(self.api_key.expose_secret())
            .json(&request_body)
            .send()
        {
            Ok(response) => response,
            Err(error) => {
                let error = HyperCliError::Transport(error.to_string());
                self.trace_http(
                    "start_deployment",
                    "POST",
                    &url,
                    request_trace.as_ref(),
                    started,
                    None,
                    BTreeMap::new(),
                    Err(&error),
                );
                return Err(error);
            }
        };
        let status = response.status();
        let headers = trace_headers(&response);
        let result = decode_json(response);
        self.trace_http(
            "start_deployment",
            "POST",
            &url,
            request_trace.as_ref(),
            started,
            Some(status),
            headers,
            result.as_ref().map(|_| ()),
        );
        result
    }

    pub fn stop_deployment(&self, deployment_id: &str) -> Result<Deployment, HyperCliError> {
        let url = self.endpoint(&format!("deployments/{deployment_id}/stop"));
        let started = Instant::now();
        let response = match self
            .http
            .post(&url)
            .bearer_auth(self.api_key.expose_secret())
            .send()
        {
            Ok(response) => response,
            Err(error) => {
                let error = HyperCliError::Transport(error.to_string());
                self.trace_http(
                    "stop_deployment",
                    "POST",
                    &url,
                    None,
                    started,
                    None,
                    BTreeMap::new(),
                    Err(&error),
                );
                return Err(error);
            }
        };
        let status = response.status();
        let headers = trace_headers(&response);
        let result = decode_json(response);
        self.trace_http(
            "stop_deployment",
            "POST",
            &url,
            None,
            started,
            Some(status),
            headers,
            result.as_ref().map(|_| ()),
        );
        result
    }

    /// Archive durable storage without launching the deployment.
    pub fn archive_deployment(&self, deployment_id: &str) -> Result<Deployment, HyperCliError> {
        let url = self.endpoint(&format!("deployments/{deployment_id}/archive"));
        self.send_json(
            "archive_deployment",
            "POST",
            &url,
            None,
            self.http
                .post(&url)
                .bearer_auth(self.api_key.expose_secret()),
        )
    }

    /// Restore durable storage for a stopped or archived deployment.
    pub fn restore_deployment(&self, deployment_id: &str) -> Result<Deployment, HyperCliError> {
        let url = self.endpoint(&format!("deployments/{deployment_id}/restore"));
        self.send_json(
            "restore_deployment",
            "POST",
            &url,
            None,
            self.http
                .post(&url)
                .bearer_auth(self.api_key.expose_secret()),
        )
    }

    /// Permanently remove a stopped deployment. The API enforces the stopped
    /// precondition; callers should still reflect it in their UI.
    pub fn delete_deployment(
        &self,
        deployment_id: &str,
    ) -> Result<DeleteDeploymentResponse, HyperCliError> {
        let url = self.endpoint(&format!("deployments/{deployment_id}"));
        self.send_json(
            "delete_deployment",
            "DELETE",
            &url,
            None,
            self.http
                .delete(&url)
                .bearer_auth(self.api_key.expose_secret()),
        )
    }

    pub fn get_deployment_routes(
        &self,
        deployment_id: &str,
    ) -> Result<DeploymentRoutes, HyperCliError> {
        let url = self.endpoint(&format!("deployments/{deployment_id}/routes"));
        self.send_json(
            "get_deployment_routes",
            "GET",
            &url,
            None,
            self.http
                .get(&url)
                .bearer_auth(self.api_key.expose_secret()),
        )
    }

    pub fn set_deployment_routes(
        &self,
        deployment_id: &str,
        request: &SetDeploymentRoutesRequest,
    ) -> Result<DeploymentRoutes, HyperCliError> {
        let url = self.endpoint(&format!("deployments/{deployment_id}/routes"));
        self.send_json(
            "set_deployment_routes",
            "PUT",
            &url,
            serde_json::to_value(request).ok(),
            self.http
                .put(&url)
                .bearer_auth(self.api_key.expose_secret())
                .json(request),
        )
    }

    pub fn set_deployment_route(
        &self,
        deployment_id: &str,
        route_name: &str,
        request: &SetDeploymentRouteRequest,
    ) -> Result<DeploymentRoutes, HyperCliError> {
        let encoded_name: String = url::form_urlencoded::byte_serialize(route_name.as_bytes())
            .collect::<String>()
            .replace('+', "%20");
        let url = self.endpoint(&format!(
            "deployments/{deployment_id}/routes/{encoded_name}"
        ));
        self.send_json(
            "set_deployment_route",
            "PUT",
            &url,
            serde_json::to_value(request).ok(),
            self.http
                .put(&url)
                .bearer_auth(self.api_key.expose_secret())
                .json(request),
        )
    }

    pub fn remove_deployment_route(
        &self,
        deployment_id: &str,
        route_name: &str,
    ) -> Result<DeploymentRoutes, HyperCliError> {
        let encoded_name: String = url::form_urlencoded::byte_serialize(route_name.as_bytes())
            .collect::<String>()
            .replace('+', "%20");
        let url = self.endpoint(&format!(
            "deployments/{deployment_id}/routes/{encoded_name}"
        ));
        let builder = self
            .http
            .delete(&url)
            .bearer_auth(self.api_key.expose_secret());
        self.send_json("remove_deployment_route", "DELETE", &url, None, builder)
    }

    pub async fn exec_deployment(
        &self,
        deployment_id: &str,
        request: &ExecDeploymentRequest,
    ) -> Result<ExecDeploymentResponse, HyperCliError> {
        let command = &request.command;
        if command.is_empty()
            || command[0].is_empty()
            || command.iter().any(|argument| argument.contains('\0'))
            || command.iter().map(|argument| argument.len()).sum::<usize>() > 65_536
            || !(1..=300).contains(&request.timeout)
        {
            return Err(HyperCliError::InvalidResponse(
                "invalid exec request".into(),
            ));
        }
        let v = self
            .one_shot(
                deployment_id,
                "exec",
                Some(json!({
                    "command": command,
                    "timeout": request.timeout,
                    "dry_run": request.dry_run,
                })),
                Duration::from_secs(u64::from(request.timeout) + 10),
            )
            .await?;
        let o = v
            .as_object()
            .ok_or_else(|| HyperCliError::InvalidResponse("invalid exec frame".into()))?;
        if o.len() == 3
            && o.get("event") == Some(&json!("agent_exec_result"))
            && o.get("ok") == Some(&json!(false))
        {
            if let Some(error) = o
                .get("error")
                .and_then(Value::as_str)
                .filter(|v| !v.is_empty())
            {
                return Err(HyperCliError::InvalidResponse(error.into()));
            }
        }
        if o.len() != 5
            || o.get("event") != Some(&json!("agent_exec_result"))
            || o.get("ok") != Some(&json!(true))
        {
            return Err(HyperCliError::InvalidResponse("invalid exec frame".into()));
        }
        Ok(ExecDeploymentResponse {
            exit_code: i32::try_from(
                o.get("exit_code")
                    .and_then(Value::as_i64)
                    .ok_or_else(|| HyperCliError::InvalidResponse("invalid exec frame".into()))?,
            )
            .map_err(|e| HyperCliError::InvalidResponse(e.to_string()))?,
            stdout: o
                .get("stdout")
                .and_then(Value::as_str)
                .ok_or_else(|| HyperCliError::InvalidResponse("invalid exec frame".into()))?
                .into(),
            stderr: o
                .get("stderr")
                .and_then(Value::as_str)
                .ok_or_else(|| HyperCliError::InvalidResponse("invalid exec frame".into()))?
                .into(),
            dry_run: request.dry_run,
        })
    }

    /// Read the normalized native-login state from the image-owned wrapper.
    ///
    /// The command is fixed by the SDK rather than accepted from the caller.
    /// This keeps Desktop's login UI separate from the arbitrary exec surface.
    pub async fn runtime_auth_status(
        &self,
        deployment_id: &str,
    ) -> Result<RuntimeAuthStatus, RuntimeAuthError> {
        let mut request = ExecDeploymentRequest::new(auth_status_command());
        request.timeout = 15;
        let response = self.exec_deployment(deployment_id, &request).await?;
        if response.exit_code != 0 {
            return Err(RuntimeAuthError::StatusCommandFailed(response.exit_code));
        }
        RuntimeAuthStatus::parse(&response.stdout)
    }

    /// Mint a short-lived token for the backend's protected agent PTY.
    ///
    /// The returned JWT is opaque and intentionally unavailable to callers;
    /// pass the token directly to [`RuntimeLoginSession::connect`] through
    /// [`Self::start_runtime_login`].
    pub fn create_runtime_shell_token(
        &self,
        deployment_id: &str,
        shell: Option<&str>,
    ) -> Result<RuntimeShellToken, RuntimeAuthError> {
        let url = self.endpoint(&format!("deployments/{deployment_id}/shell/token"));
        let request = json!({"shell": shell.unwrap_or("/bin/bash")});
        let builder = self
            .http
            .post(&url)
            .bearer_auth(self.api_key.expose_secret())
            .json(&request);
        let response: RuntimeShellTokenResponse = self.send_json(
            "create_runtime_shell_token",
            "POST",
            &url,
            Some(request),
            builder,
        )?;
        let token = response.into_token()?;
        // No `self` escape hatch: the backend's shell-token route binds
        // `agent_id` to a UUID path parameter, so "self" never reaches it and
        // skipping the identity check for it would only weaken this guard.
        if token.agent_id != deployment_id || token.dry_run {
            return Err(RuntimeAuthError::InvalidShellToken);
        }
        Ok(token)
    }

    /// Start the fixed native-login wrapper in an authenticated remote PTY.
    pub async fn start_runtime_login(
        &self,
        deployment_id: &str,
        runtime: NativeRuntime,
        challenge_timeout: std::time::Duration,
    ) -> Result<RuntimeLoginSession, RuntimeAuthError> {
        let token = self.create_runtime_shell_token(deployment_id, Some("/bin/bash"))?;
        RuntimeLoginSession::connect(token, runtime, challenge_timeout).await
    }

    /// Resolve the auth context for the configured credential
    /// (`GET {product}/api/auth/me`). Includes the key's `capabilities`.
    pub fn auth_me(&self) -> Result<AuthMe, HyperCliError> {
        let url = self.product_endpoint("api/auth/me");
        let builder = self
            .http
            .get(&url)
            .bearer_auth(self.api_key.expose_secret());
        self.send_json("auth_me", "GET", &url, None, builder)
    }

    /// Resolve the agent product's own view of the presented credential
    /// (`GET {agents}/deployments/auth/me`).
    ///
    /// Distinct from [`Self::auth_me`], which asks the product API. This is the
    /// only introspection that reports `agent_id`: the one Agent a runtime key
    /// speaks for. It returns only what the credential already carries, so it
    /// is unscoped and safe for any caller.
    pub fn agent_access_identity(&self) -> Result<AgentAccessIdentity, HyperCliError> {
        let url = self.endpoint("deployments/auth/me");
        let builder = self
            .http
            .get(&url)
            .bearer_auth(self.api_key.expose_secret());
        self.send_json("agent_access_identity", "GET", &url, None, builder)
    }

    /// Create an API key (`POST {product}/api/keys` — the same endpoint the
    /// dashboard's ApiKeysManager uses). The bearer credential may be a
    /// web-login session token rather than an existing API key. `tags` are
    /// scope grants (e.g. "agents"): keys are deny-by-default without them.
    /// The full key material is returned only by this call.
    pub fn create_api_key(&self, request: &CreateApiKeyRequest) -> Result<ApiKey, HyperCliError> {
        let url = self.product_endpoint("api/keys");
        let trace_request = serde_json::to_value(request).ok();
        let builder = self
            .http
            .post(&url)
            .bearer_auth(self.api_key.expose_secret())
            .json(request);
        self.send_json("create_api_key", "POST", &url, trace_request, builder)
    }

    /// The product API base is the agents base without its `/agents` suffix
    /// (the inverse of `normalize_agents_api_base`).
    pub fn product_api_base(&self) -> String {
        let base = self.api_base.as_str().trim_end_matches('/');
        base.strip_suffix("/agents").unwrap_or(base).to_owned()
    }

    fn product_endpoint(&self, path: &str) -> String {
        format!(
            "{}/{}",
            self.product_api_base(),
            path.trim_start_matches('/')
        )
    }

    fn product_ws_url(&self, path_segments: &[&str]) -> Result<Url, HyperCliError> {
        let mut url = Url::parse(&self.product_api_base())
            .map_err(|error| HyperCliError::InvalidResponse(error.to_string()))?;
        let scheme = match url.scheme() {
            "https" => "wss",
            "http" => "ws",
            other => other,
        }
        .to_owned();
        url.set_scheme(&scheme)
            .map_err(|_| HyperCliError::InvalidResponse("invalid websocket scheme".to_owned()))?;
        {
            let mut segments = url
                .path_segments_mut()
                .map_err(|_| HyperCliError::InvalidResponse("invalid websocket URL".to_owned()))?;
            for segment in path_segments {
                segments.push(segment);
            }
        }
        Ok(url)
    }

    fn send_json<T: DeserializeOwned>(
        &self,
        operation: &str,
        method: &str,
        url: &str,
        request: Option<Value>,
        builder: RequestBuilder,
    ) -> Result<T, HyperCliError> {
        let started = Instant::now();
        let response = match builder.send() {
            Ok(response) => response,
            Err(error) => {
                let error = HyperCliError::Transport(error.to_string());
                self.trace_http(
                    operation,
                    method,
                    url,
                    request.as_ref(),
                    started,
                    None,
                    BTreeMap::new(),
                    Err(&error),
                );
                return Err(error);
            }
        };
        let status = response.status();
        let headers = trace_headers(&response);
        let result = decode_json(response);
        self.trace_http(
            operation,
            method,
            url,
            request.as_ref(),
            started,
            Some(status),
            headers,
            result.as_ref().map(|_| ()),
        );
        result
    }

    #[allow(clippy::too_many_arguments)]
    fn trace_http(
        &self,
        operation: &str,
        method: &str,
        url: &str,
        request: Option<&Value>,
        started: Instant,
        status: Option<StatusCode>,
        response_headers: BTreeMap<String, String>,
        result: Result<(), &HyperCliError>,
    ) {
        let Some(path) = self.trace_file.as_deref() else {
            return;
        };
        let (outcome, error) = match result {
            Ok(_) => ("success", None),
            Err(error) => (error.outcome(), Some(error.to_string())),
        };
        let event = json!({
            "timestamp_unix_ms": unix_timestamp_ms(),
            "pid": std::process::id(),
            "operation": operation,
            "method": method,
            "url": url,
            "request": request.map(redact_value),
            "response": {
                "status": status.map(|value| value.as_u16()),
                "headers": response_headers,
                "body": "<omitted: may contain secrets>"
            },
            "duration_ms": started.elapsed().as_millis(),
            "outcome": outcome,
            "error": error
        });
        append_trace(path, &event);
    }
}

impl HyperCliError {
    fn outcome(&self) -> &'static str {
        match self {
            Self::Transport(_) => "transport_error",
            Self::Status(_) => "http_error",
            Self::InvalidResponse(_) => "decode_error",
        }
    }
}

fn decode_json<T: serde::de::DeserializeOwned>(
    response: reqwest::blocking::Response,
) -> Result<T, HyperCliError> {
    let status = response.status();
    if !status.is_success() {
        // Do not include the response body: upstream failures can echo launch
        // environment values, including the Buzz agent nsec.
        return Err(HyperCliError::Status(status));
    }
    let body = response
        .text()
        .map_err(|error| HyperCliError::InvalidResponse(error.to_string()))?;
    match serde_json::from_str::<serde_json::Value>(&body) {
        // Valid JSON of the wrong shape: report the serde error and the
        // top-level field NAMES only — values may contain key material.
        Ok(value) => serde_json::from_value(value.clone()).map_err(|error| {
            let shape = match &value {
                serde_json::Value::Object(map) => {
                    let keys: Vec<&str> = map.keys().map(String::as_str).collect();
                    format!("object with fields [{}]", keys.join(", "))
                }
                serde_json::Value::Array(items) => format!("array of {} items", items.len()),
                other => format!("JSON {}", json_type_name(other)),
            };
            HyperCliError::InvalidResponse(format!("{error}; response was {shape}"))
        }),
        // Not JSON at all (HTML error page, redirect target, plain text):
        // a short snippet is safe and is the only way to see what happened.
        Err(error) => {
            let snippet: String = body.chars().take(160).collect();
            Err(HyperCliError::InvalidResponse(format!(
                "{error}; body starts with {snippet:?}"
            )))
        }
    }
}

fn json_type_name(value: &serde_json::Value) -> &'static str {
    match value {
        serde_json::Value::Null => "null",
        serde_json::Value::Bool(_) => "boolean",
        serde_json::Value::Number(_) => "number",
        serde_json::Value::String(_) => "string",
        serde_json::Value::Array(_) => "array",
        serde_json::Value::Object(_) => "object",
    }
}

fn trace_headers(response: &reqwest::blocking::Response) -> BTreeMap<String, String> {
    const SAFE_HEADERS: [&str; 4] = [
        "content-type",
        "content-length",
        "x-request-id",
        "traceparent",
    ];
    SAFE_HEADERS
        .into_iter()
        .filter_map(|name| {
            response
                .headers()
                .get(name)
                .and_then(|value| value.to_str().ok())
                .map(|value| (name.to_owned(), value.to_owned()))
        })
        .collect()
}

fn redact_value(value: &Value) -> Value {
    match value {
        Value::Object(values) => Value::Object(
            values
                .iter()
                .map(|(key, value)| {
                    let value = if is_secret_key(key) {
                        Value::String("<redacted>".to_owned())
                    } else {
                        redact_value(value)
                    };
                    (key.clone(), value)
                })
                .collect(),
        ),
        Value::Array(values) => Value::Array(values.iter().map(redact_value).collect()),
        _ => value.clone(),
    }
}

fn is_secret_key(key: &str) -> bool {
    let normalized: String = key
        .chars()
        .filter(|character| character.is_ascii_alphanumeric())
        .flat_map(char::to_lowercase)
        .collect();
    [
        "key",
        "token",
        "secret",
        "password",
        "authorization",
        "credential",
        "auth",
        "nsec",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
}

fn unix_timestamp_ms() -> u128 {
    SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .unwrap_or_default()
        .as_millis()
}

fn append_trace(path: &Path, event: &impl Serialize) {
    let Some(parent) = path.parent() else {
        return;
    };
    if fs::create_dir_all(parent).is_err() {
        return;
    }
    #[cfg(unix)]
    let _ = fs::set_permissions(parent, fs::Permissions::from_mode(0o700));

    let mut options = OpenOptions::new();
    options.create(true).append(true);
    #[cfg(unix)]
    options.mode(0o600);
    let Ok(mut file) = options.open(path) else {
        return;
    };
    #[cfg(unix)]
    let _ = file.set_permissions(fs::Permissions::from_mode(0o600));
    if serde_json::to_writer(&mut file, event).is_ok() {
        let _ = file.write_all(b"\n");
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::{AgentSize, CompleteDeploymentLaunchConfig, ManagedRuntime};
    use mockito::{Matcher, Server};
    use secrecy::SecretString;
    use std::sync::{Arc, Mutex};
    use tokio::net::TcpListener;
    use tokio_tungstenite::{accept_async, accept_hdr_async};

    fn client(server: &Server) -> HyperCliClient {
        HyperCliClient::new(ClientConfig {
            api_base: Url::parse(&format!("{}/agents", server.url())).unwrap(),
            api_key: SecretString::from("test-credential"),
            trace_file: None,
        })
        .unwrap()
    }
    fn complete_start() -> StartDeploymentRequest {
        StartDeploymentRequest::new(CompleteDeploymentLaunchConfig {
            sync_exclude: Some(Vec::new()),
            ..Default::default()
        })
    }

    #[test]
    fn deployment_event_errors_only_stop_retries_for_auth_failures() {
        assert!(!permanent_deployment_event_error(&HyperCliError::Status(
            StatusCode::NOT_FOUND
        )));
        assert!(permanent_deployment_event_error(&HyperCliError::Status(
            StatusCode::UNAUTHORIZED
        )));
        assert!(permanent_deployment_event_error(&HyperCliError::Status(
            StatusCode::FORBIDDEN
        )));
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn deployment_subscription_retries_not_found_token_route() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let ws_url = format!("ws://{}/ws/deployments", listener.local_addr().unwrap());
        let websocket = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            let auth = socket.next().await.unwrap().unwrap();
            let Message::Text(auth) = auth else {
                panic!("expected auth text")
            };
            assert_eq!(
                serde_json::from_str::<Value>(auth.as_ref()).unwrap(),
                json!({"type": "auth", "token": "event-token"})
            );
            socket
                .send(Message::Text(json!({"type": "ready"}).to_string().into()))
                .await
                .unwrap();
            socket
                .send(Message::Text(
                    json!({
                        "type": "deployment.transition",
                        "agent_id": "deployment-1",
                        "state": "RUNNING"
                    })
                    .to_string()
                    .into(),
                ))
                .await
                .unwrap();
            tokio::time::sleep(Duration::from_secs(2)).await;
        });

        let mut server = Server::new_async().await;
        let missing_token_route = server
            .mock("POST", "/agents/deployments/events/token")
            .match_header("authorization", "Bearer test-credential")
            .with_status(404)
            .expect(1)
            .create_async()
            .await;
        let token = server
            .mock("POST", "/agents/deployments/events/token")
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"token": "event-token", "ws_url": ws_url}).to_string())
            .expect(1)
            .create_async()
            .await;
        let received_at = Arc::new(Mutex::new(None));
        let captured = Arc::clone(&received_at);
        let api_base = Url::parse(&format!("{}/agents", server.url())).unwrap();
        let event_client = tokio::task::spawn_blocking(move || {
            HyperCliClient::new(ClientConfig {
                api_base,
                api_key: SecretString::from("test-credential"),
                trace_file: None,
            })
            .unwrap()
        })
        .await
        .unwrap();
        let started_at = Instant::now();
        {
            let subscription = event_client.subscribe_deployments(move |_| {
                *captured.lock().unwrap() = Some(Instant::now());
            });
            tokio::pin!(subscription);
            tokio::time::timeout(Duration::from_secs(1), async {
                loop {
                    tokio::select! {
                        result = &mut subscription => panic!("subscription ended unexpectedly: {result:?}"),
                        _ = tokio::time::sleep(Duration::from_millis(10)) => {}
                    }
                    if received_at.lock().unwrap().is_some() {
                        break;
                    }
                }
            })
            .await
            .expect("subscription did not retry the missing token route");
        }

        let observed_at = received_at.lock().unwrap().unwrap();
        assert!(
            observed_at.duration_since(started_at) >= Duration::from_millis(200),
            "404 token route retried without backoff"
        );
        websocket.abort();
        let _ = websocket.await;
        missing_token_route.assert_async().await;
        token.assert_async().await;
        drop(missing_token_route);
        drop(token);
        tokio::task::spawn_blocking(move || {
            drop(event_client);
            drop(server);
        })
        .await
        .unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn deployment_subscription_sends_auth_and_delivers_flat_transition() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let ws_url = format!("ws://{}/ws/deployments", listener.local_addr().unwrap());
        let websocket = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            let auth = socket.next().await.unwrap().unwrap();
            let Message::Text(auth) = auth else {
                panic!("expected auth text")
            };
            assert_eq!(
                serde_json::from_str::<Value>(auth.as_ref()).unwrap(),
                json!({"type": "auth", "token": "event-token"})
            );
            socket
                .send(Message::Text(json!({"type": "ready"}).to_string().into()))
                .await
                .unwrap();
            socket
                .send(Message::Text(
                    json!({
                        "type": "deployment.transition",
                        "agent_id": "deployment-1",
                        "state": "RUNNING",
                        "reason": "start",
                        "error": null,
                        "message": "Agent is running",
                        "launch_epoch": 3
                    })
                    .to_string()
                    .into(),
                ))
                .await
                .unwrap();
            tokio::time::sleep(Duration::from_secs(1)).await;
            let _ = socket.close(None).await;
        });

        let mut server = Server::new_async().await;
        let token = server
            .mock("POST", "/agents/deployments/events/token")
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"token": "event-token", "ws_url": ws_url}).to_string())
            .create_async()
            .await;
        let received = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&received);
        let api_base = Url::parse(&format!("{}/agents", server.url())).unwrap();
        let event_client = tokio::task::spawn_blocking(move || {
            HyperCliClient::new(ClientConfig {
                api_base,
                api_key: SecretString::from("test-credential"),
                trace_file: None,
            })
            .unwrap()
        })
        .await
        .unwrap();
        let result = tokio::time::timeout(
            Duration::from_millis(500),
            event_client.subscribe_deployments(move |event| {
                captured.lock().unwrap().push(event);
            }),
        )
        .await;

        assert!(result.is_err());
        websocket.await.unwrap();
        {
            let received = received.lock().unwrap();
            assert_eq!(received[0].agent_id, "deployment-1");
            assert_eq!(received[0].reason.as_deref(), Some("start"));
            assert_eq!(received[0].error, None);
            assert_eq!(received[0].message.as_deref(), Some("Agent is running"));
            assert_eq!(received[0].launch_epoch, Some(3));
        }
        token.assert_async().await;
        drop(token);
        tokio::task::spawn_blocking(move || {
            drop(event_client);
            drop(server);
        })
        .await
        .unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn deployment_subscription_clean_close_backs_off_before_reconnect() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let ws_url = format!("ws://{}/ws/deployments", listener.local_addr().unwrap());
        let websocket = tokio::spawn(async move {
            for attempt in 0..2 {
                let (stream, _) = listener.accept().await.unwrap();
                let mut socket = accept_async(stream).await.unwrap();
                let auth = socket.next().await.unwrap().unwrap();
                let Message::Text(auth) = auth else {
                    panic!("expected auth text")
                };
                assert_eq!(
                    serde_json::from_str::<Value>(auth.as_ref()).unwrap(),
                    json!({"type": "auth", "token": "event-token"})
                );
                socket
                    .send(Message::Text(json!({"type": "ready"}).to_string().into()))
                    .await
                    .unwrap();
                if attempt == 0 {
                    socket.close(None).await.unwrap();
                    continue;
                }
                socket
                    .send(Message::Text(
                        json!({
                            "type": "deployment.transition",
                            "agent_id": "deployment-1",
                            "state": "RUNNING",
                            "launch_epoch": 3
                        })
                        .to_string()
                        .into(),
                    ))
                    .await
                    .unwrap();
                tokio::time::sleep(Duration::from_secs(2)).await;
            }
        });

        let mut server = Server::new_async().await;
        let token = server
            .mock("POST", "/agents/deployments/events/token")
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"token": "event-token", "ws_url": ws_url}).to_string())
            .expect(2)
            .create_async()
            .await;
        let received = Arc::new(Mutex::new(Vec::new()));
        let captured = Arc::clone(&received);
        let api_base = Url::parse(&format!("{}/agents", server.url())).unwrap();
        let event_client = tokio::task::spawn_blocking(move || {
            HyperCliClient::new(ClientConfig {
                api_base,
                api_key: SecretString::from("test-credential"),
                trace_file: None,
            })
            .unwrap()
        })
        .await
        .unwrap();
        {
            let started_at = Instant::now();
            let subscription = event_client.subscribe_deployments(move |event| {
                captured.lock().unwrap().push((event, Instant::now()));
            });
            tokio::pin!(subscription);

            tokio::time::timeout(Duration::from_secs(1), async {
                loop {
                    tokio::select! {
                        result = &mut subscription => panic!("subscription ended unexpectedly: {result:?}"),
                        _ = tokio::time::sleep(Duration::from_millis(10)) => {}
                    }
                    if !received.lock().unwrap().is_empty() {
                        break;
                    }
                }
            })
            .await
            .expect("subscription did not reconnect after clean close");

            let received = received.lock().unwrap();
            assert_eq!(received[0].0.event_type, "deployment.transition");
            assert!(
                received[0].1.duration_since(started_at) >= Duration::from_millis(200),
                "clean close reconnected without backoff"
            );
        }
        websocket.abort();
        let _ = websocket.await;
        token.assert_async().await;
        drop(token);
        tokio::task::spawn_blocking(move || {
            drop(event_client);
            drop(server);
        })
        .await
        .unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn wait_deployment_state_answers_ping_without_disconnecting() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let ws_url = format!("ws://{}/ws/deployments", listener.local_addr().unwrap());
        let websocket = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            let auth = socket.next().await.unwrap().unwrap();
            let Message::Text(auth) = auth else {
                panic!("expected auth text")
            };
            assert_eq!(
                serde_json::from_str::<Value>(auth.as_ref()).unwrap(),
                json!({"type": "auth", "token": "event-token"})
            );
            socket
                .send(Message::Text(json!({"type": "ready"}).to_string().into()))
                .await
                .unwrap();
            socket
                .send(Message::Ping(b"keepalive".to_vec().into()))
                .await
                .unwrap();
            let pong = tokio::time::timeout(Duration::from_secs(1), socket.next())
                .await
                .expect("client did not answer ping")
                .expect("client disconnected before pong")
                .unwrap();
            assert_eq!(pong, Message::Pong(b"keepalive".to_vec().into()));
            socket
                .send(Message::Text(
                    json!({
                        "type": "deployment.transition",
                        "agent_id": "deployment-1",
                        "state": "RUNNING",
                        "launch_epoch": 3
                    })
                    .to_string()
                    .into(),
                ))
                .await
                .unwrap();
            tokio::time::sleep(Duration::from_millis(100)).await;
        });

        let mut server = Server::new_async().await;
        let initial_state = server
            .mock("GET", "/agents/deployments/deployment-1")
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"id": "deployment-1", "state": "STARTING"}).to_string())
            .expect(1)
            .create_async()
            .await;
        let running_state = server
            .mock("GET", "/agents/deployments/deployment-1")
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"id": "deployment-1", "state": "RUNNING"}).to_string())
            .create_async()
            .await;
        let token = server
            .mock("POST", "/agents/deployments/events/token")
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"token": "event-token", "ws_url": ws_url}).to_string())
            .create_async()
            .await;
        let api_base = Url::parse(&format!("{}/agents", server.url())).unwrap();
        let event_client = tokio::task::spawn_blocking(move || {
            HyperCliClient::new(ClientConfig {
                api_base,
                api_key: SecretString::from("test-credential"),
                trace_file: None,
            })
            .unwrap()
        })
        .await
        .unwrap();

        assert_eq!(DEFAULT_HOSTNAME_SETTLE_DELAY, Duration::from_secs(15));
        let deployment = event_client
            .wait_deployment_running_settled(
                "deployment-1",
                Duration::from_secs(2),
                Some(Duration::ZERO),
            )
            .await
            .unwrap();

        assert_eq!(deployment.state, "RUNNING");
        websocket.await.unwrap();
        initial_state.assert_async().await;
        running_state.assert_async().await;
        token.assert_async().await;
        drop(initial_state);
        drop(running_state);
        drop(token);
        tokio::task::spawn_blocking(move || {
            drop(event_client);
            drop(server);
        })
        .await
        .unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn wait_deployment_state_reconciles_when_transition_event_is_missed() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let ws_url = format!("ws://{}/ws/deployments", listener.local_addr().unwrap());
        let websocket = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            let _auth = socket.next().await.unwrap().unwrap();
            socket
                .send(Message::Text(json!({"type": "ready"}).to_string().into()))
                .await
                .unwrap();
            tokio::time::sleep(Duration::from_millis(100)).await;
        });

        let mut server = Server::new_async().await;
        let initial_state = server
            .mock("GET", "/agents/deployments/deployment-1")
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"id": "deployment-1", "state": "STARTING"}).to_string())
            .expect(1)
            .create_async()
            .await;
        let running_state = server
            .mock("GET", "/agents/deployments/deployment-1")
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"id": "deployment-1", "state": "RUNNING"}).to_string())
            .expect(1)
            .create_async()
            .await;
        let token = server
            .mock("POST", "/agents/deployments/events/token")
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"token": "event-token", "ws_url": ws_url}).to_string())
            .expect(1)
            .create_async()
            .await;
        let api_base = Url::parse(&format!("{}/agents", server.url())).unwrap();
        let event_client = tokio::task::spawn_blocking(move || {
            HyperCliClient::new(ClientConfig {
                api_base,
                api_key: SecretString::from("test-credential"),
                trace_file: None,
            })
            .unwrap()
        })
        .await
        .unwrap();

        let deployment = event_client
            .wait_deployment_state_with_poll_interval(
                "deployment-1",
                &["RUNNING"],
                &["STOPPED", "FAILED"],
                Duration::from_secs(1),
                Duration::from_millis(20),
            )
            .await
            .unwrap();

        assert_eq!(deployment.state, "RUNNING");
        websocket.await.unwrap();
        initial_state.assert_async().await;
        running_state.assert_async().await;
        token.assert_async().await;
        drop(initial_state);
        drop(running_state);
        drop(token);
        tokio::task::spawn_blocking(move || {
            drop(event_client);
            drop(server);
        })
        .await
        .unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn wait_deployment_running_fails_promptly_when_already_stopped() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let ws_url = format!("ws://{}/ws/deployments", listener.local_addr().unwrap());
        let websocket = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            let mut socket = accept_async(stream).await.unwrap();
            let _auth = socket.next().await.unwrap().unwrap();
            socket
                .send(Message::Text(json!({"type": "ready"}).to_string().into()))
                .await
                .unwrap();
        });
        let mut server = Server::new_async().await;
        let stopped = server
            .mock("GET", "/agents/deployments/deployment-1")
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "id": "deployment-1",
                    "state": "STOPPED",
                    "message": "Runtime stopped before becoming ready"
                })
                .to_string(),
            )
            .expect(1)
            .create_async()
            .await;
        let token = server
            .mock("POST", "/agents/deployments/events/token")
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"token": "event-token", "ws_url": ws_url}).to_string())
            .expect(1)
            .create_async()
            .await;
        let api_base = Url::parse(&format!("{}/agents", server.url())).unwrap();
        let event_client = tokio::task::spawn_blocking(move || {
            HyperCliClient::new(ClientConfig {
                api_base,
                api_key: SecretString::from("test-credential"),
                trace_file: None,
            })
            .unwrap()
        })
        .await
        .unwrap();

        let error = event_client
            .wait_deployment_running("deployment-1", Duration::from_secs(1))
            .await
            .unwrap_err();

        assert!(error.to_string().contains("entered STOPPED"));
        websocket.abort();
        stopped.assert_async().await;
        assert!(!token.matched_async().await);
        drop(stopped);
        drop(token);
        tokio::task::spawn_blocking(move || {
            drop(event_client);
            drop(server);
        })
        .await
        .unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn wait_deployment_state_reconciles_when_event_subscription_is_unavailable() {
        let mut server = Server::new_async().await;
        let rest_calls = Arc::new(Mutex::new(0usize));
        let response_calls = Arc::clone(&rest_calls);
        let states = server
            .mock("GET", "/agents/deployments/deployment-1")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_chunked_body(move |writer| {
                let mut count = response_calls.lock().unwrap();
                let state = if *count == 0 { "STARTING" } else { "RUNNING" };
                *count += 1;
                writer.write_all(
                    json!({"id": "deployment-1", "state": state})
                        .to_string()
                        .as_bytes(),
                )
            })
            .expect(2)
            .create_async()
            .await;
        let token = server
            .mock("POST", "/agents/deployments/events/token")
            .with_status(503)
            .with_header("content-type", "application/json")
            .with_body(json!({"detail": "events unavailable"}).to_string())
            .expect(1)
            .create_async()
            .await;
        let api_base = Url::parse(&format!("{}/agents", server.url())).unwrap();
        let event_client = tokio::task::spawn_blocking(move || {
            HyperCliClient::new(ClientConfig {
                api_base,
                api_key: SecretString::from("test-credential"),
                trace_file: None,
            })
            .unwrap()
        })
        .await
        .unwrap();

        let deployment = event_client
            .wait_deployment_state_with_poll_interval(
                "deployment-1",
                &["RUNNING"],
                &["STOPPED", "FAILED"],
                Duration::from_secs(1),
                Duration::from_millis(20),
            )
            .await
            .unwrap();

        assert_eq!(deployment.state, "RUNNING");
        states.assert_async().await;
        token.assert_async().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn wait_deployment_state_accepts_every_canonical_transitional_state() {
        for state in ["CREATING", "STARTING", "RESTORING", "STOPPING", "ARCHIVING"] {
            let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
            let ws_url = format!("ws://{}/ws/deployments", listener.local_addr().unwrap());
            let websocket = tokio::spawn(async move {
                let (stream, _) = listener.accept().await.unwrap();
                let mut socket = accept_async(stream).await.unwrap();
                let _auth = socket.next().await.unwrap().unwrap();
                socket
                    .send(Message::Text(json!({"type": "ready"}).to_string().into()))
                    .await
                    .unwrap();
            });
            let mut server = Server::new_async().await;
            let observed = server
                .mock("GET", "/agents/deployments/deployment-1")
                .match_header("authorization", "Bearer test-credential")
                .with_status(200)
                .with_header("content-type", "application/json")
                .with_body(json!({"id": "deployment-1", "state": state}).to_string())
                .expect(1)
                .create_async()
                .await;
            let token = server
                .mock("POST", "/agents/deployments/events/token")
                .match_header("authorization", "Bearer test-credential")
                .with_status(200)
                .with_header("content-type", "application/json")
                .with_body(json!({"token": "event-token", "ws_url": ws_url}).to_string())
                .expect(1)
                .create_async()
                .await;
            let api_base = Url::parse(&format!("{}/agents", server.url())).unwrap();
            let event_client = tokio::task::spawn_blocking(move || {
                HyperCliClient::new(ClientConfig {
                    api_base,
                    api_key: SecretString::from("test-credential"),
                    trace_file: None,
                })
                .unwrap()
            })
            .await
            .unwrap();

            let deployment = event_client
                .wait_deployment_state(
                    "deployment-1",
                    &[state],
                    &["STOPPED", "FAILED"],
                    Duration::from_secs(1),
                )
                .await
                .unwrap();

            assert_eq!(deployment.state, state);
            websocket.abort();
            observed.assert_async().await;
            assert!(!token.matched_async().await);
            drop(observed);
            drop(token);
            tokio::task::spawn_blocking(move || {
                drop(event_client);
                drop(server);
            })
            .await
            .unwrap();
        }
    }

    #[test]
    fn deployment_wire_requires_exactly_one_sync_selector() {
        let mut request = CreateDeploymentRequest::new(ManagedRuntime::Codex);
        let defaulted = deployment_request_body(&request).unwrap();
        assert_eq!(defaulted["sync_exclude"], serde_json::json!([]));

        request.sync_exclude = Some(Vec::new());
        let without_root = deployment_request_body(&request).unwrap();
        assert!(without_root.get("sync_enabled").is_none());
        assert_eq!(without_root["sync_exclude"], serde_json::json!([]));

        request.sync_root = Some("/home/node".to_owned());
        request.sync_include = Some(vec![".codex".to_owned()]);
        assert!(matches!(
            deployment_request_body(&request),
            Err(HyperCliError::InvalidResponse(message))
                if message.contains("cannot carry both")
        ));

        request.sync_include = None;
        request.sync_exclude = Some(vec!["tmp/**".to_owned()]);
        let excluded = deployment_request_body(&request).unwrap();
        assert!(excluded.get("sync_include").is_none());
        assert_eq!(excluded["sync_exclude"], serde_json::json!(["tmp/**"]));

        request.sync_exclude = None;
        request.sync_include = Some(Vec::new());
        assert!(matches!(
            deployment_request_body(&request),
            Err(HyperCliError::InvalidResponse(message))
                if message.contains("sync_include must contain")
        ));

        request.sync_include = None;
        request.sync_exclude = Some(vec!["**".to_owned()]);
        assert!(matches!(
            deployment_request_body(&request),
            Err(HyperCliError::InvalidResponse(message))
                if message.contains("exclude the entire sync root")
        ));
        request.sync_exclude = Some(vec!["*".to_owned()]);
        assert!(matches!(
            deployment_request_body(&request),
            Err(HyperCliError::InvalidResponse(message))
                if message.contains("exclude the entire sync root")
        ));

        let missing = StartDeploymentRequest::new(CompleteDeploymentLaunchConfig::default());
        assert_eq!(
            deployment_request_body(&missing).unwrap()["launch_config"]["sync_exclude"],
            serde_json::json!([])
        );

        let launch = CompleteDeploymentLaunchConfig {
            sync_include: Some(vec!["src".into()]),
            sync_exclude: Some(vec!["tmp".into()]),
            ..Default::default()
        };
        assert!(deployment_request_body(&StartDeploymentRequest::new(launch)).is_err());
    }

    #[test]
    fn deployment_wire_rejects_the_uid_t_sentinel() {
        let mut create = CreateDeploymentRequest::new(ManagedRuntime::Opencode);
        create.sync_exclude = Some(Vec::new());
        create.sync_uid = Some(4_294_967_294);
        assert_eq!(
            deployment_request_body(&create).unwrap()["sync_uid"],
            4_294_967_294u64
        );

        create.sync_uid = Some(u32::MAX);
        assert!(matches!(
            deployment_request_body(&create),
            Err(HyperCliError::InvalidResponse(message))
                if message.contains("sync_uid")
        ));

        let launch = CompleteDeploymentLaunchConfig {
            sync_gid: Some(u32::MAX),
            sync_exclude: Some(Vec::new()),
            ..Default::default()
        };
        let start = StartDeploymentRequest::new(launch);
        assert!(matches!(
            deployment_request_body(&start),
            Err(HyperCliError::InvalidResponse(message))
                if message.contains("sync_gid")
        ));
    }

    #[test]
    fn create_uses_flat_typed_launch_contract_and_bearer_auth() {
        let mut server = Server::new();
        let mock = server
            .mock("POST", "/agents/deployments")
            .match_header("authorization", "Bearer test-credential")
            .match_body(Matcher::PartialJsonString(
                serde_json::json!({
                    "runtime": "opencode",
                    "size": "small",
                    "command": ["/usr/local/bin/buzz-acp"],
                    "secrets": {"BUZZ_PRIVATE_KEY": "nsec-secret"},
                    "sync_root": "/home/node"
                })
                .to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id": "deployment-1",
                    "name": "buzz-agent",
                    "runtime": "opencode",
                    "state": "CREATING"
                })
                .to_string(),
            )
            .create();
        let mut request = CreateDeploymentRequest::new(ManagedRuntime::Opencode);
        request.size = Some(AgentSize::Small);
        request.command = vec!["/usr/local/bin/buzz-acp".to_owned()];
        request
            .secrets
            .insert("BUZZ_PRIVATE_KEY".to_owned(), "nsec-secret".to_owned());
        request.sync_root = Some("/home/node".to_owned());
        request.sync_exclude = Some(Vec::new());
        let created = client(&server).create_deployment(&request).unwrap();

        assert_eq!(created.id, "deployment-1");
        assert_eq!(created.runtime, Some(ManagedRuntime::Opencode));
        assert_eq!(created.state, "CREATING");
        mock.assert();
    }

    #[test]
    fn list_filters_by_deterministic_handle() {
        let mut server = Server::new();
        let mock = server
            .mock("GET", "/agents/deployments")
            .match_header("authorization", "Bearer test-credential")
            .match_query(Matcher::UrlEncoded("handle".into(), "buzz-abc123".into()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "items": [{
                        "id": "deployment-1",
                        "handle": "buzz-abc123",
                        "runtime": "opencode",
                        "state": "running",
                        "tags": ["app=buzz", "buzz_agent=public-key"]
                    }],
                    "total_agents": 1,
                    "max_agents_per_account": 10,
                    "running_agents": 1,
                    "slots": {"large": {"granted": 3, "used": 1, "available": 2}},
                    "agent_slots": [{
                        "id": "slot-1",
                        "entitlement_id": "ent-1",
                        "plan_id": "pro",
                        "size": "large",
                        "agent_id": "deployment-1",
                        "occupied": true,
                        "expires_at": "2026-09-01T00:00:00Z"
                    }],
                    "pooled_tpd": 100000000
                })
                .to_string(),
            )
            .create();

        let capacity = client(&server)
            .list_deployments_by_handle_with_capacity("buzz-abc123")
            .unwrap();
        assert_eq!(capacity.items.len(), 1);
        assert_eq!(capacity.items[0].id, "deployment-1");
        assert!(capacity.items[0].is_buzz_managed());
        assert_eq!(capacity.max_agents_per_account, 10);
        assert_eq!(capacity.slots["large"].available, 2);
        assert_eq!(capacity.agent_slots[0].plan_id, "pro");
        assert_eq!(capacity.pooled_tpd, 100_000_000);
        mock.assert();
    }

    #[test]
    fn list_forwards_every_supported_deployment_filter() {
        let mut server = Server::new();
        let mock = server
            .mock("GET", "/agents/deployments")
            .match_header("authorization", "Bearer test-credential")
            .match_query(Matcher::AllOf(vec![
                Matcher::UrlEncoded("state".into(), "STOPPED".into()),
                Matcher::UrlEncoded("handle".into(), "relay-smoke".into()),
                Matcher::UrlEncoded("name".into(), "relay-agent".into()),
                Matcher::UrlEncoded("q".into(), "agent-id-prefix".into()),
                Matcher::UrlEncoded("include_deleted".into(), "true".into()),
            ]))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"items": []}"#)
            .create();

        let deployments = client(&server)
            .list_deployments_filtered(&DeploymentListFilters {
                state: Some("STOPPED".into()),
                handle: Some("relay-smoke".into()),
                name: Some("relay-agent".into()),
                query: Some("agent-id-prefix".into()),
                include_deleted: Some(true),
            })
            .unwrap();

        assert!(deployments.is_empty());
        mock.assert();
    }

    #[test]
    fn plan_and_entitlement_models_keep_plan_ids_open_and_slots_typed() {
        let mut server = Server::new();
        let plans = server
            .mock("GET", "/agents/plans")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"plans":[{"id":"solo","name":"Solo","price":39,"agents":1}]}"#)
            .create();
        let entitlements = server
            .mock("GET", "/agents/entitlements")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "effective_plan_id": "historical-plan",
                    "active_entitlement_count": 1,
                    "slot_inventory": {"medium": {"granted": 3, "used": 1, "available": 2}},
                    "agent_slots": [{
                        "id": "slot-1",
                        "entitlement_id": "ent-1",
                        "plan_id": "team",
                        "size": "medium",
                        "agent_id": null,
                        "occupied": false
                    }]
                })
                .to_string(),
            )
            .create();

        let client = client(&server);
        let catalog = client.plans().unwrap();
        assert_eq!(
            catalog[0].canonical_id(),
            Some(crate::HyperAgentCanonicalPlanId::Solo)
        );
        let summary = client.entitlements().unwrap();
        assert_eq!(summary.effective_plan_id, "historical-plan");
        assert_eq!(summary.agent_slots[0].size, "medium");
        assert!(summary.has_active_plan());
        plans.assert();
        entitlements.assert();
    }

    #[test]
    fn subscription_summary_treats_direct_entitlement_as_an_active_plan() {
        let mut server = Server::new();
        let summary = server
            .mock("GET", "/agents/subscriptions/summary")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "effective_plan_id": "team",
                    "active_subscription_count": 0,
                    "active_entitlement_count": 1,
                    "slot_inventory": {"medium": {"granted": 3, "used": 0, "available": 3}},
                    "agent_slots": [{
                        "id": "slot-activation-code",
                        "entitlement_id": "ent-activation-code",
                        "plan_id": "team",
                        "size": "medium",
                        "agent_id": null,
                        "occupied": false
                    }]
                })
                .to_string(),
            )
            .create();

        let entitlements = client(&server).entitlements_summary().unwrap();
        assert_eq!(entitlements.active_subscription_count, 0);
        assert_eq!(entitlements.active_entitlement_count, 1);
        assert_eq!(entitlements.agent_slots[0].size, "medium");
        assert!(entitlements.has_active_plan());
        summary.assert();
    }

    #[test]
    fn claim_trial_entitlement_posts_bodyless_and_decodes_entitlement() {
        let mut server = Server::new();
        let claim = server
            .mock("POST", "/agents/plans/trial")
            .match_header("authorization", "Bearer test-credential")
            .match_body(Matcher::Missing)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id": "ent-trial-1",
                    "user_id": "user-1",
                    "subscription_id": null,
                    "plan_id": "team",
                    "plan_name": "Team",
                    "provider": "TRIAL",
                    "status": "ACTIVE",
                    "starts_at": "2026-08-11T12:00:00Z",
                    "expires_at": "2026-08-18T12:00:00Z",
                    "slot_grants": {"medium": 3}
                })
                .to_string(),
            )
            .create();

        let entitlement = client(&server).claim_trial_entitlement().unwrap();
        assert_eq!(entitlement.id, "ent-trial-1");
        assert_eq!(entitlement.user_id, "user-1");
        assert_eq!(entitlement.plan_id, "team");
        assert_eq!(entitlement.provider, "TRIAL");
        assert_eq!(
            entitlement.starts_at.as_deref(),
            Some("2026-08-11T12:00:00Z")
        );
        assert_eq!(
            entitlement.expires_at.as_deref(),
            Some("2026-08-18T12:00:00Z")
        );
        assert_eq!(entitlement.slot_grants.get("medium"), Some(&3));
        claim.assert();
    }

    #[test]
    fn claim_trial_entitlement_preserves_conflict_status() {
        let mut server = Server::new();
        let claim = server
            .mock("POST", "/agents/plans/trial")
            .match_header("authorization", "Bearer test-credential")
            .match_body(Matcher::Missing)
            .with_status(409)
            .with_header("content-type", "application/json")
            .with_body(r#"{"detail":"trial_not_eligible"}"#)
            .create();

        let error = client(&server).claim_trial_entitlement().unwrap_err();
        assert_eq!(error.status(), Some(StatusCode::CONFLICT));
        claim.assert();
    }

    #[test]
    fn get_fetches_one_deployment_by_id() {
        let mut server = Server::new();
        let mock = server
            .mock("GET", "/agents/deployments/deployment-1")
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id": "deployment-1",
                    "handle": "buzz-abc123",
                    "runtime": "opencode",
                    "state": "restoring"
                })
                .to_string(),
            )
            .create();

        let deployment = client(&server).get_deployment("deployment-1").unwrap();
        assert_eq!(deployment.id, "deployment-1");
        assert_eq!(deployment.state, "restoring");
        mock.assert();
    }

    #[test]
    fn environment_and_secret_reads_use_narrow_authenticated_routes() {
        let mut server = Server::new();
        let env = server
            .mock("GET", "/agents/deployments/deployment-1/env")
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "agent_id": "deployment-1",
                    "env": {"EDITOR": "nvim"},
                    "launch_epoch": 4
                })
                .to_string(),
            )
            .create();
        let names = server
            .mock("GET", "/agents/deployments/deployment-1/secrets")
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "agent_id": "deployment-1",
                    "names": ["OPENCLAW_GATEWAY_TOKEN"],
                    "launch_epoch": 4
                })
                .to_string(),
            )
            .create();
        let secret = server
            .mock(
                "GET",
                "/agents/deployments/deployment-1/secrets/OPENCLAW_GATEWAY_TOKEN",
            )
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "agent_id": "deployment-1",
                    "key": "OPENCLAW_GATEWAY_TOKEN",
                    "value": "stable-token",
                    "launch_epoch": 4
                })
                .to_string(),
            )
            .create();

        let client = client(&server);
        assert_eq!(
            client.deployment_env("deployment-1").unwrap().env["EDITOR"],
            "nvim"
        );
        assert_eq!(
            client
                .deployment_secret_names("deployment-1")
                .unwrap()
                .names,
            vec!["OPENCLAW_GATEWAY_TOKEN"]
        );
        let revealed = client
            .deployment_secret("deployment-1", "OPENCLAW_GATEWAY_TOKEN")
            .unwrap();
        assert_eq!(revealed.value, "stable-token");
        assert_eq!(revealed.launch_epoch, 4);
        env.assert();
        names.assert();
        secret.assert();
    }

    #[test]
    fn get_trace_records_only_sanitized_request_metadata() {
        let mut server = Server::new();
        let temp = tempfile::tempdir().unwrap();
        let trace_file = temp.path().join("logs/http.jsonl");
        let mock = server
            .mock("GET", "/agents/deployments/deployment-1")
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_header("x-request-id", "request-123")
            .with_body(
                serde_json::json!({
                    "id": "deployment-1",
                    "runtime": "opencode",
                    "state": "running"
                })
                .to_string(),
            )
            .create();
        let client = HyperCliClient::new(ClientConfig {
            api_base: Url::parse(&format!("{}/agents", server.url())).unwrap(),
            api_key: SecretString::from("test-credential"),
            trace_file: Some(trace_file.clone()),
        })
        .unwrap();

        client.get_deployment("deployment-1").unwrap();

        let trace = fs::read_to_string(trace_file).unwrap();
        assert!(trace.contains(r#""operation":"get_deployment""#));
        assert!(trace.contains(r#""method":"GET""#));
        assert!(trace.contains(r#""status":200"#));
        assert!(trace.contains(r#""x-request-id":"request-123""#));
        assert!(!trace.contains("test-credential"));
        mock.assert();
    }

    #[test]
    fn stop_posts_to_deployment_stop_endpoint() {
        let mut server = Server::new();
        let mock = server
            .mock("POST", "/agents/deployments/deployment-1/stop")
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id": "deployment-1",
                    "runtime": "opencode",
                    "state": "stopping"
                })
                .to_string(),
            )
            .create();

        let stopped = client(&server).stop_deployment("deployment-1").unwrap();
        assert_eq!(stopped.id, "deployment-1");
        assert_eq!(stopped.state, "stopping");
        mock.assert();
    }

    #[test]
    fn archive_posts_bodyless_and_decodes_archiving() {
        let mut server = Server::new();
        let mock = server
            .mock("POST", "/agents/deployments/deployment-1/archive")
            .match_header("authorization", "Bearer test-credential")
            .match_body(Matcher::Missing)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id": "deployment-1",
                    "runtime": "openclaw",
                    "state": "ARCHIVING"
                })
                .to_string(),
            )
            .create();

        let archived = client(&server).archive_deployment("deployment-1").unwrap();
        assert_eq!(archived.id, "deployment-1");
        assert_eq!(archived.state, "ARCHIVING");
        mock.assert();
    }

    #[test]
    fn restore_posts_bodyless_and_decodes_restoring() {
        let mut server = Server::new();
        let mock = server
            .mock("POST", "/agents/deployments/deployment-1/restore")
            .match_header("authorization", "Bearer test-credential")
            .match_body(Matcher::Missing)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id": "deployment-1",
                    "runtime": "openclaw",
                    "state": "RESTORING"
                })
                .to_string(),
            )
            .create();

        let restored = client(&server).restore_deployment("deployment-1").unwrap();
        assert_eq!(restored.id, "deployment-1");
        assert_eq!(restored.state, "RESTORING");
        mock.assert();
    }

    #[test]
    fn delete_uses_deployment_endpoint_and_decodes_tombstone() {
        let mut server = Server::new();
        let mock = server
            .mock("DELETE", "/agents/deployments/deployment-1")
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "ok": true,
                    "id": "deployment-1",
                    "deleted_at": "2026-08-05T06:00:00Z"
                })
                .to_string(),
            )
            .create();

        let deleted = client(&server).delete_deployment("deployment-1").unwrap();
        assert!(deleted.ok);
        assert_eq!(deleted.id, "deployment-1");
        assert_eq!(deleted.deleted_at.as_deref(), Some("2026-08-05T06:00:00Z"));
        mock.assert();
    }

    #[test]
    fn start_posts_exact_complete_nested_launch_body() {
        let mut server = Server::new();
        let request = complete_start();
        let mock = server
            .mock("POST", "/agents/deployments/deployment-1/start")
            .match_header("authorization", "Bearer test-credential")
            .match_body(Matcher::JsonString(
                serde_json::to_string(&request).unwrap(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id": "deployment-1",
                    "runtime": "openclaw",
                    "state": "STARTING"
                })
                .to_string(),
            )
            .create();

        let deployment = client(&server)
            .start_deployment("deployment-1", &request)
            .unwrap();

        assert_eq!(deployment.state, "STARTING");
        mock.assert();
    }

    #[test]
    fn lifecycle_transition_api_matrix_has_no_implicit_calls() {
        let mut server = Server::new();
        let create = server
            .mock("POST", "/agents/deployments")
            .match_header("authorization", "Bearer test-credential")
            .match_body(Matcher::PartialJsonString(
                serde_json::json!({"runtime": "openclaw", "dry_run": false}).to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id": "deployment-1",
                    "runtime": "openclaw",
                    "state": "CREATING"
                })
                .to_string(),
            )
            .expect(1)
            .create();
        let start = server
            .mock("POST", "/agents/deployments/deployment-1/start")
            .match_body(Matcher::PartialJsonString(
                json!({"launch_config":{"restart":false}}).to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id": "deployment-1",
                    "runtime": "openclaw",
                    "state": "STARTING"
                })
                .to_string(),
            )
            .expect(1)
            .create();
        let stop = server
            .mock("POST", "/agents/deployments/deployment-1/stop")
            .match_body(Matcher::Missing)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id": "deployment-1",
                    "runtime": "openclaw",
                    "state": "STOPPING"
                })
                .to_string(),
            )
            .expect(1)
            .create();
        let archive = server
            .mock("POST", "/agents/deployments/deployment-1/archive")
            .match_body(Matcher::Missing)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id": "deployment-1",
                    "runtime": "openclaw",
                    "state": "ARCHIVING"
                })
                .to_string(),
            )
            .expect(1)
            .create();
        let restore = server
            .mock("POST", "/agents/deployments/deployment-1/restore")
            .match_body(Matcher::Missing)
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id": "deployment-1",
                    "runtime": "openclaw",
                    "state": "RESTORING"
                })
                .to_string(),
            )
            .expect(1)
            .create();

        let client = client(&server);
        let mut request = CreateDeploymentRequest::new(ManagedRuntime::Openclaw);
        request.sync_exclude = Some(Vec::new());
        assert_eq!(
            client.create_deployment(&request).unwrap().state,
            "CREATING"
        );
        assert_eq!(
            client
                .start_deployment("deployment-1", &complete_start())
                .unwrap()
                .state,
            "STARTING"
        );
        assert_eq!(
            client.stop_deployment("deployment-1").unwrap().state,
            "STOPPING"
        );
        assert_eq!(
            client.archive_deployment("deployment-1").unwrap().state,
            "ARCHIVING"
        );
        assert_eq!(
            client.restore_deployment("deployment-1").unwrap().state,
            "RESTORING"
        );

        for mock in [create, start, stop, archive, restore] {
            mock.assert();
        }
    }

    #[test]
    fn routes_support_declarative_replacement_for_an_owned_agent() {
        let mut server = Server::new();
        let response = serde_json::json!({
            "agent_id": "deployment-1",
            "routes": {"web": {"port": 3000, "auth": true, "prefix": "app"}},
            "cors": {
                "allowed_origins": ["https://agents.hypercli.com"],
                "allow_credentials": true
            },
            "route_statuses": {"web": {"url": "https://app-agent.hypercli.app"}}
        });
        let get_mock = server
            .mock("GET", "/agents/deployments/deployment-1/routes")
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response.to_string())
            .create();
        let put_mock = server
            .mock("PUT", "/agents/deployments/deployment-1/routes")
            .match_header("authorization", "Bearer test-credential")
            .match_body(Matcher::JsonString(
                serde_json::json!({
                    "routes": {"web": {"port": 3000, "auth": true, "prefix": "app"}},
                    "cors": {
                        "allowed_origins": ["https://agents.hypercli.com"],
                        "max_age": 600
                    }
                })
                .to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response.to_string())
            .create();

        let client = client(&server);
        let current = client.get_deployment_routes("deployment-1").unwrap();
        assert_eq!(current.routes["web"].port, 3000);
        assert_eq!(
            current.cors.as_ref().unwrap().allowed_origins,
            vec!["https://agents.hypercli.com".to_owned()]
        );

        let mut routes = BTreeMap::new();
        routes.insert(
            "web".to_owned(),
            crate::RouteConfig {
                port: 3000,
                auth: true,
                prefix: Some("app".to_owned()),
            },
        );
        let updated = client
            .set_deployment_routes(
                "deployment-1",
                &crate::SetDeploymentRoutesRequest {
                    routes,
                    cors: Some(crate::Nullable::Value(crate::AgentCorsConfig {
                        allowed_origins: vec!["https://agents.hypercli.com".to_owned()],
                        allow_credentials: None,
                        allowed_headers: None,
                        allowed_methods: None,
                        max_age: Some(600),
                    })),
                },
            )
            .unwrap();
        assert_eq!(updated.agent_id, "deployment-1");
        get_mock.assert();
        put_mock.assert();
    }

    #[test]
    fn agent_access_identity_reports_the_agent_a_runtime_key_speaks_for() {
        let mut server = Server::new();
        let runtime = server
            .mock("GET", "/agents/deployments/auth/me")
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "user_id": "user-456",
                    "auth_type": "orchestra_key",
                    "agent_id": "deployment-1",
                    "tags": ["agents:none", "runtime_agent=deployment-1"],
                    "capabilities": ["agents:self"],
                    "key_id": "key-1",
                    "key_name": "runtime",
                    "team_id": "team-1",
                    "plan_id": "plan-1"
                })
                .to_string(),
            )
            .create();

        let identity = client(&server).agent_access_identity().unwrap();

        assert_eq!(identity.agent_id.as_deref(), Some("deployment-1"));
        assert!(identity.is_agent_runtime_key());
        assert_eq!(identity.user_id, "user-456");
        assert_eq!(identity.auth_type, "orchestra_key");
        assert_eq!(identity.key_name.as_deref(), Some("runtime"));
        assert_eq!(identity.capabilities, vec!["agents:self".to_owned()]);
        runtime.assert();
    }

    #[test]
    fn agent_access_identity_reports_no_agent_for_a_user_credential() {
        let mut server = Server::new();
        let owner = server
            .mock("GET", "/agents/deployments/auth/me")
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "user_id": "user-456",
                    "auth_type": "user",
                    "team_id": "team-1"
                })
                .to_string(),
            )
            .create();

        let identity = client(&server).agent_access_identity().unwrap();

        assert!(identity.agent_id.is_none());
        assert!(!identity.is_agent_runtime_key());
        assert!(identity.tags.is_empty());
        assert!(identity.capabilities.is_empty());
        owner.assert();
    }

    #[test]
    fn named_route_mutations_encode_name() {
        let mut server = Server::new();
        let response = serde_json::json!({
            "agent_id": "deployment-1",
            "routes": {},
            "route_statuses": {}
        });
        let put_mock = server
            .mock("PUT", "/agents/deployments/deployment-1/routes/web%20app")
            .match_header("authorization", "Bearer test-credential")
            .match_body(Matcher::JsonString(
                serde_json::json!({
                    "port": 3000,
                    "auth": false,
                    "prefix": ""
                })
                .to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response.to_string())
            .create();
        let delete_mock = server
            .mock(
                "DELETE",
                "/agents/deployments/deployment-1/routes/web%20app",
            )
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response.to_string())
            .create();

        let client = client(&server);
        let request = crate::SetDeploymentRouteRequest::new(crate::RouteConfig {
            port: 3000,
            auth: false,
            prefix: Some(String::new()),
        });
        client
            .set_deployment_route("deployment-1", "web app", &request)
            .unwrap();
        client
            .remove_deployment_route("deployment-1", "web app")
            .unwrap();
        put_mock.assert();
        delete_mock.assert();
    }

    async fn exec_fixture(
        result_stdout: &str,
        expected_command: &[&str],
        timeout: u32,
    ) -> (
        mockito::ServerGuard,
        mockito::Mock,
        tokio::task::JoinHandle<()>,
    ) {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let ws_url = format!(
            "ws://{}/ws/exec/deployment-1",
            listener.local_addr().unwrap()
        );
        let command = expected_command
            .iter()
            .map(|argument| (*argument).to_owned())
            .collect::<Vec<_>>();
        let stdout = result_stdout.to_owned();
        let task = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            #[allow(clippy::result_large_err)]
            let mut socket = accept_hdr_async(
                stream,
                |request: &tokio_tungstenite::tungstenite::handshake::server::Request, response| {
                    assert_eq!(
                        request.uri().path_and_query().unwrap().as_str(),
                        "/ws/exec/deployment-1?jwt=jwt"
                    );
                    Ok(response)
                },
            )
            .await
            .unwrap();
            let Message::Text(frame) = socket.next().await.unwrap().unwrap() else {
                panic!("text")
            };
            assert_eq!(
                serde_json::from_str::<Value>(frame.as_ref()).unwrap(),
                json!({"command":command,"timeout":timeout,"dry_run":false})
            );
            socket.send(Message::Text(json!({"event":"agent_exec_result","ok":true,"exit_code":0,"stdout":stdout,"stderr":""}).to_string().into())).await.unwrap();
            socket.close(None).await.unwrap();
        });
        let mut server = Server::new_async().await;
        let token=server.mock("POST","/agents/deployments/deployment-1/exec/token").match_header("authorization","Bearer test-credential").with_status(200).with_header("content-type","application/json").with_body(json!({"agent_id":"deployment-1","jwt":"jwt","expires_at":"2026-08-16T00:00:00Z","ws_url":ws_url}).to_string()).create_async().await;
        (server, token, task)
    }

    async fn client_for_async_test(server: &mockito::ServerGuard) -> HyperCliClient {
        let api_base = Url::parse(&format!("{}/agents", server.url())).unwrap();
        tokio::task::spawn_blocking(move || {
            HyperCliClient::new(ClientConfig {
                api_base,
                api_key: SecretString::from("test-credential"),
                trace_file: None,
            })
            .unwrap()
        })
        .await
        .unwrap()
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn exec_uses_token_scoped_one_shot_websocket() {
        let argv = ["printf", "-f", " value with spaces ", ""];
        let (server, token, task) = exec_fixture("ready\n", &argv, 5).await;
        let mut request = ExecDeploymentRequest::new(argv);
        request.timeout = 5;
        let client = client_for_async_test(&server).await;
        let response = client
            .exec_deployment("deployment-1", &request)
            .await
            .unwrap();
        assert_eq!(response.stdout, "ready\n");
        task.await.unwrap();
        token.assert_async().await;
        drop(token);
        tokio::task::spawn_blocking(move || {
            drop(client);
            drop(server);
        })
        .await
        .unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn runtime_auth_status_uses_token_scoped_exec() {
        let (server, token, task) = exec_fixture(
            "{\"runtime\":\"codex\",\"authenticated\":false}\n",
            &["/usr/local/bin/hypercli-runtime-auth", "status"],
            15,
        )
        .await;
        let client = client_for_async_test(&server).await;
        let status = client.runtime_auth_status("deployment-1").await.unwrap();
        assert_eq!(status.runtime, NativeRuntime::Codex);
        assert!(!status.authenticated);
        task.await.unwrap();
        token.assert_async().await;
        drop(token);
        tokio::task::spawn_blocking(move || {
            drop(client);
            drop(server);
        })
        .await
        .unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn metrics_uses_token_scoped_one_shot_websocket() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let ws_url = format!(
            "ws://{}/ws/metrics/deployment-1",
            listener.local_addr().unwrap()
        );
        let task = tokio::spawn(async move {
            let (stream, _) = listener.accept().await.unwrap();
            #[allow(clippy::result_large_err)]
            let mut socket = accept_hdr_async(
                stream,
                |request: &tokio_tungstenite::tungstenite::handshake::server::Request, response| {
                    assert_eq!(
                        request.uri().path_and_query().unwrap().as_str(),
                        "/ws/metrics/deployment-1?jwt=jwt"
                    );
                    Ok(response)
                },
            )
            .await
            .unwrap();
            socket.send(Message::Text(json!({"event":"agent_metrics_result","ok":true,"cpu":"10m","memory":"20Mi","timestamp":42}).to_string().into())).await.unwrap();
            socket.close(None).await.unwrap();
        });
        let mut server = Server::new_async().await;
        let token=server.mock("POST","/agents/deployments/deployment-1/metrics/token").match_header("authorization","Bearer test-credential").with_status(200).with_header("content-type","application/json").with_body(json!({"agent_id":"deployment-1","jwt":"jwt","expires_at":"2026-08-16T00:00:00Z","ws_url":ws_url}).to_string()).create_async().await;
        let client = client_for_async_test(&server).await;
        let value = client.deployment_metrics("deployment-1").await.unwrap();
        assert_eq!(value["cpu"], "10m");
        task.await.unwrap();
        token.assert_async().await;
        drop(token);
        tokio::task::spawn_blocking(move || {
            drop(client);
            drop(server);
        })
        .await
        .unwrap();
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn operation_token_requires_the_exact_public_websocket_path() {
        let mut server = Server::new_async().await;
        let token = server
            .mock("POST", "/agents/deployments/deployment-1/metrics/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "agent_id": "deployment-1",
                    "jwt": "short-lived-secret",
                    "expires_at": "2026-08-16T00:00:00Z",
                    "ws_url": "ws://127.0.0.1:9/prefix/ws/metrics/deployment-1",
                })
                .to_string(),
            )
            .create_async()
            .await;
        let client = client_for_async_test(&server).await;

        let error = client.deployment_metrics("deployment-1").await.unwrap_err();

        assert!(matches!(error, HyperCliError::InvalidResponse(_)));
        token.assert_async().await;
    }

    #[tokio::test(flavor = "multi_thread")]
    async fn operation_connection_errors_never_expose_the_short_lived_jwt() {
        let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
        let ws_url = format!(
            "ws://{}/ws/metrics/deployment-1",
            listener.local_addr().unwrap()
        );
        drop(listener);
        let mut server = Server::new_async().await;
        let token = server
            .mock("POST", "/agents/deployments/deployment-1/metrics/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "agent_id": "deployment-1",
                    "jwt": "short-lived-secret",
                    "expires_at": "2026-08-16T00:00:00Z",
                    "ws_url": ws_url,
                })
                .to_string(),
            )
            .create_async()
            .await;
        let client = client_for_async_test(&server).await;

        let error = client.deployment_metrics("deployment-1").await.unwrap_err();

        assert_eq!(
            error.to_string(),
            "HyperCLI request could not be sent: operation websocket connection failed"
        );
        assert!(!error.to_string().contains("short-lived-secret"));
        token.assert_async().await;
    }

    #[test]
    fn update_deployment_sends_complete_launch_config_replacement() {
        let mut server = Server::new();
        let mock = server
            .mock("PATCH", "/agents/deployments/deployment-1")
            .match_header("authorization", "Bearer test-credential")
            .match_body(Matcher::JsonString(
                serde_json::json!({
                    "name": "Maverick",
                    "size": "large",
                    "launch_config": {
                        "command": ["/usr/local/bin/buzz-acp"],
                        "env": {
                            "BUZZ_PRIVATE_KEY": "nsec-preserved",
                            "EDITOR": "nvim"
                        }
                    }
                })
                .to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id": "deployment-1",
                    "name": "Maverick",
                    "runtime": "opencode",
                    "state": "stopped",
                    "requested_size": "large",
                    "launch_config": {
                        "command": ["/usr/local/bin/buzz-acp"],
                        "env": {
                            "BUZZ_PRIVATE_KEY": "nsec-preserved",
                            "EDITOR": "nvim"
                        }
                    }
                })
                .to_string(),
            )
            .create();

        let request = UpdateDeploymentRequest {
            name: Some("Maverick".to_owned()),
            size: Some(crate::AgentSize::Large),
            launch_config: Some(crate::DeploymentLaunchConfig::from_map(BTreeMap::from([
                (
                    "command".to_owned(),
                    serde_json::json!(["/usr/local/bin/buzz-acp"]),
                ),
                (
                    "env".to_owned(),
                    serde_json::json!({
                        "BUZZ_PRIVATE_KEY": "nsec-preserved",
                        "EDITOR": "nvim"
                    }),
                ),
            ]))),
            ..Default::default()
        };
        let deployment = client(&server)
            .update_deployment("deployment-1", &request)
            .unwrap();

        assert_eq!(deployment.requested_size, Some(crate::AgentSize::Large));
        assert_eq!(deployment.launch_config.as_map()["env"]["EDITOR"], "nvim");
        mock.assert();
    }

    #[test]
    fn deployment_file_write_builds_direct_root_relative_reef_url() {
        let token = FileToken {
            url: "https://agent.example.test/_reef".into(),
            token: "reef-token".into(),
            expires_at: "2026-08-16T00:00:00Z".into(),
        };
        let (url, path) = reef_file_url(&token, ".ssh\\id key").unwrap();
        assert_eq!(path, ".ssh/id key");
        assert_eq!(
            url.as_str(),
            "https://agent.example.test/_reef/files/.ssh/id%20key"
        );
        assert!(reef_file_url(&token, "/etc/passwd").is_err());
        assert!(reef_file_url(&token, "../escape").is_err());
        for invalid_url in [
            "https://agent.example.test/_reef/".into(),
            "https://agent.example.test/_reef//".into(),
            "https://agent.example.test/_reef/files".into(),
            "https://agent.example.test/_reef?x=1".into(),
            "https://agent.example.test/_reef#fragment".into(),
            format!("https://agent.example.test/{}{}", "_reef", "-sync"),
            format!("https://agent.example.test/{}{}", "_reef", "_sync"),
        ] {
            let invalid_token = FileToken {
                url: invalid_url,
                token: "reef-token".into(),
                expires_at: "2026-08-16T00:00:00Z".into(),
            };
            assert!(reef_file_url(&invalid_token, "workspace/a.txt").is_err());
        }
    }

    #[test]
    fn deployment_file_write_rejects_oversized_content_before_any_http() {
        // Cloudflare's edge caps request bodies on the agent hostname at
        // 100 MB, so oversized writes must fail fast without minting a token
        // or sending any HTTP request.
        let mut server = Server::new();
        let token = server
            .mock("POST", "/agents/deployments/deployment-1/files/token")
            .expect(0)
            .create();

        let content = vec![0u8; AGENT_FILE_WRITE_MAX_BYTES + 1];
        let error = client(&server)
            .put_deployment_file("deployment-1", "workspace/too-large.bin", &content)
            .unwrap_err();

        assert!(error
            .to_string()
            .contains("agent file writes are limited to 100 MiB"));
        token.assert();
    }

    #[test]
    fn deployment_file_token_redirect_is_not_followed() {
        let mut server = Server::new();
        let redirect = server
            .mock("POST", "/agents/deployments/deployment-1/files/token")
            .match_header("authorization", "Bearer test-credential")
            .with_status(307)
            .with_header("location", "/must-not-follow")
            .expect(1)
            .create();
        let target = server.mock("POST", "/must-not-follow").expect(0).create();

        let error = client(&server)
            .put_deployment_file(
                "deployment-1",
                ".ssh/id_ed25519_imported",
                b"private-key-material",
            )
            .unwrap_err();
        assert_eq!(error.status(), Some(StatusCode::TEMPORARY_REDIRECT));
        redirect.assert();
        target.assert();
    }

    #[test]
    fn deployment_profile_image_upload_and_delete_use_raw_authenticated_contract() {
        let mut server = Server::new();
        let image = b"\x89PNG\r\n\x1a\nprofile-image";
        let upload = server
            .mock("POST", "/agents/deployments/deployment-1/profile-image")
            .match_header("authorization", "Bearer test-credential")
            .match_header("content-type", "image/png")
            .match_body(image.to_vec())
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id": "deployment-1",
                    "avatar_url": "https://cdn.example.test/user/deployment-1.png",
                    "s3_key": "user/deployment-1.png"
                })
                .to_string(),
            )
            .create();
        let delete = server
            .mock("DELETE", "/agents/deployments/deployment-1/profile-image")
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id": "deployment-1",
                    "avatar_url": null,
                    "s3_key": null
                })
                .to_string(),
            )
            .create();

        let client = client(&server);
        let uploaded = client
            .upload_deployment_profile_image("deployment-1", image, "image/png")
            .unwrap();
        assert_eq!(uploaded.id, "deployment-1");
        assert_eq!(
            uploaded.avatar_url.as_deref(),
            Some("https://cdn.example.test/user/deployment-1.png")
        );
        assert_eq!(uploaded.s3_key.as_deref(), Some("user/deployment-1.png"));

        let deleted = client
            .delete_deployment_profile_image("deployment-1")
            .unwrap();
        assert_eq!(
            deleted,
            DeploymentProfileImageResponse {
                id: "deployment-1".to_owned(),
                avatar_url: None,
                s3_key: None,
            }
        );
        upload.assert();
        delete.assert();
    }

    #[test]
    fn deployment_profile_image_trace_omits_image_bytes() {
        let mut server = Server::new();
        let temp = tempfile::tempdir().unwrap();
        let trace_file = temp.path().join("logs/http.jsonl");
        let image = b"avatar-binary-must-not-appear-in-trace";
        let mock = server
            .mock("POST", "/agents/deployments/deployment-1/profile-image")
            .match_body(image.to_vec())
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id": "deployment-1",
                    "avatar_url": "https://cdn.example.test/user/deployment-1.png",
                    "s3_key": "user/deployment-1.png"
                })
                .to_string(),
            )
            .create();
        let client = HyperCliClient::new(ClientConfig {
            api_base: Url::parse(&format!("{}/agents", server.url())).unwrap(),
            api_key: SecretString::from("test-credential"),
            trace_file: Some(trace_file.clone()),
        })
        .unwrap();

        client
            .upload_deployment_profile_image("deployment-1", image, "image/png")
            .unwrap();

        let trace = fs::read_to_string(trace_file).unwrap();
        assert!(trace.contains(r#""operation":"upload_deployment_profile_image""#));
        assert!(trace.contains(r#""content":"<omitted>""#));
        assert!(trace.contains(&format!(r#""size":{}"#, image.len())));
        assert!(!trace.contains("avatar-binary-must-not-appear-in-trace"));
        assert!(!trace.contains("test-credential"));
        mock.assert();
    }

    fn stored_projection(extra: serde_json::Value) -> serde_json::Value {
        // Exactly what hydrate_managed_agent returns to an owner: the full
        // persisted contract minus the two redacted keys.
        let mut launch = serde_json::json!({
            "config": {},
            "image": "ghcr.io/example/agent:1",
            "env": {"EDITOR": "nvim"},
            "routes": {},
            "command": [],
            "entrypoint": [],
            "restart": true,
            "sync_root": "/home/node",
            "sync_exclude": [".git"],
            "sync_uid": 1000,
            "sync_gid": 1000,
            "registry_url": null,
            "runtime_scopes": ["agents:self"]
        });
        let target = launch.as_object_mut().unwrap();
        for (key, value) in extra.as_object().unwrap() {
            if value.is_null() && key.starts_with('-') {
                target.remove(key.trim_start_matches('-'));
            } else {
                target.insert(key.clone(), value.clone());
            }
        }
        serde_json::json!({
            "id": "deployment-1",
            "state": "STOPPED",
            "launch_epoch": 4,
            "launch_config": launch
        })
    }

    fn mock_projection(server: &mut Server, agent: serde_json::Value) -> mockito::Mock {
        server
            .mock("GET", "/agents/deployments/deployment-1")
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(agent.to_string())
            .create()
    }

    fn mock_secrets(server: &mut Server, epoch: u64) -> Vec<mockito::Mock> {
        vec![
            server
                .mock("GET", "/agents/deployments/deployment-1/secrets")
                .with_status(200)
                .with_header("content-type", "application/json")
                .with_body(
                    serde_json::json!({
                        "agent_id": "deployment-1",
                        "names": ["API_TOKEN"],
                        "launch_epoch": epoch
                    })
                    .to_string(),
                )
                .create(),
            server
                .mock("GET", "/agents/deployments/deployment-1/secrets/API_TOKEN")
                .with_status(200)
                .with_header("content-type", "application/json")
                .with_body(
                    serde_json::json!({
                        "agent_id": "deployment-1",
                        "key": "API_TOKEN",
                        "value": "recovered-token",
                        "launch_epoch": epoch
                    })
                    .to_string(),
                )
                .create(),
        ]
    }

    #[test]
    fn stored_launch_config_completes_the_projection_start_could_never_round_trip() {
        // The owner projection redacts secrets and registry_auth, and
        // DeploymentLaunchConfig strips them again, so get -> start is
        // structurally impossible without this rebuild.
        let mut server = Server::new();
        let projection = mock_projection(&mut server, stored_projection(serde_json::json!({})));
        let secrets = mock_secrets(&mut server, 4);
        let start = server
            .mock("POST", "/agents/deployments/deployment-1/start")
            .match_body(Matcher::JsonString(
                serde_json::json!({
                    "launch_config": {
                        "config": {},
                        "image": "ghcr.io/example/agent:1",
                        "env": {"EDITOR": "nvim"},
                        "secrets": {"API_TOKEN": "recovered-token"},
                        "routes": {},
                        "command": [],
                        "entrypoint": [],
                        "restart": true,
                        "sync_root": "/home/node",
                        "sync_exclude": [".git"],
                        "sync_uid": 1000,
                        "sync_gid": 1000,
                        "registry_url": null,
                        "registry_auth": {},
                        "runtime_scopes": ["agents:self"]
                    }
                })
                .to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(serde_json::json!({"id": "deployment-1", "state": "STARTING"}).to_string())
            .create();

        let client = client(&server);
        let launch_config = client.stored_launch_config("deployment-1", None).unwrap();
        assert_eq!(launch_config.secrets["API_TOKEN"], "recovered-token");
        assert!(launch_config.registry_auth.is_empty());
        assert_eq!(
            launch_config.sync_exclude.as_deref(),
            Some([".git".to_owned()].as_slice())
        );

        let started = client
            .start_deployment("deployment-1", &StartDeploymentRequest::new(launch_config))
            .unwrap();
        assert_eq!(started.state, "STARTING");
        projection.assert();
        for secret in secrets {
            secret.assert();
        }
        start.assert();
    }

    #[test]
    fn stored_launch_config_refuses_to_invent_an_empty_registry_credential() {
        let mut server = Server::new();
        let _projection = mock_projection(
            &mut server,
            stored_projection(serde_json::json!({"registry_url": "registry.example.test"})),
        );
        let _secrets = mock_secrets(&mut server, 4);

        let error = client(&server)
            .stored_launch_config("deployment-1", None)
            .err()
            .expect("stored_launch_config must fail")
            .to_string();
        assert!(error.contains("deployment-1"), "{error}");
        assert!(error.contains("registry.example.test"), "{error}");
        assert!(error.contains("caller-held"), "{error}");
    }

    #[test]
    fn stored_launch_config_accepts_caller_held_registry_credentials() {
        let mut server = Server::new();
        let _projection = mock_projection(
            &mut server,
            stored_projection(serde_json::json!({"registry_url": "registry.example.test"})),
        );
        let _secrets = mock_secrets(&mut server, 4);

        let registry_auth = BTreeMap::from([
            ("username".to_owned(), "robot".to_owned()),
            ("password".to_owned(), "pull-token".to_owned()),
        ]);
        let launch_config = client(&server)
            .stored_launch_config("deployment-1", Some(&registry_auth))
            .unwrap();
        assert_eq!(launch_config.registry_auth, registry_auth);
        assert_eq!(
            launch_config.registry_url.as_deref(),
            Some("registry.example.test")
        );
    }

    #[test]
    fn stored_launch_config_rejects_secrets_from_an_older_launch_epoch() {
        let mut server = Server::new();
        let _projection = mock_projection(&mut server, stored_projection(serde_json::json!({})));
        let _secrets = mock_secrets(&mut server, 3);

        let error = client(&server)
            .stored_launch_config("deployment-1", None)
            .err()
            .expect("stored_launch_config must fail")
            .to_string();
        assert!(error.contains("older launch epoch"), "{error}");
    }

    #[test]
    fn stored_launch_config_canonicalizes_legacy_projection_shapes() {
        // Legacy rows can carry a nullable restart, both sync policies, or
        // neither; START accepts one boolean and exactly one policy.
        let mut server = Server::new();
        let _both = mock_projection(
            &mut server,
            stored_projection(serde_json::json!({
                "restart": null,
                "sync_include": ["workspace"],
            })),
        );
        let _secrets = mock_secrets(&mut server, 4);
        let launch_config = client(&server)
            .stored_launch_config("deployment-1", None)
            .unwrap();
        assert!(!launch_config.restart);
        assert_eq!(
            launch_config.sync_include.as_deref(),
            Some(["workspace".to_owned()].as_slice())
        );
        assert!(launch_config.sync_exclude.is_none());
        // A body carrying both policies is rejected by the request builder, so
        // the rebuild above is what makes START reachable at all.
        assert!(deployment_request_body(&StartDeploymentRequest::new(launch_config)).is_ok());

        let mut server = Server::new();
        let _neither = mock_projection(
            &mut server,
            stored_projection(serde_json::json!({"-sync_exclude": null})),
        );
        let _secrets = mock_secrets(&mut server, 4);
        let launch_config = client(&server)
            .stored_launch_config("deployment-1", None)
            .unwrap();
        assert_eq!(launch_config.sync_exclude.as_deref(), Some([].as_slice()));
        assert!(launch_config.sync_include.is_none());
    }

    #[test]
    fn stored_launch_config_reports_an_incomplete_projection_instead_of_guessing() {
        let mut server = Server::new();
        let _projection = mock_projection(
            &mut server,
            stored_projection(serde_json::json!({"-config": null})),
        );
        let _secrets = mock_secrets(&mut server, 4);

        let error = client(&server)
            .stored_launch_config("deployment-1", None)
            .err()
            .expect("stored_launch_config must fail")
            .to_string();
        assert!(error.contains("deployment-1"), "{error}");
        assert!(error.contains("config"), "{error}");
    }

    #[test]
    fn directory_listing_urls_address_the_sync_root_and_stay_inside_it() {
        let token = FileToken {
            url: "https://agent.example.test/_reef".into(),
            token: "reef-token".into(),
            expires_at: "2026-08-16T00:00:00Z".into(),
        };
        let (root, path) = reef_directory_url(&token, "").unwrap();
        assert_eq!(path, "");
        assert_eq!(
            root.as_str(),
            "https://agent.example.test/_reef/directories"
        );
        let (nested, path) = reef_directory_url(&token, "work space\\logs").unwrap();
        assert_eq!(path, "work space/logs");
        assert_eq!(
            nested.as_str(),
            "https://agent.example.test/_reef/directories/work%20space/logs"
        );
        assert!(reef_directory_url(&token, "/etc").is_err());
        assert!(reef_directory_url(&token, "../escape").is_err());
        // The root shorthand is a listing-only affordance; writes must name a file.
        assert!(reef_file_url(&token, "").is_err());
        let invalid = FileToken {
            url: "https://agent.example.test/_reef/files".into(),
            token: "reef-token".into(),
            expires_at: "2026-08-16T00:00:00Z".into(),
        };
        assert!(reef_directory_url(&invalid, "").is_err());
    }

    #[test]
    fn directory_listings_return_directories_before_files() {
        let listing: AgentDirectoryListing = serde_json::from_value(serde_json::json!({
            "type": "directory",
            "prefix": "",
            "requested_path": "",
            "truncated": false,
            "directories": [{"name": "logs", "path": "logs/", "type": "directory"}],
            "files": [{
                "name": "a.txt",
                "path": "a.txt",
                "type": "file",
                "size": 12,
                "size_formatted": "12 B",
                "last_modified": null
            }]
        }))
        .unwrap();
        let entries = listing.into_entries();
        assert_eq!(entries.len(), 2);
        assert!(entries[0].is_directory());
        assert_eq!(entries[0].name, "logs");
        assert!(entries[1].is_file());
        assert_eq!(entries[1].size, Some(12));
    }

    #[test]
    fn file_api_readiness_fails_fast_on_a_terminal_agent_state() {
        // The agent domain is a wildcard: a host with no route answers the same
        // plain-text 404 as a route that has not converged. Only the API's
        // authoritative state can tell "not ready" from "never will be", so a
        // terminal state must not be retried until the deadline.
        let mut server = Server::new();
        let state = server
            .mock("GET", "/agents/deployments/deployment-1")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(serde_json::json!({"id": "deployment-1", "state": "FAILED"}).to_string())
            .expect(1)
            .create();
        let token = server
            .mock("POST", "/agents/deployments/deployment-1/files/token")
            .expect(0)
            .create();

        let error = client(&server)
            .wait_deployment_file_api_ready(
                "deployment-1",
                FileApiReadyOptions {
                    timeout: Duration::from_secs(30),
                    ..Default::default()
                },
            )
            .unwrap_err()
            .to_string();
        assert!(error.contains("FAILED"), "{error}");
        assert!(error.contains("waiting longer cannot help"), "{error}");
        state.assert();
        token.assert();
    }

    #[test]
    fn file_api_readiness_timeout_names_the_state_and_the_last_error() {
        let mut server = Server::new();
        let _state = server
            .mock("GET", "/agents/deployments/deployment-1")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(serde_json::json!({"id": "deployment-1", "state": "STARTING"}).to_string())
            .create();
        let _token = server
            .mock("POST", "/agents/deployments/deployment-1/files/token")
            .with_status(503)
            .create();

        let error = client(&server)
            .wait_deployment_file_api_ready(
                "deployment-1",
                FileApiReadyOptions {
                    timeout: Duration::ZERO,
                    consecutive: 2,
                    poll_interval: Duration::ZERO,
                },
            )
            .unwrap_err()
            .to_string();
        assert!(error.contains("2 consecutive reads"), "{error}");
        assert!(error.contains("agent state=STARTING"), "{error}");
        assert!(error.contains("503"), "{error}");
    }

    #[test]
    fn file_api_readiness_requires_consecutive_reads_and_resets_on_failure() {
        // One success only proves the route answered once; the next request can
        // still 404 while the edge settles, so a failure restarts the streak.
        let mut server = Server::new();
        let _state = server
            .mock("GET", "/agents/deployments/deployment-1")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(serde_json::json!({"id": "deployment-1", "state": "RUNNING"}).to_string())
            .create();

        let outcomes = Arc::new(Mutex::new(vec![
            Ok(()),
            Err(HyperCliError::Status(StatusCode::NOT_FOUND)),
            Ok(()),
            Ok(()),
        ]));
        let attempts = Arc::new(Mutex::new(0usize));
        let probe_outcomes = Arc::clone(&outcomes);
        let probe_attempts = Arc::clone(&attempts);
        client(&server)
            .wait_file_api_ready_with(
                "deployment-1",
                FileApiReadyOptions {
                    timeout: Duration::from_secs(30),
                    consecutive: 2,
                    poll_interval: Duration::ZERO,
                },
                move || {
                    *probe_attempts.lock().unwrap() += 1;
                    probe_outcomes.lock().unwrap().remove(0)
                },
            )
            .unwrap();
        // Success, failure, success, success: the lone early success cannot
        // satisfy a two-read streak.
        assert_eq!(*attempts.lock().unwrap(), 4);
        assert!(outcomes.lock().unwrap().is_empty());
    }

    #[test]
    fn runtime_shell_token_rejects_a_token_minted_for_another_agent() {
        // The backend binds agent_id to a UUID path parameter, so there is no
        // "self" alias to exempt: every response must name the agent asked for.
        let mut server = Server::new();
        let _mock = server
            .mock("POST", "/agents/deployments/self/shell/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "agent_id": "deployment-1",
                    "jwt": "short-lived-shell-jwt",
                    "expires_at": "2026-08-05T12:00:00Z",
                    "ws_url": "wss://api.agents.hypercli.com/ws/shell/deployment-1",
                    "shell": "/bin/bash"
                })
                .to_string(),
            )
            .create();

        assert!(client(&server)
            .create_runtime_shell_token("self", None)
            .is_err());
    }

    #[test]
    fn runtime_shell_token_is_opaque_and_uses_backend_contract() {
        let mut server = Server::new();
        let mock = server
            .mock("POST", "/agents/deployments/deployment-1/shell/token")
            .match_header("authorization", "Bearer test-credential")
            .match_body(Matcher::JsonString(
                serde_json::json!({"shell": "/bin/bash"}).to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "agent_id": "deployment-1",
                    "jwt": "short-lived-shell-jwt",
                    "expires_at": "2026-08-05T12:00:00Z",
                    "ws_url": "wss://api.agents.hypercli.com/ws/shell/deployment-1",
                    "shell": "/bin/bash"
                })
                .to_string(),
            )
            .create();

        let token = client(&server)
            .create_runtime_shell_token("deployment-1", None)
            .unwrap();
        assert_eq!(token.agent_id, "deployment-1");
        assert_eq!(token.shell.as_deref(), Some("/bin/bash"));
        assert_eq!(token.ws_url.scheme(), "wss");
        assert_eq!(token.jwt.expose_secret(), "short-lived-shell-jwt");
        mock.assert();
    }

    #[test]
    fn response_bodies_are_not_exposed_in_errors() {
        let mut server = Server::new();
        let secret = "nsec1must-not-leak";
        let _mock = server
            .mock("POST", "/agents/deployments")
            .with_status(400)
            .with_body(format!("invalid launch: {secret}"))
            .create();

        let mut request = CreateDeploymentRequest::new(ManagedRuntime::Opencode);
        request.sync_exclude = Some(Vec::new());
        let error = client(&server).create_deployment(&request).unwrap_err();
        assert!(!error.to_string().contains(secret));
        assert_eq!(error.status(), Some(StatusCode::BAD_REQUEST));
    }

    #[test]
    fn trace_records_status_and_redacts_request_secrets() {
        let mut server = Server::new();
        let temp = tempfile::tempdir().unwrap();
        let trace_file = temp.path().join("logs/http.jsonl");
        let secret = "nsec1must-not-appear-in-trace";
        let _mock = server
            .mock("POST", "/agents/deployments")
            .with_status(422)
            .with_header("x-request-id", "request-123")
            .with_body(format!("invalid launch: {secret}"))
            .create();
        let client = HyperCliClient::new(ClientConfig {
            api_base: Url::parse(&format!("{}/agents", server.url())).unwrap(),
            api_key: SecretString::from("test-credential"),
            trace_file: Some(trace_file.clone()),
        })
        .unwrap();
        let mut request = CreateDeploymentRequest::new(ManagedRuntime::Opencode);
        request.sync_exclude = Some(Vec::new());
        request
            .secrets
            .insert("BUZZ_PRIVATE_KEY".to_owned(), secret.to_owned());
        request
            .registry_auth
            .insert("password".to_owned(), secret.to_owned());

        let error = client.create_deployment(&request).unwrap_err();
        assert_eq!(error.status(), Some(StatusCode::UNPROCESSABLE_ENTITY));

        let trace = fs::read_to_string(&trace_file).unwrap();
        assert!(trace.contains(r#""status":422"#));
        assert!(trace.contains(r#""x-request-id":"request-123""#));
        assert!(trace.contains(r#""secrets":"<redacted>""#));
        assert!(trace.contains(r#""registry_auth":"<redacted>""#));
        assert!(!trace.contains(secret));
        assert!(!trace.contains("test-credential"));
        #[cfg(unix)]
        assert_eq!(
            fs::metadata(trace_file).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
