use std::collections::BTreeMap;

use hypercli_sdk::{
    AgentSize, CreateDeploymentRequest, Deployment, HyperCliClient, HyperCliError, ManagedRuntime,
    StartDeploymentRequest,
};
use nostr::Keys;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

const DEFAULT_OPENCODE_IMAGE: &str = "git.nedos.co/hypercli/hypercli-opencode:latest";
const DEFAULT_CODEX_IMAGE: &str = "git.nedos.co/hypercli/hypercli-codex:latest";
const DEFAULT_CLAUDE_CODE_IMAGE: &str = "git.nedos.co/hypercli/hypercli-claude-code:latest";

#[derive(Deserialize)]
#[serde(tag = "op", rename_all = "lowercase")]
pub enum ProviderRequest {
    Info {
        request_id: String,
    },
    Deploy {
        request_id: String,
        agent: Box<BuzzAgentPayload>,
        #[serde(default)]
        provider_config: Value,
    },
}

/// Exact provider payload emitted by Buzz Desktop today.
///
/// Do not derive `Debug`: this object contains the agent nsec and may contain
/// model credentials in `env_vars`.
#[derive(Deserialize)]
pub struct BuzzAgentPayload {
    pub name: String,
    pub relay_url: String,
    pub private_key_nsec: String,
    #[serde(default)]
    pub auth_tag: Option<String>,
    #[serde(default)]
    pub agent_command: String,
    #[serde(default)]
    pub agent_args: Vec<String>,
    #[serde(default)]
    pub system_prompt: Option<String>,
    #[serde(default)]
    pub model: Option<String>,
    #[serde(default)]
    pub provider: Option<String>,
    #[serde(default)]
    pub turn_timeout_seconds: Option<u64>,
    #[serde(default)]
    pub idle_timeout_seconds: Option<u64>,
    #[serde(default)]
    pub max_turn_duration_seconds: Option<u64>,
    #[serde(default = "default_parallelism")]
    pub parallelism: u32,
    #[serde(default)]
    pub respond_to: Option<String>,
    #[serde(default)]
    pub respond_to_allowlist: Vec<String>,
    #[serde(default)]
    pub env_vars: BTreeMap<String, String>,
}

fn default_parallelism() -> u32 {
    1
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum CodingRuntime {
    Opencode,
    Codex,
    ClaudeCode,
}

impl CodingRuntime {
    fn managed(self) -> ManagedRuntime {
        match self {
            Self::Opencode => ManagedRuntime::Opencode,
            Self::Codex => ManagedRuntime::Codex,
            Self::ClaudeCode => ManagedRuntime::ClaudeCode,
        }
    }

    fn default_image(self) -> &'static str {
        match self {
            Self::Opencode => DEFAULT_OPENCODE_IMAGE,
            Self::Codex => DEFAULT_CODEX_IMAGE,
            Self::ClaudeCode => DEFAULT_CLAUDE_CODE_IMAGE,
        }
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ProviderOptions {
    #[serde(default = "default_runtime")]
    runtime: CodingRuntime,
    #[serde(default = "default_size")]
    size: AgentSize,
    #[serde(default)]
    image: Option<String>,
    #[serde(default)]
    workspace: Option<String>,
}

fn default_runtime() -> CodingRuntime {
    CodingRuntime::Opencode
}

fn default_size() -> AgentSize {
    AgentSize::Small
}

#[derive(Serialize)]
pub struct ProviderInfoResponse {
    pub ok: bool,
    pub name: &'static str,
    pub version: &'static str,
    pub description: &'static str,
    pub config_schema: Value,
}

#[derive(Serialize)]
pub struct DeployResponse {
    pub agent_id: String,
}

#[derive(Serialize)]
pub struct ErrorResponse<'a> {
    pub ok: bool,
    pub error: &'a str,
}

#[derive(Debug, Error)]
pub enum ProviderError {
    #[error("provider request is invalid")]
    InvalidRequest,
    #[error("provider_config must be a flat JSON object containing no secret-looking fields")]
    InvalidProviderConfig,
    #[error("provider_config is not supported")]
    UnsupportedProviderConfig,
    #[error("agent identity is invalid")]
    InvalidAgentIdentity,
    #[error("agent relay URL is required")]
    MissingRelayUrl,
    #[error("agent parallelism must be between 1 and 32")]
    InvalidParallelism,
    #[error("HyperCLI authentication is not configured")]
    MissingHyperCliAuthentication,
    #[error("HyperCLI deployment request failed")]
    HyperCli,
    #[error("idempotent deployment lookup returned multiple agents")]
    AmbiguousDeployment,
    #[error("existing deployment runtime does not match the requested runtime")]
    RuntimeMismatch,
}

pub fn provider_info() -> ProviderInfoResponse {
    ProviderInfoResponse {
        ok: true,
        name: "HyperCLI",
        version: env!("CARGO_PKG_VERSION"),
        description: "Run Buzz coding agents in isolated HyperCLI Reef pods",
        config_schema: serde_json::json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "runtime": {
                    "type": "string",
                    "title": "Runtime",
                    "description": "opencode, codex, or claude-code",
                    "default": "opencode"
                },
                "size": {
                    "type": "string",
                    "title": "Size",
                    "description": "small, medium, or large",
                    "default": "small"
                },
                "image": {
                    "type": "string",
                    "title": "Runtime image",
                    "description": "Optional immutable runtime image override",
                    "default": ""
                },
                "workspace": {
                    "type": "string",
                    "title": "Workspace",
                    "description": "Optional HyperCLI workspace ID to sync",
                    "default": ""
                }
            }
        }),
    }
}

