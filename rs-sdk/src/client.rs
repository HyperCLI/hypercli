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
use tokio_tungstenite::{connect_async, tungstenite::Message, MaybeTlsStream, WebSocketStream};
use url::Url;

use crate::runtime_auth::{auth_status_command, RuntimeShellTokenResponse};
use crate::{
    AgentCapacity, ApiKey, AuthMe, ClientConfig, CreateApiKeyRequest, CreateDeploymentRequest,
    DeleteDeploymentResponse, Deployment, DeploymentEvent, DeploymentFileWriteResponse,
    DeploymentListFilters, DeploymentProfileImageResponse, DeploymentRoutes, ExecDeploymentRequest,
    ExecDeploymentResponse, HyperAgentCurrentPlan, HyperAgentEntitlementsSummary, HyperAgentPlan,
    NativeRuntime, RuntimeAuthError, RuntimeAuthStatus, RuntimeLoginSession, RuntimeShellToken,
    SetDeploymentRouteRequest, SetDeploymentRoutesRequest, StartDeploymentRequest,
    UpdateDeploymentRequest,
};

type DeploymentEventSocket = WebSocketStream<MaybeTlsStream<TcpStream>>;

/// Consumer-side settling window before the first request to a newly issued
/// hostname.  The API commits the Cloudflare record and returns immediately;
/// callers avoid a transient NXDOMAIN by waiting locally instead of holding a
/// backend transaction open.
pub const DEFAULT_HOSTNAME_SETTLE_DELAY: Duration = Duration::from_secs(15);

#[derive(Deserialize)]
struct DeploymentEventTokenResponse {
    token: String,
    ws_url: String,
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
    if object
        .get("sync_include")
        .is_some_and(|value| !value.is_null())
    {
        object.insert("sync_exclude".to_owned(), Value::Null);
    }
    Ok(body)
}

