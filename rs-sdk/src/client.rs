use std::collections::BTreeMap;
use std::fs::{self, OpenOptions};
use std::io::Write;
#[cfg(unix)]
use std::os::unix::fs::{OpenOptionsExt, PermissionsExt};
use std::path::{Path, PathBuf};
use std::time::{Instant, SystemTime, UNIX_EPOCH};

use reqwest::blocking::Client as HttpClient;
use reqwest::StatusCode;
use secrecy::ExposeSecret;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use thiserror::Error;
use url::Url;

use crate::{
    ClientConfig, CreateDeploymentRequest, Deployment, ExecDeploymentRequest,
    ExecDeploymentResponse, StartDeploymentRequest,
};

pub struct HyperCliClient {
    api_base: Url,
    api_key: secrecy::SecretString,
    http: HttpClient,
    trace_file: Option<PathBuf>,
}

#[derive(Debug, Error)]
pub enum HyperCliError {
    #[error("HyperCLI request could not be sent: {0}")]
    Transport(String),
    #[error("HyperCLI returned HTTP {0}")]
    Status(StatusCode),
    #[error("HyperCLI returned an invalid deployment response: {0}")]
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

impl HyperCliClient {
    pub fn new(config: ClientConfig) -> Result<Self, HyperCliError> {
        let http = HttpClient::builder()
            .timeout(std::time::Duration::from_secs(30))
            .build()
            .map_err(|error| HyperCliError::Transport(error.to_string()))?;
        Ok(Self {
            api_base: config.api_base,
            api_key: config.api_key,
            http,
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

    pub fn list_deployments_by_handle(
        &self,
        handle: &str,
    ) -> Result<Vec<Deployment>, HyperCliError> {
        let url = self.endpoint("deployments");
        let request = json!({"handle": handle});
        let started = Instant::now();
        let response = match self
            .http
            .get(&url)
            .bearer_auth(self.api_key.expose_secret())
            .query(&[("handle", handle)])
            .send()
        {
            Ok(response) => response,
            Err(error) => {
                let error = HyperCliError::Transport(error.to_string());
                self.trace_http(
                    "list_deployments_by_handle",
                    "GET",
                    &url,
                    Some(&request),
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
        let result: Result<DeploymentPage, HyperCliError> = decode_json(response);
        self.trace_http(
            "list_deployments_by_handle",
            "GET",
            &url,
            Some(&request),
            started,
            Some(status),
            headers,
            result.as_ref().map(|_| ()),
        );
        let page = result?;
        Ok(page.items)
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

    pub fn create_deployment(
        &self,
        request: &CreateDeploymentRequest,
    ) -> Result<Deployment, HyperCliError> {
        let url = self.endpoint("deployments");
        let request_trace = serde_json::to_value(request).ok();
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

    pub fn start_deployment(
        &self,
        deployment_id: &str,
        request: &StartDeploymentRequest,
    ) -> Result<Deployment, HyperCliError> {
        let url = self.endpoint(&format!("deployments/{deployment_id}/start"));
        let request_trace = serde_json::to_value(request).ok();
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

#[derive(Deserialize)]
struct DeploymentPage {
    items: Vec<Deployment>,
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
    response
        .json()
        .map_err(|error| HyperCliError::InvalidResponse(error.to_string()))
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

    fn client(server: &Server) -> HyperCliClient {
        HyperCliClient::new(ClientConfig {
            api_base: Url::parse(&format!("{}/agents", server.url())).unwrap(),
            api_key: SecretString::from("test-credential"),
            trace_file: None,
        })
        .unwrap()
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
                    "sync_root": "/home/node",
                    "sync_enabled": true
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
                    "state": "pending"
                })
                .to_string(),
            )
            .create();

        let mut request = CreateDeploymentRequest::new(ManagedRuntime::Opencode);
        request.size = Some(AgentSize::Small);
        request.command = vec!["/usr/local/bin/buzz-acp".to_owned()];
        request.sync_root = Some("/home/node".to_owned());
        request.sync_enabled = Some(true);
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
                        "state": "running"
                    }],
                    "total_agents": 1,
                    "max_agents_per_account": 4,
                    "slots": [],
                    "pooled_tpd": {}
                })
                .to_string(),
            )
            .create();

        let deployments = client(&server)
            .list_deployments_by_handle("buzz-abc123")
            .unwrap();
        assert_eq!(deployments.len(), 1);
        assert_eq!(deployments[0].id, "deployment-1");
        mock.assert();
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