pub fn deploy(
    client: &HyperCliClient,
    agent: BuzzAgentPayload,
    provider_config: Value,
) -> Result<DeployResponse, ProviderError> {
    validate_provider_config(&provider_config)?;
    let options: ProviderOptions = serde_json::from_value(provider_config)
        .map_err(|_| ProviderError::UnsupportedProviderConfig)?;
    let public_key = derive_agent_pubkey(&agent.private_key_nsec)?;
    let handle = deterministic_handle(&public_key);
    let request = build_launch_request(agent, &public_key, &handle, options)?;

    if let Some(existing) = find_existing(client, &handle, request.runtime)? {
        let deployment = restart_if_stopped(client, existing, &request)?;
        return Ok(DeployResponse {
            agent_id: deployment.id,
        });
    }

    match client.create_deployment(&request) {
        Ok(deployment) => Ok(DeployResponse {
            agent_id: deployment.id,
        }),
        Err(error) if error.status() == Some(StatusCode::CONFLICT) => {
            // Close the list-before-create race without inventing a separate
            // provider database. The user-scoped handle is deterministic.
            let existing =
                find_existing(client, &handle, request.runtime)?.ok_or(ProviderError::HyperCli)?;
            Ok(DeployResponse {
                agent_id: existing.id,
            })
        }
        Err(_) => Err(ProviderError::HyperCli),
    }
}

fn find_existing(
    client: &HyperCliClient,
    handle: &str,
    runtime: ManagedRuntime,
) -> Result<Option<Deployment>, ProviderError> {
    let mut deployments = client
        .list_deployments_by_handle(handle)
        .map_err(|_| ProviderError::HyperCli)?;
    if deployments.len() > 1 {
        return Err(ProviderError::AmbiguousDeployment);
    }
    let existing = deployments.pop();
    if let Some(deployment) = existing.as_ref() {
        if deployment.runtime.is_some() && deployment.runtime != Some(runtime) {
            return Err(ProviderError::RuntimeMismatch);
        }
    }
    Ok(existing)
}

fn restart_if_stopped(
    client: &HyperCliClient,
    deployment: Deployment,
    create: &CreateDeploymentRequest,
) -> Result<Deployment, ProviderError> {
    if !deployment.state.eq_ignore_ascii_case("stopped") {
        return Ok(deployment);
    }
    let start = StartDeploymentRequest {
        config: create.config.clone(),
        env: create.env.clone(),
        routes: create.routes.clone(),
        command: create.command.clone(),
        entrypoint: create.entrypoint.clone(),
        image: create.image.clone(),
        sync_root: create.sync_root.clone(),
        sync_enabled: create.sync_enabled,
        sync_uid: create.sync_uid,
        sync_gid: create.sync_gid,
        dry_run: false,
    };
    client
        .start_deployment(&deployment.id, &start)
        .map_err(|_| ProviderError::HyperCli)
}