fn permanent_deployment_event_error(error: &HyperCliError) -> bool {
    error
        .status()
        .is_some_and(|status| matches!(status, StatusCode::UNAUTHORIZED | StatusCode::FORBIDDEN))
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
            .build()
            .map_err(|error| HyperCliError::Transport(error.to_string()))?;
        let async_http = AsyncHttpClient::builder()
            .timeout(timeout)
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
                        if event.event_type == "deployment.transition" && !event.agent_id.is_empty()
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

    /// Wait for a deployment state using WebSocket wakeups and REST confirmation.
    pub async fn wait_deployment_state(
        &self,
        deployment_id: &str,
        states: &[&str],
        failure_states: &[&str],
        timeout: Duration,
    ) -> Result<Deployment, HyperCliError> {
        if states.is_empty() {
            return Err(HyperCliError::InvalidResponse(
                "deployment wait states must not be empty".to_owned(),
            ));
        }
        tokio::time::timeout(timeout, async {
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
            let mut retry_delay = Duration::from_millis(250);
            loop {
                let mut socket = match self.connect_deployment_events().await {
                    Ok(socket) => {
                        retry_delay = Duration::from_millis(250);
                        socket
                    }
                    Err(error) if permanent_deployment_event_error(&error) => return Err(error),
                    Err(_) => {
                        tokio::time::sleep(retry_delay).await;
                        retry_delay = (retry_delay * 2).min(Duration::from_secs(5));
                        continue;
                    }
                };
                if let Some(deployment) = check(
                    self.async_get_json(&format!("deployments/{deployment_id}"))
                        .await?,
                )? {
                    return Ok(deployment);
                }
                while let Some(message) = socket.next().await {
                    let value = match message {
                        Ok(Message::Text(value)) => value,
                        Ok(Message::Ping(value)) => {
                            if socket.send(Message::Pong(value)).await.is_err() {
                                break;
                            }
                            continue;
                        }
                        Ok(Message::Close(_)) | Err(_) => break,
                        _ => continue,
                    };
                    let Ok(event) = serde_json::from_str::<DeploymentEvent>(value.as_ref()) else {
                        break;
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
                tokio::time::sleep(retry_delay).await;
                retry_delay = (retry_delay * 2).min(Duration::from_secs(5));
            }
        })
        .await
        .map_err(|_| HyperCliError::Transport("deployment wait timed out".to_owned()))?
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
        let request_trace = Some(request_body.clone());
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
        let result = decode_json(response);
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

    /// Write a file through the managed agent file API without placing its
    /// content in argv, query strings, or HTTP traces. Paths are deliberately
    /// restricted to simple relative segments; callers choose whether the
    /// backend targets the running pod or persisted storage automatically.
    pub fn put_deployment_file(
        &self,
        deployment_id: &str,
        path: &str,
        content: &[u8],
    ) -> Result<DeploymentFileWriteResponse, HyperCliError> {
        let path = path.trim_matches('/');
        let valid = !path.is_empty()
            && path.split('/').all(|segment| {
                !segment.is_empty()
                    && segment != "."
                    && segment != ".."
                    && segment.chars().all(|value| {
                        value.is_ascii_alphanumeric() || matches!(value, '.' | '_' | '-')
                    })
            });
        if !valid {
            return Err(HyperCliError::InvalidResponse(
                "deployment file path must contain only safe relative segments".to_owned(),
            ));
        }
        let url = self.endpoint(&format!("deployments/{deployment_id}/files/{path}"));
        let request_trace = json!({"path": path, "size": content.len(), "content": "<omitted>"});
        let builder = self
            .http
            .post(&url)
            .bearer_auth(self.api_key.expose_secret())
            .body(content.to_vec());
        self.send_json(
            "put_deployment_file",
            "POST",
            &url,
            Some(request_trace),
            builder,
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

    pub fn start_deployment(
        &self,
        deployment_id: &str,
        request: &StartDeploymentRequest,
    ) -> Result<Deployment, HyperCliError> {
        let url = self.endpoint(&format!("deployments/{deployment_id}/start"));
        let request_body = deployment_request_body(request)?;
        let request_trace = Some(request_body.clone());
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

    pub fn exec_deployment(
        &self,
        deployment_id: &str,
        request: &ExecDeploymentRequest,
    ) -> Result<ExecDeploymentResponse, HyperCliError> {
        let url = self.endpoint(&format!("deployments/{deployment_id}/exec"));
        let started = Instant::now();
        let response = match self
            .http
            .post(&url)
            .bearer_auth(self.api_key.expose_secret())
            .json(request)
            .send()
        {
            Ok(response) => response,
            Err(error) => {
                let error = HyperCliError::Transport(error.to_string());
                self.trace_http(
                    "exec_deployment",
                    "POST",
                    &url,
                    Some(&json!({"command": "<omitted>", "timeout": request.timeout, "dry_run": request.dry_run})),
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
            "exec_deployment",
            "POST",
            &url,
            Some(&json!({"command": "<omitted>", "timeout": request.timeout, "dry_run": request.dry_run})),
            started,
            Some(status),
            headers,
            result.as_ref().map(|_| ()),
        );
        result
    }

    /// Read the normalized native-login state from the image-owned wrapper.
    ///
    /// The command is fixed by the SDK rather than accepted from the caller.
    /// This keeps Desktop's login UI separate from the arbitrary exec surface.
    pub fn runtime_auth_status(
        &self,
        deployment_id: &str,
    ) -> Result<RuntimeAuthStatus, RuntimeAuthError> {
        let mut request = ExecDeploymentRequest::new(auth_status_command());
        request.timeout = 15;
        let response = self.exec_deployment(deployment_id, &request)?;
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
        if (deployment_id != "self" && token.agent_id != deployment_id) || token.dry_run {
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
    use crate::{AgentSize, ManagedRuntime};
    use mockito::{Matcher, Server};
    use secrecy::SecretString;
    use std::sync::{Arc, Mutex};
    use tokio::net::TcpListener;
    use tokio_tungstenite::accept_async;

    fn client(server: &Server) -> HyperCliClient {
        HyperCliClient::new(ClientConfig {
            api_base: Url::parse(&format!("{}/agents", server.url())).unwrap(),
            api_key: SecretString::from("test-credential"),
            trace_file: None,
        })
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
                        "placement_epoch": 8,
                        "runtime_generation": 3
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
            assert_eq!(received[0].runtime_generation, Some(3));
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
                            "placement_epoch": 8,
                            "runtime_generation": 3
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
                        "placement_epoch": 8,
                        "runtime_generation": 3
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
        websocket.await.unwrap();
        stopped.assert_async().await;
        token.assert_async().await;
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
            websocket.await.unwrap();
            observed.assert_async().await;
            token.assert_async().await;
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
    fn deployment_wire_omits_legacy_sync_state_and_normalizes_filter_precedence() {
        let mut request = CreateDeploymentRequest::new(ManagedRuntime::Codex);
        let without_root = deployment_request_body(&request).unwrap();
        assert!(without_root.get("sync_enabled").is_none());

        request.sync_root = Some("/home/node".to_owned());
        request.sync_include = Some(vec![".codex".to_owned()]);
        request.sync_exclude = Some(vec!["tmp".to_owned()]);
        let create = deployment_request_body(&request).unwrap();
        assert!(create.get("sync_enabled").is_none());
        assert_eq!(create["sync_root"], serde_json::json!("/home/node"));
        assert_eq!(create["sync_include"], serde_json::json!([".codex"]));
        assert!(create["sync_exclude"].is_null());

        let mut request = StartDeploymentRequest {
            sync_root: Some("/workspace".to_owned()),
            ..StartDeploymentRequest::default()
        };
        request.set_sync_policy(Some(vec!["src".to_owned()]), Some(vec!["tmp".to_owned()]));
        let start = deployment_request_body(&request).unwrap();
        assert!(start.get("sync_enabled").is_none());
        assert_eq!(start["sync_root"], serde_json::json!("/workspace"));
        assert_eq!(start["sync_include"], serde_json::json!(["src"]));
        assert!(start["sync_exclude"].is_null());
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
        request.sync_root = Some("/home/node".to_owned());
        let created = client(&server).create_deployment(&request).unwrap();

        assert_eq!(created.id, "deployment-1");
        assert_eq!(created.runtime, Some(ManagedRuntime::Opencode));
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
    fn routes_support_self_and_declarative_replacement() {
        let mut server = Server::new();
        let response = serde_json::json!({
            "agent_id": "deployment-1",
            "routes": {"web": {"port": 3000, "auth": true, "prefix": "app"}},
            "route_statuses": {"web": {"url": "https://app-agent.hypercli.app"}}
        });
        let get_mock = server
            .mock("GET", "/agents/deployments/self/routes")
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response.to_string())
            .create();
        let put_mock = server
            .mock("PUT", "/agents/deployments/self/routes")
            .match_header("authorization", "Bearer test-credential")
            .match_body(Matcher::JsonString(
                serde_json::json!({
                    "routes": {"web": {"port": 3000, "auth": true, "prefix": "app"}}
                })
                .to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(response.to_string())
            .create();

        let client = client(&server);
        let current = client.get_deployment_routes("self").unwrap();
        assert_eq!(current.routes["web"].port, 3000);

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
            .set_deployment_routes("self", &crate::SetDeploymentRoutesRequest { routes })
            .unwrap();
        assert_eq!(updated.agent_id, "deployment-1");
        get_mock.assert();
        put_mock.assert();
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
            .mock("PUT", "/agents/deployments/self/routes/web%20app")
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
            .mock("DELETE", "/agents/deployments/self/routes/web%20app")
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
            .set_deployment_route("self", "web app", &request)
            .unwrap();
        client.remove_deployment_route("self", "web app").unwrap();
        put_mock.assert();
        delete_mock.assert();
    }

    #[test]
    fn exec_posts_typed_request_and_decodes_output() {
        let mut server = Server::new();
        let mock = server
            .mock("POST", "/agents/deployments/deployment-1/exec")
            .match_header("authorization", "Bearer test-credential")
            .match_body(Matcher::JsonString(
                serde_json::json!({
                    "command": "/usr/local/bin/hypercli-buzz-onboard status",
                    "timeout": 5,
                    "dry_run": false
                })
                .to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "exit_code": 0,
                    "stdout": "{\"phase\":\"ready\"}\n",
                    "stderr": "",
                    "dry_run": false
                })
                .to_string(),
            )
            .create();

        let mut request = ExecDeploymentRequest::new("/usr/local/bin/hypercli-buzz-onboard status");
        request.timeout = 5;
        let response = client(&server)
            .exec_deployment("deployment-1", &request)
            .unwrap();

        assert_eq!(response.exit_code, 0);
        assert_eq!(response.stdout, "{\"phase\":\"ready\"}\n");
        assert!(response.stderr.is_empty());
        mock.assert();
    }

    #[test]
    fn runtime_auth_status_uses_fixed_wrapper_and_normalized_shape() {
        let mut server = Server::new();
        let mock = server
            .mock("POST", "/agents/deployments/deployment-1/exec")
            .match_header("authorization", "Bearer test-credential")
            .match_body(Matcher::JsonString(
                serde_json::json!({
                    "command": "/usr/local/bin/hypercli-runtime-auth status",
                    "timeout": 15,
                    "dry_run": false
                })
                .to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "exit_code": 0,
                    "stdout": "{\"runtime\":\"codex\",\"authenticated\":false}\n",
                    "stderr": "",
                    "dry_run": false
                })
                .to_string(),
            )
            .create();

        let status = client(&server).runtime_auth_status("deployment-1").unwrap();
        assert_eq!(status.runtime, NativeRuntime::Codex);
        assert!(!status.authenticated);
        mock.assert();
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

        assert_eq!(deployment.requested_size.as_deref(), Some("large"));
        assert_eq!(deployment.launch_config.as_map()["env"]["EDITOR"], "nvim");
        mock.assert();
    }

    #[test]
    fn deployment_file_write_keeps_content_in_the_request_body_only() {
        let mut server = Server::new();
        let mock = server
            .mock(
                "POST",
                "/agents/deployments/deployment-1/files/.ssh/id_ed25519_imported",
            )
            .match_header("authorization", "Bearer test-credential")
            .match_body("private-key-material")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "status": "ok",
                    "path": ".ssh/id_ed25519_imported",
                    "size": 20,
                    "target": "pod"
                })
                .to_string(),
            )
            .create();

        let response = client(&server)
            .put_deployment_file(
                "deployment-1",
                ".ssh/id_ed25519_imported",
                b"private-key-material",
            )
            .unwrap();
        assert_eq!(response.path, ".ssh/id_ed25519_imported");
        assert_eq!(response.target, "pod");
        assert!(client(&server)
            .put_deployment_file("deployment-1", "../escape", b"nope")
            .is_err());
        mock.assert();
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
    fn exec_trace_never_records_command_or_response_output() {
        let mut server = Server::new();
        let temp = tempfile::tempdir().unwrap();
        let trace_file = temp.path().join("logs/http.jsonl");
        let secret = "single-use-auth-code";
        let _mock = server
            .mock("POST", "/agents/deployments/deployment-1/exec")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "exit_code": 0,
                    "stdout": secret,
                    "stderr": "",
                    "dry_run": false
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
        let request = ExecDeploymentRequest::new(format!("printf {secret}"));

        client.exec_deployment("deployment-1", &request).unwrap();

        let trace = fs::read_to_string(trace_file).unwrap();
        assert!(trace.contains(r#""command":"<omitted>""#));
        assert!(!trace.contains(secret));
        assert!(!trace.contains("test-credential"));
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

        let request = CreateDeploymentRequest::new(ManagedRuntime::Opencode);
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
        request
            .env
            .insert("BUZZ_PRIVATE_KEY".to_owned(), secret.to_owned());

        let error = client.create_deployment(&request).unwrap_err();
        assert_eq!(error.status(), Some(StatusCode::UNPROCESSABLE_ENTITY));

        let trace = fs::read_to_string(&trace_file).unwrap();
        assert!(trace.contains(r#""status":422"#));
        assert!(trace.contains(r#""x-request-id":"request-123""#));
        assert!(trace.contains(r#""BUZZ_PRIVATE_KEY":"<redacted>""#));
        assert!(!trace.contains(secret));
        assert!(!trace.contains("test-credential"));
        #[cfg(unix)]
        assert_eq!(
            fs::metadata(trace_file).unwrap().permissions().mode() & 0o777,
            0o600
        );
    }
}
