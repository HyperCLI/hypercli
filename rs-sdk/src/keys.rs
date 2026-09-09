//! Scoped API-key issuance from an application JWT.

use std::time::Duration;

use secrecy::{ExposeSecret, SecretString};
use thiserror::Error;

use crate::{
    discover_agents_api_base, normalize_agents_api_base, ApiKey, ClientConfig, ConfigError,
    CreateApiKeyRequest, HyperCliClient, HyperCliError,
};

/// Options for issuing an API key from an application JWT.
///
/// `tags` has no default so callers must choose the new key's scopes. The JWT
/// subject is the sole user identity for issuance; no user or job override is
/// accepted.
pub struct IssueApiKeyFromJwtOptions {
    pub tags: Vec<String>,
    pub name: String,
    pub duration: Option<String>,
    pub expires_at: Option<String>,
    pub api_url: Option<String>,
    pub timeout: Duration,
}

impl IssueApiKeyFromJwtOptions {
    pub fn new(tags: Vec<String>) -> Self {
        Self {
            tags,
            name: "default".to_owned(),
            duration: None,
            expires_at: None,
            api_url: None,
            timeout: Duration::from_secs(30),
        }
    }
}

#[derive(Debug, Error)]
pub enum IssueApiKeyError {
    #[error("JWT required")]
    JwtRequired,
    #[error(transparent)]
    Config(#[from] ConfigError),
    #[error(transparent)]
    Request(#[from] HyperCliError),
    #[error("API key issue response did not include the key secret")]
    MissingKeySecret,
}

/// Issue a scoped API key for the user represented by an application JWT.
///
/// The temporary client authenticates only the canonical `POST /api/keys`
/// request. Use the secret in the returned metadata for subsequent SDK calls.
pub fn issue_api_key_from_jwt(
    jwt: &str,
    options: IssueApiKeyFromJwtOptions,
) -> Result<ApiKey, IssueApiKeyError> {
    let token = jwt.trim();
    if token.is_empty() {
        return Err(IssueApiKeyError::JwtRequired);
    }

    let api_base = match options.api_url.as_deref() {
        Some(api_url) => normalize_agents_api_base(api_url)?,
        None => discover_agents_api_base()?,
    };
    let client = HyperCliClient::new_with_timeout(
        ClientConfig {
            api_base,
            api_key: SecretString::from(token.to_owned()),
            trace_file: None,
            timeout: None,
        },
        options.timeout,
    )?;
    let request = CreateApiKeyRequest {
        name: options.name,
        tags: options.tags,
        duration: options.duration,
        expires_at: options.expires_at,
    };
    let issued = client.create_api_key(&request)?;
    if issued
        .api_key
        .as_deref()
        .map(str::trim)
        .is_none_or(str::is_empty)
    {
        return Err(IssueApiKeyError::MissingKeySecret);
    }
    Ok(issued)
}

/// Blocking client for the product API-key management surface
/// (`{product}/api/keys`), mirroring the Python SDK's `KeysAPI`. Obtained
/// through [`HyperCliClient::keys`]; shares the client's retry/timeout/trace
/// behavior.
pub struct KeysClient<'a> {
    pub(crate) client: &'a HyperCliClient,
}

impl KeysClient<'_> {
    fn url(&self, path: &str) -> String {
        self.client.product_endpoint(&format!("api/keys{path}"))
    }

    fn authenticated(
        &self,
        method: reqwest::Method,
        url: &str,
    ) -> reqwest::blocking::RequestBuilder {
        self.client
            .http
            .request(method, url)
            .bearer_auth(self.client.api_key.expose_secret())
    }

    /// List all API keys (masked).
    pub fn list(&self) -> Result<Vec<ApiKey>, HyperCliError> {
        let url = self.url("");
        self.client.send_json(
            "keys.list",
            "GET",
            &url,
            None,
            self.authenticated(reqwest::Method::GET, &url),
        )
    }

    /// Get a specific API key (masked).
    pub fn get(&self, key_id: &str) -> Result<ApiKey, HyperCliError> {
        let url = self.url(&format!("/{key_id}"));
        self.client.send_json(
            "keys.get",
            "GET",
            &url,
            None,
            self.authenticated(reqwest::Method::GET, &url),
        )
    }

    /// Deactivate an API key (irreversible). Response shape is backend-owned.
    pub fn disable(&self, key_id: &str) -> Result<serde_json::Value, HyperCliError> {
        let url = self.url(&format!("/{key_id}"));
        self.client.send_json(
            "keys.disable",
            "DELETE",
            &url,
            None,
            self.authenticated(reqwest::Method::DELETE, &url),
        )
    }

    /// Rename an API key (`PATCH {product}/api/keys/{id}` `{"name"}`).
    pub fn rename(&self, key_id: &str, name: &str) -> Result<ApiKey, HyperCliError> {
        let url = self.url(&format!("/{key_id}"));
        let request = serde_json::json!({ "name": name });
        self.client.send_json(
            "keys.rename",
            "PATCH",
            &url,
            Some(request.clone()),
            self.authenticated(reqwest::Method::PATCH, &url)
                .json(&request),
        )
    }
}

