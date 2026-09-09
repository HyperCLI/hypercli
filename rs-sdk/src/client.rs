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
use serde_json::{json, Map, Value};
use thiserror::Error;
use tokio::net::TcpStream;
use tokio::runtime;
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};
use url::Url;

use crate::runtime_auth::{auth_status_command, RuntimeShellTokenResponse};
use crate::{
    AgentAccessIdentity, AgentCapacity, AgentDirectoryListing, AgentFileEntry,
    AgentLaunchValueMutation, AgentsMe, ApiKey, AuthMe, ClientConfig,
    CompleteDeploymentLaunchConfig, CreateApiKeyRequest, CreateDeploymentRequest,
    DeleteDeploymentResponse, Deployment, DeploymentAccessToken, DeploymentEnvironment,
    DeploymentEvent, DeploymentFileWriteResponse, DeploymentListFilters, DeploymentLogsToken,
    DeploymentProfileImageResponse, DeploymentRoutes, DeploymentSecret, DeploymentSecretNames,
    ExecDeploymentRequest, ExecDeploymentResponse, HyperAgentAgentUsage, HyperAgentBillingInfo,
    HyperAgentBillingProfileFields, HyperAgentBillingProfileResponse, HyperAgentCurrentPlan,
    HyperAgentEntitlement, HyperAgentEntitlementsSummary, HyperAgentKeyUsage, HyperAgentPayment,
    HyperAgentPaymentsResponse, HyperAgentPlan, HyperAgentStripeBillingPortalResponse,
    HyperAgentStripeCheckoutResponse, HyperAgentSubscriptionList,
    HyperAgentSubscriptionMutationResult, HyperAgentSubscriptionSummary, HyperAgentUsageHistory,
    HyperAgentUsageSummary, JobLifecycleEvent, NativeRuntime, RuntimeAuthError, RuntimeAuthStatus,
    RuntimeLoginSession, RuntimeShellToken, SetDeploymentRouteRequest, SetDeploymentRoutesRequest,
    StartDeploymentRequest, UpdateDeploymentRequest,
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

/// Default per-request HTTP timeout, shared with the Python and TypeScript
/// SDKs. Overridable per client through [`ClientConfig::timeout`] or
/// [`HyperCliClient::new_with_timeout`].
pub const DEFAULT_REQUEST_TIMEOUT: Duration = Duration::from_secs(30);

/// Total send attempts per request when the transport fails, matching the
/// Python SDK's `request_with_retry(retries=3)`. HTTP status failures are
/// never retried; only pre-response transport errors (connect/proxy/timeout)
/// are.
const TRANSPORT_RETRY_ATTEMPTS: u32 = 3;
/// Base for the linear backoff between transport retries (attempt 1 waits
/// 1x, attempt 2 waits 2x), matching the Python SDK.
const TRANSPORT_RETRY_BACKOFF: Duration = Duration::from_secs(1);

/// Retry pre-response transport failures (connect/proxy/timeout), mirroring
/// the Python SDK's retryable `httpx` exception set. Anything else (decode
/// errors, TLS policy rejections, invalid headers) is returned immediately.
fn transport_error_is_retryable(error: &reqwest::Error) -> bool {
    error.is_connect() || error.is_timeout()
}

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
#[serde(deny_unknown_fields)]
struct DeploymentEventTokenResponse {
    token: String,
    ws_url: String,
}
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct OperationToken {
    agent_id: String,
    token: String,
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
    pub(crate) api_base: Url,
    pub(crate) api_key: secrecy::SecretString,
    pub(crate) http: HttpClient,
    async_http: AsyncHttpClient,
    trace_file: Option<PathBuf>,
    pub(crate) auth_me_cache: std::sync::OnceLock<Option<AuthMe>>,
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

fn deployment_event_ws_url(raw_url: &str, token: &str) -> Result<Url, HyperCliError> {
    let credential = token.trim();
    if credential.is_empty() {
        return Err(HyperCliError::InvalidResponse(
            "deployment event token response omitted token".to_owned(),
        ));
    }
    let mut url = Url::parse(raw_url).map_err(|_| {
        HyperCliError::InvalidResponse("invalid deployment event ws_url".to_owned())
    })?;
    if !matches!(url.scheme(), "ws" | "wss")
        || url.host_str().is_none()
        || !url.username().is_empty()
        || url.password().is_some()
        || url.query().is_some()
        || url.fragment().is_some()
        || url.path() != "/ws/deployments"
    {
        return Err(HyperCliError::InvalidResponse(
            "invalid deployment event ws_url".to_owned(),
        ));
    }
    url.query_pairs_mut().append_pair("token", credential);
    Ok(url)
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
pub const AGENT_FILE_READ_MAX_BYTES: usize = 20 * 1024 * 1024;

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
        let timeout = config.timeout.unwrap_or(DEFAULT_REQUEST_TIMEOUT);
        Self::new_with_timeout(config, timeout)
    }

    /// `reqwest::blocking::Client::build` drops its internal tokio runtime
    /// inline, which panics when called from inside an async context; Tauri
    /// commands run on one, so build on a plain thread there.
    fn build_blocking_client(timeout: std::time::Duration) -> Result<HttpClient, reqwest::Error> {
        if runtime::Handle::try_current().is_err() {
            return HttpClient::builder()
                .timeout(timeout)
                .redirect(reqwest::redirect::Policy::none())
                .build();
        }
        std::thread::spawn(move || {
            HttpClient::builder()
                .timeout(timeout)
                .redirect(reqwest::redirect::Policy::none())
                .build()
        })
        .join()
        .expect("blocking client build thread panicked")
    }

    pub fn new_with_timeout(
        config: ClientConfig,
        timeout: std::time::Duration,
    ) -> Result<Self, HyperCliError> {
        let http = Self::build_blocking_client(timeout)
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
            auth_me_cache: std::sync::OnceLock::new(),
        })
    }

    pub(crate) fn endpoint(&self, path: &str) -> String {
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
            || t.token.is_empty()
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
        u.query_pairs_mut().append_pair("token", &t.token);
        tokio::time::timeout(timeout, async {
            // The URL now contains the short-lived token. Never let a
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
        let response = match self.send_with_retry(request_builder) {
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

    /// Effective entitlement plus recurring-subscription summary
    /// (`GET {agents}/subscriptions/summary`).
    pub fn subscription_summary(&self) -> Result<HyperAgentSubscriptionSummary, HyperCliError> {
        self.get_json("subscriptions/summary")
    }

    /// Effective HyperClaw entitlement summary (`GET {agents}/entitlements`).
    /// A scoped key without the `user` scope family returns 403; callers
    /// should treat that as unknown, not as an explicit inactive-plan result.
    pub fn entitlements_summary(&self) -> Result<HyperAgentEntitlementsSummary, HyperCliError> {
        self.get_json("entitlements")
    }

    /// Recurring billing subscriptions (`GET {agents}/subscriptions`).
    pub fn subscriptions(&self) -> Result<HyperAgentSubscriptionList, HyperCliError> {
        self.get_json("subscriptions")
    }

    /// Cancel a recurring subscription (`POST {agents}/subscriptions/{id}/cancel`).
    /// The response shape is backend-owned (the Stripe subscription ends at
    /// the period end).
    pub fn cancel_subscription(&self, subscription_id: &str) -> Result<Value, HyperCliError> {
        let url = self.endpoint(&format!("subscriptions/{subscription_id}/cancel"));
        self.send_json(
            "cancel_subscription",
            "POST",
            &url,
            None,
            self.http
                .post(&url)
                .bearer_auth(self.api_key.expose_secret()),
        )
    }

    /// Change a recurring subscription's plan and quantity
    /// (`POST {agents}/subscriptions/{id}/update` `{plan_id, quantity}`).
    pub fn update_subscription(
        &self,
        subscription_id: &str,
        plan_id: &str,
        quantity: u32,
    ) -> Result<HyperAgentSubscriptionMutationResult, HyperCliError> {
        let subscription_id = subscription_id.trim();
        let plan_id = plan_id.trim();
        if subscription_id.is_empty() {
            return Err(HyperCliError::InvalidResponse(
                "subscription_id is required".to_owned(),
            ));
        }
        if plan_id.is_empty() {
            return Err(HyperCliError::InvalidResponse(
                "plan_id is required".to_owned(),
            ));
        }
        if quantity < 1 {
            return Err(HyperCliError::InvalidResponse(
                "quantity must be a positive integer".to_owned(),
            ));
        }
        let url = self.endpoint(&format!("subscriptions/{subscription_id}/update"));
        let request = json!({ "plan_id": plan_id, "quantity": quantity });
        self.send_json(
            "update_subscription",
            "POST",
            &url,
            Some(request.clone()),
            self.http
                .post(&url)
                .bearer_auth(self.api_key.expose_secret())
                .json(&request),
        )
    }

    /// Concrete entitlement grants (`GET {agents}/entitlements/instances`).
    pub fn entitlement_instances(&self) -> Result<Vec<HyperAgentEntitlement>, HyperCliError> {
        let items: Value = self.get_json("entitlements/instances")?;
        let items = items.get("items").cloned().unwrap_or(items);
        serde_json::from_value(items)
            .map_err(|error| HyperCliError::InvalidResponse(error.to_string()))
    }

    /// The agent product's account view (`GET {agents}/me`).
    pub fn agents_me(&self) -> Result<AgentsMe, HyperCliError> {
        self.get_json("me")
    }

    /// `GET {agents}/usage`: team usage summary for dashboard cards.
    pub fn usage_summary(&self) -> Result<HyperAgentUsageSummary, HyperCliError> {
        self.get_json("usage")
    }

    /// `GET {agents}/usage/history?days=` (1-30).
    pub fn usage_history(&self, days: u32) -> Result<HyperAgentUsageHistory, HyperCliError> {
        let url = self.endpoint("usage/history");
        let query = [("days", days.to_string())];
        self.send_json(
            "usage_history",
            "GET",
            &url,
            None,
            self.http
                .get(&url)
                .bearer_auth(self.api_key.expose_secret())
                .query(&query),
        )
    }

    /// `GET {agents}/usage/keys?days=` (1-30).
    pub fn usage_keys(&self, days: u32) -> Result<HyperAgentKeyUsage, HyperCliError> {
        let url = self.endpoint("usage/keys");
        let query = [("days", days.to_string())];
        self.send_json(
            "usage_keys",
            "GET",
            &url,
            None,
            self.http
                .get(&url)
                .bearer_auth(self.api_key.expose_secret())
                .query(&query),
        )
    }

    /// `GET {agents}/usage/agents?days=` (1-30).
    pub fn usage_agents(&self, days: u32) -> Result<HyperAgentAgentUsage, HyperCliError> {
        let url = self.endpoint("usage/agents");
        let query = [("days", days.to_string())];
        self.send_json(
            "usage_agents",
            "GET",
            &url,
            None,
            self.http
                .get(&url)
                .bearer_auth(self.api_key.expose_secret())
                .query(&query),
        )
    }

    /// `GET {agents}/billing/info`: the company's invoice billing identity.
    pub fn billing_info(&self) -> Result<HyperAgentBillingInfo, HyperCliError> {
        self.get_json("billing/info")
    }

    /// `GET {agents}/billing/profile`.
    pub fn billing_profile(&self) -> Result<HyperAgentBillingProfileResponse, HyperCliError> {
        self.get_json("billing/profile")
    }

    /// `PUT {agents}/billing/profile`.
    pub fn update_billing_profile(
        &self,
        profile: &HyperAgentBillingProfileFields,
    ) -> Result<HyperAgentBillingProfileResponse, HyperCliError> {
        let url = self.endpoint("billing/profile");
        self.send_json(
            "update_billing_profile",
            "PUT",
            &url,
            serde_json::to_value(profile).ok(),
            self.http
                .put(&url)
                .bearer_auth(self.api_key.expose_secret())
                .json(profile),
        )
    }

    /// `GET {agents}/billing/payments` with optional `limit`, `provider`,
    /// and `status` filters.
    pub fn payments(
        &self,
        limit: Option<u32>,
        provider: Option<&str>,
        status: Option<&str>,
    ) -> Result<HyperAgentPaymentsResponse, HyperCliError> {
        let url = self.endpoint("billing/payments");
        let mut query: Vec<(String, String)> = Vec::new();
        if let Some(limit) = limit {
            query.push(("limit".to_owned(), limit.to_string()));
        }
        if let Some(provider) = provider.filter(|value| !value.is_empty()) {
            query.push(("provider".to_owned(), provider.to_owned()));
        }
        if let Some(status) = status.filter(|value| !value.is_empty()) {
            query.push(("status".to_owned(), status.to_owned()));
        }
        self.send_json(
            "payments",
            "GET",
            &url,
            None,
            self.http
                .get(&url)
                .bearer_auth(self.api_key.expose_secret())
                .query(&query),
        )
    }

    /// `GET {agents}/billing/payments/{id}`.
    pub fn payment(&self, payment_id: &str) -> Result<HyperAgentPayment, HyperCliError> {
        self.get_json(&format!("billing/payments/{payment_id}"))
    }

    /// Create a Stripe Checkout session for a plan subscription
    /// (`POST {agents}/stripe/{plan_id}`).
    pub fn create_stripe_checkout(
        &self,
        plan_id: &str,
        success_url: Option<&str>,
        cancel_url: Option<&str>,
        quantity: Option<u32>,
    ) -> Result<HyperAgentStripeCheckoutResponse, HyperCliError> {
        if plan_id.trim().is_empty() {
            return Err(HyperCliError::InvalidResponse(
                "A canonical plan ID is required".to_owned(),
            ));
        }
        let url = self.endpoint(&format!("stripe/{plan_id}"));
        let mut request = Map::new();
        if let Some(success_url) = success_url {
            request.insert("success_url".to_owned(), json!(success_url));
        }
        if let Some(cancel_url) = cancel_url {
            request.insert("cancel_url".to_owned(), json!(cancel_url));
        }
        if let Some(quantity) = quantity {
            request.insert("quantity".to_owned(), json!(quantity));
        }
        let request = Value::Object(request);
        self.send_json(
            "create_stripe_checkout",
            "POST",
            &url,
            Some(request.clone()),
            self.http
                .post(&url)
                .bearer_auth(self.api_key.expose_secret())
                .json(&request),
        )
    }

    /// Create a Stripe Billing Portal session
    /// (`POST {agents}/stripe/billing-portal`). `flow_type` maps to the
    /// backend's `flow_data.type`.
    pub fn create_stripe_billing_portal_session(
        &self,
        return_url: &str,
        flow_type: Option<&str>,
    ) -> Result<HyperAgentStripeBillingPortalResponse, HyperCliError> {
        let url = self.endpoint("stripe/billing-portal");
        let mut request = json!({ "return_url": return_url });
        if let Some(flow_type) = flow_type {
            request["flow_data"] = json!({ "type": flow_type });
        }
        self.send_json(
            "create_stripe_billing_portal_session",
            "POST",
            &url,
            Some(request.clone()),
            self.http
                .post(&url)
                .bearer_auth(self.api_key.expose_secret())
                .json(&request),
        )
    }

    /// Mint a fresh agent/route-scoped access token for a running deployment
    /// (`GET {agents}/deployments/{id}/token`).
    pub fn refresh_deployment_token(
        &self,
        deployment_id: &str,
    ) -> Result<DeploymentAccessToken, HyperCliError> {
        self.get_json(&format!("deployments/{deployment_id}/token"))
    }

    /// Mint a new Orchestra API key scoped to one exact agent
    /// (`POST {agents}/deployments/{id}/keys` `{name}`).
    pub fn create_scoped_deployment_key(
        &self,
        deployment_id: &str,
        name: Option<&str>,
    ) -> Result<ApiKey, HyperCliError> {
        let url = self.endpoint(&format!("deployments/{deployment_id}/keys"));
        let request = match name {
            Some(name) => json!({ "name": name }),
            None => json!({}),
        };
        self.send_json(
            "create_scoped_deployment_key",
            "POST",
            &url,
            Some(request.clone()),
            self.http
                .post(&url)
                .bearer_auth(self.api_key.expose_secret())
                .json(&request),
        )
    }

    /// Mint a short-lived log-streaming credential
    /// (`POST {agents}/deployments/{id}/logs/token`). Only available while
    /// the agent is in a running state.
    pub fn deployment_logs_token(
        &self,
        deployment_id: &str,
    ) -> Result<DeploymentLogsToken, HyperCliError> {
        let url = self.endpoint(&format!("deployments/{deployment_id}/logs/token"));
        let token: DeploymentLogsToken = self.send_json(
            "deployment_logs_token",
            "POST",
            &url,
            None,
            self.http
                .post(&url)
                .bearer_auth(self.api_key.expose_secret()),
        )?;
        if !token.agent_id.is_empty() && token.agent_id != deployment_id {
            return Err(HyperCliError::InvalidResponse(
                "logs token was minted for a different agent".into(),
            ));
        }
        Ok(token)
    }

    /// Persisted log tail (`GET {agents}/deployments/{id}/logs`). Works in
    /// any agent state, including stopped.
    pub fn deployment_logs(
        &self,
        deployment_id: &str,
        tail_lines: Option<usize>,
    ) -> Result<String, HyperCliError> {
        #[derive(Deserialize)]
        struct LogsResponse {
            #[serde(default)]
            logs: String,
        }
        let response: LogsResponse = self.get_json(&format!("deployments/{deployment_id}/logs"))?;
        let logs = match tail_lines {
            Some(tail_lines) => {
                let lines: Vec<&str> = response.logs.lines().collect();
                if lines.len() > tail_lines {
                    lines[lines.len() - tail_lines..].join("\n")
                } else {
                    response.logs
                }
            }
            None => response.logs,
        };
        Ok(logs)
    }

    /// Run a Brave web search through the agents API proxy
    /// (`GET {agents}/brave/res/v1/web/search`). The API key travels as
    /// `X-Subscription-Token`; the backend substitutes its Brave key
    /// upstream.
    pub fn web_search(
        &self,
        query: &str,
        count: u32,
        extra_params: &BTreeMap<String, String>,
    ) -> Result<Value, HyperCliError> {
        let url = self.endpoint("brave/res/v1/web/search");
        let mut params: Vec<(String, String)> = vec![
            ("q".to_owned(), query.to_owned()),
            ("count".to_owned(), count.to_string()),
        ];
        params.extend(extra_params.iter().map(|(k, v)| (k.clone(), v.clone())));
        self.send_json(
            "web_search",
            "GET",
            &url,
            None,
            self.http
                .get(&url)
                .header("X-Subscription-Token", self.api_key.expose_secret())
                .header(reqwest::header::ACCEPT, "application/json")
                .query(&params),
        )
    }

    /// Compact public platform status from the hyperclaw status endpoint
    /// (`GET {agents}/status`). The shape is backend-owned.
    pub fn status(&self) -> Result<Value, HyperCliError> {
        self.get_json("status")
    }

    /// Jobs product API (`{product}/api/jobs`).
    pub fn jobs(&self) -> crate::jobs::JobsClient<'_> {
        crate::jobs::JobsClient { client: self }
    }

    /// Renders/flow API with subscription-capability routing.
    pub fn renders(&self) -> crate::renders::RendersClient<'_> {
        crate::renders::RendersClient {
            client: self,
            auth_me: &self.auth_me_cache,
        }
    }

    /// Product billing API (`{product}/api/balance`, `{product}/api/tx`).
    pub fn billing(&self) -> crate::billing::BillingClient<'_> {
        crate::billing::BillingClient { client: self }
    }

    /// File uploads for renders (`{product}/api/files`).
    pub fn files(&self) -> crate::files::FilesClient<'_> {
        crate::files::FilesClient { client: self }
    }

    /// GPU instance catalog (`{product}/instances/*`).
    pub fn instances(&self) -> crate::instances::InstancesClient<'_> {
        crate::instances::InstancesClient { client: self }
    }

    /// OpenAI-compatible model catalog (`GET {product}/v1/models`).
    pub fn models(&self) -> crate::models::ModelsClient<'_> {
        crate::models::ModelsClient { client: self }
    }

    /// User profile API (`GET {product}/api/user`).
    pub fn user(&self) -> crate::user::UserClient<'_> {
        crate::user::UserClient { client: self }
    }

    /// Product API-key management (`{product}/api/keys`).
    pub fn keys(&self) -> crate::keys::KeysClient<'_> {
        crate::keys::KeysClient { client: self }
    }

    pub fn entitlements(&self) -> Result<HyperAgentEntitlementsSummary, HyperCliError> {
        self.get_json("entitlements")
    }

    pub fn get_deployment(&self, deployment_id: &str) -> Result<Deployment, HyperCliError> {
        let url = self.endpoint(&format!("deployments/{deployment_id}"));
        let started = Instant::now();
        let response = match self.send_with_retry(
            self.http
                .get(&url)
                .bearer_auth(self.api_key.expose_secret()),
        ) {
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
        let ws_url = deployment_event_ws_url(&token.ws_url, &token.token)?;
        let (socket, _) = connect_async(ws_url.as_str()).await.map_err(|_| {
            HyperCliError::Transport("deployment event websocket connection failed".to_owned())
        })?;
        let mut socket = socket;
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

    /// Subscribe to job-scoped GPU/job lifecycle ticks using the public job ID.
    ///
    /// This resolves the job key internally, matching the Python and TypeScript
    /// SDK surfaces while keeping [`HyperCliClient::subscribe_job_lifecycle`]
    /// available for callers that already hold a job key.
    pub async fn subscribe_job_lifecycle_by_id<F>(
        &self,
        job_id: &str,
        handler: F,
    ) -> Result<(), HyperCliError>
    where
        F: FnMut(JobLifecycleEvent),
    {
        let job_key = self.job_key_for_job_id(job_id).await?;
        self.subscribe_job_lifecycle(&job_key, handler).await
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
        seen.ok_or_else(|| {
            HyperCliError::InvalidResponse("metrics stream closed before first snapshot".into())
        })
    }

    /// Get one GPU job metrics snapshot using the public job ID.
    pub async fn job_metrics_by_id(&self, job_id: &str) -> Result<Value, HyperCliError> {
        let job_key = self.job_key_for_job_id(job_id).await?;
        self.job_metrics(&job_key).await
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
        self.job_metrics_stream(job_key, interval, false, handler)
            .await
    }

    /// Subscribe to GPU job metrics snapshots using the public job ID.
    pub async fn subscribe_job_metrics_by_id<F>(
        &self,
        job_id: &str,
        interval: Duration,
        handler: F,
    ) -> Result<(), HyperCliError>
    where
        F: FnMut(Value),
    {
        let job_key = self.job_key_for_job_id(job_id).await?;
        self.subscribe_job_metrics(&job_key, interval, handler)
            .await
    }

    async fn job_key_for_job_id(&self, job_id: &str) -> Result<String, HyperCliError> {
        let url = self.product_endpoint(&format!("api/jobs/{job_id}"));
        let response = self
            .async_http
            .get(&url)
            .bearer_auth(self.api_key.expose_secret())
            .send()
            .await
            .map_err(|error| HyperCliError::Transport(error.to_string()))?;
        if !response.status().is_success() {
            return Err(HyperCliError::Status(response.status()));
        }
        let payload: Value = response
            .json()
            .await
            .map_err(|error| HyperCliError::InvalidResponse(error.to_string()))?;
        payload
            .get("job_key")
            .and_then(Value::as_str)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
            .ok_or_else(|| HyperCliError::InvalidResponse("job response missing job_key".into()))
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
        let response = match self.send_with_retry(
            self.http
                .post(&url)
                .bearer_auth(self.api_key.expose_secret())
                .json(&request_body),
        ) {
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
        let request_trace = serde_json::to_value(request)
            .ok()
            .map(redacted_launch_trace);
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

    pub fn read_deployment_file_bytes(
        &self,
        deployment_id: &str,
        path: &str,
        max_bytes: usize,
    ) -> Result<Vec<u8>, HyperCliError> {
        let token = self.deployment_file_token(deployment_id)?;
        let (url, _path) = reef_file_url(&token, path)?;
        let response = self
            .http
            .get(url.as_str())
            .bearer_auth(token.token)
            .send()
            .map_err(|error| HyperCliError::Transport(error.to_string()))?;
        let status = response.status();
        if !status.is_success() {
            return Err(HyperCliError::Status(status));
        }
        let bytes = response
            .bytes()
            .map_err(|error| HyperCliError::InvalidResponse(error.to_string()))?;
        let limit = max_bytes.min(AGENT_FILE_READ_MAX_BYTES);
        if bytes.len() > limit {
            return Err(HyperCliError::InvalidResponse(format!(
                "agent file reads are limited to {} MiB",
                limit / 1024 / 1024
            )));
        }
        Ok(bytes.to_vec())
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

    /// Rehydrate the stored owner-facing launch projection into the typed
    /// complete launch shape, suitable for callers that want to modify and
    /// submit a full [`crate::UpdateDeploymentRequest::launch_config`]
    /// replacement.
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
    /// neither sync policy is reduced to the typed exactly-one form.
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
        // representation; the typed complete shape uses one explicit boolean.
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

        // The typed complete shape uses exactly one sync policy. Includes win
        // when a legacy projection carries both; carrying neither canonicalizes
        // to the explicit sync-everything exclusion list.
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
                "agent {} stored launch_config is not a complete configuration: {error}",
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
        let request_body = serde_json::to_value(request)
            .map_err(|error| HyperCliError::InvalidResponse(error.to_string()))?;
        let request_trace = Some(request_body.clone());
        let started = Instant::now();
        let response = match self.send_with_retry(
            self.http
                .post(&url)
                .bearer_auth(self.api_key.expose_secret())
                .json(&request_body),
        ) {
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
        let response = match self.send_with_retry(
            self.http
                .post(&url)
                .bearer_auth(self.api_key.expose_secret()),
        ) {
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
    /// The returned token is opaque and intentionally unavailable to callers;
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

    pub(crate) fn product_endpoint(&self, path: &str) -> String {
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

    /// Send with transport-error retries (3 attempts with a linear backoff),
    /// matching the Python SDK's `request_with_retry`. Requests whose body
    /// cannot be replayed are sent once.
    pub(crate) fn send_with_retry(
        &self,
        builder: RequestBuilder,
    ) -> Result<reqwest::blocking::Response, reqwest::Error> {
        let mut current = builder;
        let mut attempts_used = 0u32;
        loop {
            let retry_builder = if attempts_used + 1 < TRANSPORT_RETRY_ATTEMPTS {
                current.try_clone()
            } else {
                None
            };
            match current.send() {
                Ok(response) => return Ok(response),
                Err(error) => {
                    attempts_used += 1;
                    match retry_builder.filter(|_| transport_error_is_retryable(&error)) {
                        Some(next) => {
                            current = next;
                            std::thread::sleep(TRANSPORT_RETRY_BACKOFF * attempts_used);
                        }
                        None => return Err(error),
                    }
                }
            }
        }
    }

    pub(crate) fn send_json<T: DeserializeOwned>(
        &self,
        operation: &str,
        method: &str,
        url: &str,
        request: Option<Value>,
        builder: RequestBuilder,
    ) -> Result<T, HyperCliError> {
        let started = Instant::now();
        let response = match self.send_with_retry(builder) {
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
    use crate::{AgentSize, ManagedRuntime};
    use mockito::{Matcher, Server};
    use secrecy::SecretString;
    use std::sync::{Arc, Mutex};
    use tokio::net::TcpListener;
    use tokio_tungstenite::accept_hdr_async;

    fn client(server: &Server) -> HyperCliClient {
        HyperCliClient::new(ClientConfig {
            api_base: Url::parse(&format!("{}/agents", server.url())).unwrap(),
            api_key: SecretString::from("test-credential"),
            trace_file: None,
            timeout: None,
        })
        .unwrap()
    }
    fn complete_start() -> StartDeploymentRequest {
        StartDeploymentRequest::new()
    }

    async fn accept_deployment_event_socket(listener: &TcpListener) -> WebSocketStream<TcpStream> {
        let (stream, _) = listener.accept().await.unwrap();
        #[allow(clippy::result_large_err)]
        accept_hdr_async(
            stream,
            |request: &tokio_tungstenite::tungstenite::handshake::server::Request, response| {
                assert_eq!(request.uri().query(), Some("token=event-token"));
                Ok(response)
            },
        )
        .await
        .unwrap()
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
            let mut socket = accept_deployment_event_socket(&listener).await;
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
                timeout: None,
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
            let mut socket = accept_deployment_event_socket(&listener).await;
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
                timeout: None,
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
                let mut socket = accept_deployment_event_socket(&listener).await;
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
                timeout: None,
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
            let mut socket = accept_deployment_event_socket(&listener).await;
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
                timeout: None,
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
            let mut socket = accept_deployment_event_socket(&listener).await;
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
                timeout: None,
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
            let mut socket = accept_deployment_event_socket(&listener).await;
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
                timeout: None,
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
                timeout: None,
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
                let mut socket = accept_deployment_event_socket(&listener).await;
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
                    timeout: None,
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

        assert_eq!(
            serde_json::to_value(StartDeploymentRequest::new()).unwrap(),
            json!({})
        );
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
                    "command": ["/usr/local/bin/acp"],
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
        request.command = vec![
            "/usr/local/bin/acp".to_owned(),
            "plugin".to_owned(),
            "buzz".to_owned(),
        ];
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

        let entitlements = client(&server).subscription_summary().unwrap();
        assert_eq!(entitlements.active_subscription_count, 0);
        assert_eq!(entitlements.active_entitlement_count, 1);
        assert_eq!(entitlements.agent_slots[0].size, "medium");
        assert!(entitlements.has_active_plan());
        summary.assert();
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
            timeout: None,
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
    fn start_posts_start_options_without_launch_config() {
        let mut server = Server::new();
        let mut request = complete_start();
        request.dry_run = true;
        let mock = server
            .mock("POST", "/agents/deployments/deployment-1/start")
            .match_header("authorization", "Bearer test-credential")
            .match_body(Matcher::JsonString(
                serde_json::json!({"dry_run": true}).to_string(),
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
            .match_body(Matcher::JsonString(json!({}).to_string()))
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
                        "/ws/exec/deployment-1?token=exec-token"
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
        let token=server.mock("POST","/agents/deployments/deployment-1/exec/token").match_header("authorization","Bearer test-credential").with_status(200).with_header("content-type","application/json").with_body(json!({"agent_id":"deployment-1","token":"exec-token","expires_at":"2026-08-16T00:00:00Z","ws_url":ws_url}).to_string()).create_async().await;
        (server, token, task)
    }

    async fn client_for_async_test(server: &mockito::ServerGuard) -> HyperCliClient {
        let api_base = Url::parse(&format!("{}/agents", server.url())).unwrap();
        tokio::task::spawn_blocking(move || {
            HyperCliClient::new(ClientConfig {
                api_base,
                api_key: SecretString::from("test-credential"),
                trace_file: None,
                timeout: None,
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
                        "/ws/metrics/deployment-1?token=metrics-token"
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
        let token=server.mock("POST","/agents/deployments/deployment-1/metrics/token").match_header("authorization","Bearer test-credential").with_status(200).with_header("content-type","application/json").with_body(json!({"agent_id":"deployment-1","token":"metrics-token","expires_at":"2026-08-16T00:00:00Z","ws_url":ws_url}).to_string()).create_async().await;
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
                    "token": "short-lived-secret",
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
    async fn operation_connection_errors_never_expose_the_short_lived_token() {
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
                    "token": "short-lived-secret",
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
                        "command": ["/usr/local/bin/acp"],
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
                        "command": ["/usr/local/bin/acp"],
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
                    serde_json::json!(["/usr/local/bin/acp"]),
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
            timeout: None,
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
    fn stored_launch_config_completes_the_projection_for_launch_config_update() {
        // The owner projection redacts secrets and registry_auth, and
        // DeploymentLaunchConfig strips them again, so callers that want a full
        // update replacement need this rebuild.
        let mut server = Server::new();
        let projection = mock_projection(&mut server, stored_projection(serde_json::json!({})));
        let secrets = mock_secrets(&mut server, 4);

        let client = client(&server);
        let launch_config = client.stored_launch_config("deployment-1", None).unwrap();
        assert_eq!(launch_config.secrets["API_TOKEN"], "recovered-token");
        assert!(launch_config.registry_auth.is_empty());
        assert_eq!(
            launch_config.sync_exclude.as_deref(),
            Some([".git".to_owned()].as_slice())
        );
        projection.assert();
        for secret in secrets {
            secret.assert();
        }
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
        assert!(serde_json::to_value(launch_config).is_ok());

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
            stored_projection(serde_json::json!({"-env": null})),
        );
        let _secrets = mock_secrets(&mut server, 4);

        let error = client(&server)
            .stored_launch_config("deployment-1", None)
            .err()
            .expect("stored_launch_config must fail")
            .to_string();
        assert!(error.contains("deployment-1"), "{error}");
        assert!(error.contains("env"), "{error}");
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
                    "token": "short-lived-shell-token",
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
                    "token": "short-lived-shell-token",
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
        assert_eq!(token.token.expose_secret(), "short-lived-shell-token");
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
            timeout: None,
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

    #[test]
    fn transport_errors_retry_three_attempts_with_backoff() {
        // A closed listener yields connection-refused (retryable) for every
        // attempt; the linear backoff (1s + 2s) bounds the total runtime.
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        let address = listener.local_addr().unwrap();
        drop(listener);
        let mut server = Server::new();
        let unused = server.mock("GET", "/agents/status").expect(0).create();
        let client = HyperCliClient::new(ClientConfig {
            api_base: Url::parse(&format!("http://{address}/agents")).unwrap(),
            api_key: SecretString::from("test-credential"),
            trace_file: None,
            timeout: Some(Duration::from_secs(5)),
        })
        .unwrap();

        let started = Instant::now();
        let error = client.status().unwrap_err();

        assert!(matches!(error, HyperCliError::Transport(_)));
        assert!(
            started.elapsed() >= Duration::from_secs(3),
            "transport retries did not back off twice"
        );
        unused.assert();
    }

    #[test]
    fn status_responses_are_not_retried() {
        let mut server = Server::new();
        let not_found = server
            .mock("GET", "/agents/status")
            .with_status(404)
            .with_header("content-type", "application/json")
            .with_body("{}")
            .expect(1)
            .create();
        let client = client(&server);

        let error = client.status().unwrap_err();

        assert_eq!(error.status(), Some(StatusCode::NOT_FOUND));
        not_found.assert();
    }

    #[test]
    fn auth_me_parses_nested_and_flat_runtime_identities() {
        let mut server = Server::new();
        let nested = server
            .mock("GET", "/api/auth/me")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "user_id": "user-1",
                    "auth_type": "api_key",
                    "runtime": {"runtime": "agent", "agent_id": "agent-1"}
                })
                .to_string(),
            )
            .create();
        let flat = server
            .mock("GET", "/api/auth/me")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"user_id": "user-1", "auth_type": "api_key", "runtime": "agent", "agent_id": "agent-2"}).to_string())
            .create();
        let absent = server
            .mock("GET", "/api/auth/me")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"user_id": "user-1", "auth_type": "user"}).to_string())
            .create();

        let client = client(&server);
        let nested_identity = client.auth_me().unwrap();
        assert!(nested_identity.is_runtime_agent());
        assert_eq!(nested_identity.runtime_agent_id(), Some("agent-1"));

        let flat_identity = client.auth_me().unwrap();
        assert_eq!(flat_identity.runtime_agent_id(), Some("agent-2"));

        let none_identity = client.auth_me().unwrap();
        assert!(!none_identity.is_runtime_agent());
        assert!(none_identity.runtime.is_none());
        nested.assert();
        flat.assert();
        absent.assert();
    }

    #[test]
    fn subscription_endpoints_parse_the_real_shapes() {
        let mut server = Server::new();
        let summary = server
            .mock("GET", "/agents/subscriptions/summary")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({
                    "effective_plan_id": "team",
                    "current_subscription_id": "sub-1",
                    "current_entitlement_id": "ent-1",
                    "pooled_tpm_limit": 40000,
                    "pooled_rpm_limit": 100,
                    "pooled_tpd": 5000000,
                    "active_subscription_count": 1,
                    "active_entitlement_count": 1,
                    "billing_reset_at": "2026-10-01T00:00:00Z",
                    "entitlements": {"effective_plan_id": "team", "pooled_tpm_limit": 40000},
                    "entitlement_items": [{"id": "ent-1", "plan_id": "team", "provider": "stripe", "status": "active"}],
                    "active_subscriptions": [{"id": "sub-1", "plan_id": "team", "provider": "stripe", "status": "active", "quantity": 1, "current_period_end": "2026-10-01T00:00:00Z", "trial": {"active": true, "days": "7", "seconds_remaining": 600}}],
                    "subscriptions": [{"id": "sub-1", "plan_id": "team", "provider": "stripe", "status": "active"}],
                    "user": {"user_id": "user-1", "email": "user@example.com"}
                })
                .to_string(),
            )
            .expect(1)
            .create();
        let subscriptions = server
            .mock("GET", "/agents/subscriptions")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"items": [{"id": "sub-1", "plan_id": "team", "provider": "stripe", "status": "active", "can_cancel": true, "is_current": true}], "current_subscription_id": "sub-1", "effective_plan_id": "team"}).to_string())
            .expect(1)
            .create();
        let cancel = server
            .mock("POST", "/agents/subscriptions/sub-1/cancel")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"ok": true, "message": "canceled"}).to_string())
            .expect(1)
            .create();
        let update = server
            .mock("POST", "/agents/subscriptions/sub-1/update")
            .match_body(Matcher::Json(json!({"plan_id": "pro", "quantity": 2})))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"ok": true, "message": "updated", "subscription": {"id": "sub-1", "plan_id": "pro", "provider": "stripe", "status": "active"}}).to_string())
            .expect(1)
            .create();
        let instances = server
            .mock("GET", "/agents/entitlements/instances")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"items": [{"id": "ent-1", "plan_id": "team", "provider": "stripe", "status": "active", "active_agent_count": 2}]}).to_string())
            .expect(1)
            .create();
        let client = client(&server);

        let parsed_summary = client.subscription_summary().unwrap();
        assert_eq!(parsed_summary.effective_plan_id, "team");
        assert_eq!(
            parsed_summary.current_subscription_id.as_deref(),
            Some("sub-1")
        );
        assert_eq!(parsed_summary.entitlements.pooled_tpm_limit, 40000);
        assert_eq!(parsed_summary.subscriptions.len(), 1);
        assert_eq!(
            parsed_summary.active_subscriptions[0]
                .trial
                .as_ref()
                .unwrap()
                .seconds_remaining,
            Some(600)
        );
        assert_eq!(
            parsed_summary.active_subscriptions[0].period_end(),
            Some("2026-10-01T00:00:00Z")
        );
        assert_eq!(
            parsed_summary.user.email.as_deref(),
            Some("user@example.com")
        );

        let list = client.subscriptions().unwrap();
        assert_eq!(list.items.len(), 1);
        assert!(list.items[0].can_cancel);

        assert_eq!(client.cancel_subscription("sub-1").unwrap()["ok"], true);

        let updated = client.update_subscription("sub-1", "pro", 2).unwrap();
        assert!(updated.ok);
        assert_eq!(updated.subscription.unwrap().plan_id, "pro");

        let parsed_instances = client.entitlement_instances().unwrap();
        assert_eq!(parsed_instances.len(), 1);
        assert_eq!(parsed_instances[0].active_agent_count, 2);

        summary.assert();
        subscriptions.assert();
        cancel.assert();
        update.assert();
        instances.assert();
    }

    #[test]
    fn usage_endpoints_parse_summaries_history_keys_and_agents() {
        let mut server = Server::new();
        let summary = server
            .mock("GET", "/agents/usage")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"total_tokens": 100, "prompt_tokens": 60, "completion_tokens": 40, "request_count": 3, "active_keys": 2, "current_tpm": 1000, "current_rpm": 10, "period": "30d"}).to_string())
            .expect(1)
            .create();
        let history = server
            .mock("GET", "/agents/usage/history")
            .match_query(Matcher::UrlEncoded("days".into(), "7".into()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"history": [{"date": "2026-09-08", "total_tokens": 100, "prompt_tokens": 60, "completion_tokens": 40, "requests": 3}], "days": 7}).to_string())
            .expect(1)
            .create();
        let keys = server
            .mock("GET", "/agents/usage/keys")
            .match_query(Matcher::UrlEncoded("days".into(), "7".into()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"keys": [{"key_hash": "sk-hash", "name": "default", "total_tokens": 100, "prompt_tokens": 60, "completion_tokens": 40, "requests": 3}], "days": 7}).to_string())
            .expect(1)
            .create();
        let agents = server
            .mock("GET", "/agents/usage/agents")
            .match_query(Matcher::UrlEncoded("days".into(), "1".into()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"agents": [{"agent_id": "agent-1", "name": "demo", "managed": true, "avatar_url": null, "total_tokens": 100, "prompt_tokens": 60, "completion_tokens": 40, "requests": 3}], "unattributed": {"total_tokens": 0, "prompt_tokens": 0, "completion_tokens": 0, "requests": 0}, "days": 1}).to_string())
            .expect(1)
            .create();
        let client = client(&server);

        assert_eq!(client.usage_summary().unwrap().current_tpm, 1000);
        assert_eq!(
            client.usage_history(7).unwrap().history[0].date,
            "2026-09-08"
        );
        assert_eq!(client.usage_keys(7).unwrap().keys[0].name, "default");
        let parsed_agents = client.usage_agents(1).unwrap();
        assert_eq!(parsed_agents.agents[0].agent_id.as_deref(), Some("agent-1"));
        assert_eq!(parsed_agents.agents[0].metrics.total_tokens, 100);

        summary.assert();
        history.assert();
        keys.assert();
        agents.assert();
    }

    #[test]
    fn billing_profile_info_and_payments_round_trip() {
        let mut server = Server::new();
        let info = server
            .mock("GET", "/agents/billing/info")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({"address": ["One Way", "SF"], "email": "billing@example.com"}).to_string(),
            )
            .expect(1)
            .create();
        let profile_get = server
            .mock("GET", "/agents/billing/profile")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"company_billing": {"address": [], "email": "billing@example.com"}, "profile": {"billing_name": "Jane", "billing_country": "US"}}).to_string())
            .expect(1)
            .create();
        let profile_put = server
            .mock("PUT", "/agents/billing/profile")
            .match_body(Matcher::PartialJson(json!({"billing_name": "Jane"})))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"company_billing": {"address": [], "email": "billing@example.com"}, "profile": {"billing_name": "Jane"}, "synced_stripe_customer_ids": ["cus_1"]}).to_string())
            .expect(1)
            .create();
        let payments = server
            .mock("GET", "/agents/billing/payments")
            .match_query(Matcher::AllOf(vec![
                Matcher::UrlEncoded("limit".into(), "25".into()),
                Matcher::UrlEncoded("provider".into(), "stripe".into()),
            ]))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"items": [{"id": "pay-1", "user_id": "user-1", "provider": "stripe", "status": "paid", "amount": "25.00", "currency": "usd"}]}).to_string())
            .expect(1)
            .create();
        let payment = server
            .mock("GET", "/agents/billing/payments/pay-1")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"id": "pay-1", "user_id": "user-1", "provider": "stripe", "status": "paid", "amount": "25.00", "currency": "usd", "subscription": {"id": "sub-1", "plan_id": "team", "provider": "stripe", "status": "active", "current_period_end": "2026-10-01T00:00:00Z"}}).to_string())
            .expect(1)
            .create();
        let client = client(&server);

        assert_eq!(client.billing_info().unwrap().email, "billing@example.com");
        assert_eq!(
            client
                .billing_profile()
                .unwrap()
                .profile
                .unwrap()
                .billing_name
                .as_deref(),
            Some("Jane")
        );
        assert_eq!(
            client
                .update_billing_profile(&HyperAgentBillingProfileFields {
                    billing_name: Some("Jane".to_owned()),
                    ..Default::default()
                })
                .unwrap()
                .synced_stripe_customer_ids,
            Some(vec!["cus_1".to_owned()])
        );
        assert_eq!(
            client
                .payments(Some(25), Some("stripe"), None)
                .unwrap()
                .items[0]
                .id,
            "pay-1"
        );
        assert_eq!(
            client
                .payment("pay-1")
                .unwrap()
                .subscription
                .unwrap()
                .plan_id,
            "team"
        );

        info.assert();
        profile_get.assert();
        profile_put.assert();
        payments.assert();
        payment.assert();
    }

    #[test]
    fn stripe_checkout_and_billing_portal_parse_their_responses() {
        let mut server = Server::new();
        let checkout = server
            .mock("POST", "/agents/stripe/team")
            .match_body(Matcher::Json(
                json!({"success_url": "https://example.com/ok", "quantity": 2}),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"checkout_url": "https://checkout.stripe.com/session"}).to_string())
            .expect(1)
            .create();
        let portal = server
            .mock("POST", "/agents/stripe/billing-portal")
            .match_body(Matcher::Json(json!({"return_url": "https://example.com/back", "flow_data": {"type": "payment_method_update"}})))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"id": "bps_1", "url": "https://billing.stripe.com/portal"}).to_string())
            .expect(1)
            .create();
        let client = client(&server);

        let checkout_result = client
            .create_stripe_checkout("team", Some("https://example.com/ok"), None, Some(2))
            .unwrap();
        assert_eq!(
            checkout_result.checkout_url,
            "https://checkout.stripe.com/session"
        );

        let portal_result = client
            .create_stripe_billing_portal_session(
                "https://example.com/back",
                Some("payment_method_update"),
            )
            .unwrap();
        assert_eq!(portal_result.url, "https://billing.stripe.com/portal");

        checkout.assert();
        portal.assert();
    }

    #[test]
    fn agents_me_parses_the_agent_product_account_view() {
        let mut server = Server::new();
        let me = server
            .mock("GET", "/agents/me")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"user_id": "user-1", "orchestra_user_id": "user-1", "team_id": "team-1", "plan_id": "team", "auth_type": "user", "capabilities": ["flows:*"], "auth_capabilities": ["agents"], "has_active_subscription": true, "key_name": "default"}).to_string())
            .expect(1)
            .create();
        let client = client(&server);

        let parsed_me = client.agents_me().unwrap();
        assert_eq!(parsed_me.team_id, "team-1");
        assert_eq!(parsed_me.capabilities, ["flows:*"]);
        assert!(parsed_me.has_active_subscription);
        me.assert();
    }

    #[test]
    fn deployment_token_key_and_logs_routes_parse_their_payloads() {
        let mut server = Server::new();
        let token = server
            .mock("GET", "/agents/deployments/agent-1/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"agent_id": "agent-1", "token": "fresh-token", "expires_at": "2026-09-09T00:00:00Z"}).to_string())
            .expect(1)
            .create();
        let scoped = server
            .mock("POST", "/agents/deployments/agent-1/keys")
            .match_body(Matcher::Json(json!({"name": "child"})))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!({"key_id": "key-9", "name": "child", "api_key": "scoped-secret"}).to_string(),
            )
            .expect(1)
            .create();
        let logs_token = server
            .mock("POST", "/agents/deployments/agent-1/logs/token")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"agent_id": "agent-1", "token": "logs-token", "expires_at": "2026-09-09T00:00:00Z", "ws_url": "wss://example/ws/logs/agent-1"}).to_string())
            .expect(1)
            .create();
        let logs = server
            .mock("GET", "/agents/deployments/agent-1/logs")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"logs": "a\nb\nc"}).to_string())
            .expect(1)
            .create();
        let client = client(&server);

        let refreshed = client.refresh_deployment_token("agent-1").unwrap();
        assert_eq!(refreshed.agent_id, "agent-1");
        assert_eq!(refreshed.token, "fresh-token");

        let scoped_key = client
            .create_scoped_deployment_key("agent-1", Some("child"))
            .unwrap();
        assert_eq!(scoped_key.api_key.as_deref(), Some("scoped-secret"));

        let parsed_logs_token = client.deployment_logs_token("agent-1").unwrap();
        assert_eq!(parsed_logs_token.token, "logs-token");

        assert_eq!(client.deployment_logs("agent-1", Some(2)).unwrap(), "b\nc");

        token.assert();
        scoped.assert();
        logs_token.assert();
        logs.assert();
    }

    #[test]
    fn web_search_uses_the_subscription_token_header() {
        let mut server = Server::new();
        let search = server
            .mock("GET", "/agents/brave/res/v1/web/search")
            .match_header("x-subscription-token", "test-credential")
            .match_query(Matcher::AllOf(vec![
                Matcher::UrlEncoded("q".into(), "hypercli".into()),
                Matcher::UrlEncoded("count".into(), "5".into()),
            ]))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"web": {"results": []}}).to_string())
            .expect(1)
            .create();
        let client = client(&server);

        let result = client.web_search("hypercli", 5, &BTreeMap::new()).unwrap();

        assert!(result["web"]["results"].is_array());
        search.assert();
    }

    #[test]
    fn status_gets_the_compact_platform_status() {
        let mut server = Server::new();
        let status = server
            .mock("GET", "/agents/status")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"ok": true}).to_string())
            .expect(1)
            .create();
        let client = client(&server);

        assert_eq!(client.status().unwrap()["ok"], true);
        status.assert();
    }
}