fn build_launch_request(
    agent: BuzzAgentPayload,
    public_key: &str,
    handle: &str,
    options: ProviderOptions,
) -> Result<CreateDeploymentRequest, ProviderError> {
    if agent.relay_url.trim().is_empty() {
        return Err(ProviderError::MissingRelayUrl);
    }
    if !(1..=32).contains(&agent.parallelism) {
        return Err(ProviderError::InvalidParallelism);
    }

    let runtime = options.runtime;
    let mut request = CreateDeploymentRequest::new(runtime.managed());
    request.name = Some(format!("buzz-{}", &public_key[..12]));
    request.handle = Some(handle.to_owned());
    request.size = Some(options.size);
    request.image = options
        .image
        .filter(|image| !image.trim().is_empty())
        .or_else(|| Some(runtime.default_image().to_owned()));
    request.command = vec!["/usr/local/bin/buzz-acp".to_owned()];
    request.sync_root = Some("/home/node".to_owned());
    request.sync_enabled = Some(true);
    request.sync_uid = Some(1000);
    request.sync_gid = Some(1000);
    request.tags = vec![format!("buzz-agent:{public_key}")];

    let mut env = agent.env_vars;
    for reserved in [
        "BUZZ_PRIVATE_KEY",
        "NOSTR_PRIVATE_KEY",
        "BUZZ_RELAY_URL",
        "BUZZ_AUTH_TAG",
        "BUZZ_ACP_AGENT_OWNER",
        "BUZZ_ACP_SYSTEM_PROMPT",
        "BUZZ_ACP_MODEL",
        "BUZZ_ACP_IDLE_TIMEOUT",
        "BUZZ_ACP_MAX_TURN_DURATION",
        "BUZZ_ACP_AGENTS",
        "BUZZ_ACP_RESPOND_TO",
        "BUZZ_ACP_RESPOND_TO_ALLOWLIST",
    ] {
        env.remove(reserved);
    }
    env.insert(
        "BUZZ_PRIVATE_KEY".to_owned(),
        agent.private_key_nsec.clone(),
    );
    env.insert("NOSTR_PRIVATE_KEY".to_owned(), agent.private_key_nsec);
    env.insert("BUZZ_RELAY_URL".to_owned(), agent.relay_url);
    if let Some(auth_tag) = agent.auth_tag.filter(|value| !value.is_empty()) {
        env.insert("BUZZ_AUTH_TAG".to_owned(), auth_tag);
    }
    if let Some(prompt) = agent.system_prompt.filter(|value| !value.is_empty()) {
        env.insert("BUZZ_ACP_SYSTEM_PROMPT".to_owned(), prompt);
    }
    if let Some(model) = agent.model.filter(|value| !value.is_empty()) {
        env.insert("BUZZ_ACP_MODEL".to_owned(), model);
    }
    if let Some(idle) = agent.idle_timeout_seconds {
        env.insert("BUZZ_ACP_IDLE_TIMEOUT".to_owned(), idle.to_string());
    }
    if let Some(maximum) = agent.max_turn_duration_seconds {
        env.insert("BUZZ_ACP_MAX_TURN_DURATION".to_owned(), maximum.to_string());
    }
    env.insert("BUZZ_ACP_AGENTS".to_owned(), agent.parallelism.to_string());
    env.insert(
        "BUZZ_ACP_MULTIPLE_EVENT_HANDLING".to_owned(),
        "steer".to_owned(),
    );
    env.insert("BUZZ_ACP_DEDUP".to_owned(), "queue".to_owned());
    if let Some(respond_to) = agent.respond_to.filter(|value| !value.is_empty()) {
        env.insert("BUZZ_ACP_RESPOND_TO".to_owned(), respond_to);
    }
    if !agent.respond_to_allowlist.is_empty() {
        env.insert(
            "BUZZ_ACP_RESPOND_TO_ALLOWLIST".to_owned(),
            agent.respond_to_allowlist.join(","),
        );
    }
    env.insert("HYPER_WORKSPACES_BOOT_SYNC".to_owned(), "1".to_owned());
    env.insert(
        "HYPER_WORKSPACES_DIR".to_owned(),
        "/home/node/workspaces".to_owned(),
    );
    env.insert(
        "HYPER_WORKSPACES_SYNC_READY_ONLY".to_owned(),
        "1".to_owned(),
    );
    if let Some(workspace) = options.workspace.filter(|value| !value.trim().is_empty()) {
        env.insert("HYPER_WORKSPACES_SYNC_WORKSPACE".to_owned(), workspace);
    }
    request.env = env;
    Ok(request)
}