#[cfg(test)]
mod keys_client_tests {
    use super::*;
    use mockito::{Matcher, Server};
    use serde_json::json;

    fn client(server: &Server) -> HyperCliClient {
        HyperCliClient::new(ClientConfig {
            api_base: url::Url::parse(&format!("{}/agents", server.url())).unwrap(),
            api_key: SecretString::from("test-credential"),
            trace_file: None,
            timeout: None,
        })
        .unwrap()
    }

    #[test]
    fn list_get_disable_and_rename_hit_the_product_keys_routes() {
        let mut server = Server::new();
        let list = server
            .mock("GET", "/api/keys")
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                json!([{"key_id": "key-1", "name": "default", "is_active": true}]).to_string(),
            )
            .expect(1)
            .create();
        let get = server
            .mock("GET", "/api/keys/key-1")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"key_id": "key-1", "name": "default", "is_active": true}).to_string())
            .expect(1)
            .create();
        let rename = server
            .mock("PATCH", "/api/keys/key-1")
            .match_body(Matcher::Json(json!({"name": "renamed"})))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"key_id": "key-1", "name": "renamed", "is_active": true}).to_string())
            .expect(1)
            .create();
        let disable = server
            .mock("DELETE", "/api/keys/key-1")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(json!({"status": "disabled"}).to_string())
            .expect(1)
            .create();
        let client = client(&server);

        let keys = client.keys();
        assert_eq!(keys.list().unwrap().len(), 1);
        assert_eq!(keys.get("key-1").unwrap().key_id, "key-1");
        assert_eq!(keys.rename("key-1", "renamed").unwrap().name, "renamed");
        assert_eq!(keys.disable("key-1").unwrap()["status"], "disabled");
        list.assert();
        get.assert();
        rename.assert();
        disable.assert();
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use mockito::{Matcher, Server};

    #[test]
    fn issues_scoped_key_using_jwt_only_for_canonical_creation() {
        let mut server = Server::new();
        let issue = server
            .mock("POST", "/api/keys")
            .match_header("authorization", "Bearer user-jwt")
            .match_body(Matcher::Json(serde_json::json!({
                "name": "job-key",
                "tags": ["jobs:self"],
                "duration": "1h",
                "expires_at": "2026-08-09T00:00:00Z"
            })))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "key_id": "key-issued",
                    "name": "job-key",
                    "tags": ["jobs:self"],
                    "api_key": "hyper_api_issued",
                    "api_key_preview": "hyper_api_****ued",
                    "last4": "sued",
                    "capabilities": ["jobs:self"],
                    "is_active": true,
                    "created_at": 1786147200
                })
                .to_string(),
            )
            .expect(1)
            .create();
        let mut options = IssueApiKeyFromJwtOptions::new(vec!["jobs:self".to_owned()]);
        options.api_url = Some(server.url());
        options.name = "job-key".to_owned();
        options.duration = Some("1h".to_owned());
        options.expires_at = Some("2026-08-09T00:00:00Z".to_owned());

        let issued = issue_api_key_from_jwt(" user-jwt ", options).unwrap();

        assert_eq!(issued.api_key.as_deref(), Some("hyper_api_issued"));
        assert_eq!(issued.api_key_preview.as_deref(), Some("hyper_api_****ued"));
        assert_eq!(issued.tags, ["jobs:self"]);
        assert_eq!(issued.capabilities, ["jobs:self"]);
        issue.assert();
    }

    #[test]
    fn rejects_empty_jwt_before_issuing_request() {
        let mut server = Server::new();
        let issue = server.mock("POST", "/api/keys").expect(0).create();
        let mut options = IssueApiKeyFromJwtOptions::new(vec!["jobs:self".to_owned()]);
        options.api_url = Some(server.url());

        let error = match issue_api_key_from_jwt("   ", options) {
            Ok(_) => panic!("empty JWT unexpectedly issued a key"),
            Err(error) => error,
        };

        assert!(matches!(error, IssueApiKeyError::JwtRequired));
        issue.assert();
    }

    #[test]
    fn rejects_issue_response_without_key_secret() {
        let mut server = Server::new();
        let issue = server
            .mock("POST", "/api/keys")
            .match_header("authorization", "Bearer user-jwt")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"key_id":"key-masked","name":"default","tags":["jobs:self"]}"#)
            .create();
        let mut options = IssueApiKeyFromJwtOptions::new(vec!["jobs:self".to_owned()]);
        options.api_url = Some(server.url());

        let error = match issue_api_key_from_jwt("user-jwt", options) {
            Ok(_) => panic!("response without a key secret unexpectedly succeeded"),
            Err(error) => error,
        };

        assert!(matches!(error, IssueApiKeyError::MissingKeySecret));
        issue.assert();
    }
}
