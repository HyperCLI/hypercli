use reqwest::blocking::Client as HttpClient;
use reqwest::StatusCode;
use secrecy::ExposeSecret;
use serde::Deserialize;
use thiserror::Error;
use url::Url;

use crate::{ClientConfig, CreateDeploymentRequest, Deployment, StartDeploymentRequest};

pub struct HyperCliClient {
    api_base: Url,
    api_key: secrecy::SecretString,
    http: HttpClient,
}

#[derive(Debug, Error)]
pub enum HyperCliError {
    #[error("HyperCLI request could not be sent")]
    Transport,
    #[error("HyperCLI returned HTTP {0}")]
    Status(StatusCode),
    #[error("HyperCLI returned an invalid deployment response")]
    InvalidResponse,
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
            .map_err(|_| HyperCliError::Transport)?;
        Ok(Self {
            api_base: config.api_base,
            api_key: config.api_key,
            http,
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
        let response = self
            .http
            .get(self.endpoint("deployments"))
            .bearer_auth(self.api_key.expose_secret())
            .query(&[("handle", handle)])
            .send()
            .map_err(|_| HyperCliError::Transport)?;
        let page: DeploymentPage = decode_json(response)?;
        Ok(page.items)
    }

    pub fn create_deployment(
        &self,
        request: &CreateDeploymentRequest,
    ) -> Result<Deployment, HyperCliError> {
        let response = self
            .http
            .post(self.endpoint("deployments"))
            .bearer_auth(self.api_key.expose_secret())
            .json(request)
            .send()
            .map_err(|_| HyperCliError::Transport)?;
        decode_json(response)
    }

    pub fn start_deployment(
        &self,
        deployment_id: &str,
        request: &StartDeploymentRequest,
    ) -> Result<Deployment, HyperCliError> {
        let response = self
            .http
            .post(self.endpoint(&format!("deployments/{deployment_id}/start")))
            .bearer_auth(self.api_key.expose_secret())
            .json(request)
            .send()
            .map_err(|_| HyperCliError::Transport)?;
        decode_json(response)
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
    response.json().map_err(|_| HyperCliError::InvalidResponse)
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
}