pub fn derive_agent_pubkey(private_key: &str) -> Result<String, ProviderError> {
    let keys = Keys::parse(private_key).map_err(|_| ProviderError::InvalidAgentIdentity)?;
    Ok(keys.public_key().to_hex())
}

pub fn deterministic_handle(public_key: &str) -> String {
    // Backend handles are capped at 64 bytes. Forty-eight hex characters keep
    // 192 bits of the Nostr identity and leave a readable provider prefix.
    format!("buzz-{}", &public_key[..public_key.len().min(48)])
}

pub fn validate_provider_config(value: &Value) -> Result<(), ProviderError> {
    let object = value
        .as_object()
        .ok_or(ProviderError::InvalidProviderConfig)?;
    if object.len() > 20 || serde_json::to_vec(value).map_or(true, |json| json.len() > 64 * 1024) {
        return Err(ProviderError::InvalidProviderConfig);
    }
    for (key, value) in object {
        if split_config_key(key).iter().any(|word| {
            matches!(
                word.as_str(),
                "secret" | "password" | "token" | "key" | "credential"
            )
        }) || value.is_array()
            || value.is_object()
        {
            return Err(ProviderError::InvalidProviderConfig);
        }
    }
    Ok(())
}

fn split_config_key(key: &str) -> Vec<String> {
    let chars: Vec<char> = key.chars().collect();
    let mut words = Vec::new();
    let mut current = String::new();
    for (index, character) in chars.iter().copied().enumerate() {
        if matches!(character, '_' | '-' | '.') {
            if !current.is_empty() {
                words.push(current.to_ascii_lowercase());
                current.clear();
            }
            continue;
        }
        if character.is_ascii_uppercase() {
            let previous_lower = current
                .chars()
                .last()
                .is_some_and(|previous| previous.is_ascii_lowercase());
            let acronym_end = current
                .chars()
                .last()
                .is_some_and(|previous| previous.is_ascii_uppercase())
                && chars
                    .get(index + 1)
                    .is_some_and(|next| next.is_ascii_lowercase());
            if previous_lower || acronym_end {
                words.push(current.to_ascii_lowercase());
                current.clear();
            }
        }
        current.push(character);
    }
    if !current.is_empty() {
        words.push(current.to_ascii_lowercase());
    }
    words
}

pub fn map_config_error(_: hypercli_sdk::ConfigError) -> ProviderError {
    ProviderError::MissingHyperCliAuthentication
}

pub fn map_client_error(_: HyperCliError) -> ProviderError {
    ProviderError::HyperCli
}

#[cfg(test)]
mod tests {
    use super::*;
    use hypercli_sdk::ClientConfig;
    use mockito::{Matcher, Server};
    use secrecy::SecretString;
    use url::Url;

    const TEST_SECRET_HEX: &str =
        "0000000000000000000000000000000000000000000000000000000000000001";
    const TEST_PUBLIC_HEX: &str =
        "79be667ef9dcbbac55a06295ce870b07029bfcdb2dce28d959f2815b16f81798";

    fn test_agent() -> BuzzAgentPayload {
        BuzzAgentPayload {
            name: "Fizz".to_owned(),
            relay_url: "wss://buzz.example.com".to_owned(),
            private_key_nsec: TEST_SECRET_HEX.to_owned(),
            auth_tag: Some("[\"auth\",\"tag\"]".to_owned()),
            agent_command: "opencode".to_owned(),
            agent_args: vec!["acp".to_owned()],
            system_prompt: Some("Build carefully".to_owned()),
            model: Some("test-model".to_owned()),
            provider: None,
            turn_timeout_seconds: None,
            idle_timeout_seconds: Some(900),
            max_turn_duration_seconds: Some(7200),
            parallelism: 1,
            respond_to: Some("owner-only".to_owned()),
            respond_to_allowlist: Vec::new(),
            env_vars: BTreeMap::from([("MODEL_API_KEY".to_owned(), "model-secret".to_owned())]),
        }
    }

    fn client(server: &Server) -> HyperCliClient {
        HyperCliClient::new(ClientConfig {
            api_base: Url::parse(&format!("{}/agents", server.url())).unwrap(),
            api_key: SecretString::from("test-credential"),
        })
        .unwrap()
    }

    #[test]
    fn derives_stable_pubkey_and_handle_from_agent_secret() {
        let public = derive_agent_pubkey(TEST_SECRET_HEX).unwrap();
        assert_eq!(public, TEST_PUBLIC_HEX);
        assert_eq!(
            deterministic_handle(&public),
            format!("buzz-{}", &public[..48])
        );
    }

    #[test]
    fn rejects_secret_looking_provider_config_fields() {
        for key in ["api_key", "apiKey", "accessTOKEN", "client-secret"] {
            let config = Value::Object(serde_json::Map::from_iter([(
                key.to_owned(),
                Value::String("value".to_owned()),
            )]));
            assert!(validate_provider_config(&config).is_err(), "accepted {key}");
        }
        assert!(validate_provider_config(
            &serde_json::json!({"runtime":"opencode","size":"small"})
        )
        .is_ok());
    }

    #[test]
    fn deploy_uses_handle_for_idempotency_and_forwards_buzz_environment() {
        let mut server = Server::new();
        let handle = format!("buzz-{}", &TEST_PUBLIC_HEX[..48]);
        let lookup = server
            .mock("GET", "/agents/deployments")
            .match_query(Matcher::UrlEncoded("handle".into(), handle.clone()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body("[]")
            .create();
        let create = server
            .mock("POST", "/agents/deployments")
            .match_header("authorization", "Bearer test-credential")
            .match_body(Matcher::PartialJsonString(
                serde_json::json!({
                    "handle": handle,
                    "runtime": "opencode",
                    "command": ["/usr/local/bin/buzz-acp"],
                    "env": {
                        "BUZZ_RELAY_URL": "wss://buzz.example.com",
                        "BUZZ_PRIVATE_KEY": TEST_SECRET_HEX,
                        "NOSTR_PRIVATE_KEY": TEST_SECRET_HEX,
                        "BUZZ_AUTH_TAG": "[\"auth\",\"tag\"]",
                        "MODEL_API_KEY": "model-secret"
                    }
                })
                .to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id":"deployment-1",
                    "handle": format!("buzz-{}", &TEST_PUBLIC_HEX[..48]),
                    "runtime":"opencode",
                    "state":"pending"
                })
                .to_string(),
            )
            .create();

        let response = deploy(
            &client(&server),
            test_agent(),
            serde_json::json!({"runtime":"opencode","size":"small"}),
        )
        .unwrap();
        assert_eq!(response.agent_id, "deployment-1");
        lookup.assert();
        create.assert();
    }

    #[test]
    fn deploy_returns_existing_agent_without_creating_duplicate() {
        let mut server = Server::new();
        let handle = format!("buzz-{}", &TEST_PUBLIC_HEX[..48]);
        let lookup = server
            .mock("GET", "/agents/deployments")
            .match_query(Matcher::UrlEncoded("handle".into(), handle.clone()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!([{
                    "id":"existing",
                    "handle":handle,
                    "runtime":"opencode",
                    "state":"running"
                }])
                .to_string(),
            )
            .create();

        let response = deploy(
            &client(&server),
            test_agent(),
            serde_json::json!({"runtime":"opencode"}),
        )
        .unwrap();
        assert_eq!(response.agent_id, "existing");
        lookup.assert();
    }
}
