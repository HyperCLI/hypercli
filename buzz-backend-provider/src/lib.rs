use std::collections::BTreeMap;
use std::path::Path;

use hypercli_sdk::{
    AgentSize, BuzzLaunchConfig, BuzzLaunchError, CreateDeploymentRequest, Deployment,
    HyperCliClient, HyperCliError, ManagedRuntime, StartDeploymentRequest,
};
use nostr::Keys;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

const DEFAULT_OPENCODE_IMAGE: &str = "ghcr.io/hypercli/hypercli-opencode:latest";
const DEFAULT_CODEX_IMAGE: &str = "ghcr.io/hypercli/hypercli-codex:latest";
const DEFAULT_CLAUDE_CODE_IMAGE: &str = "ghcr.io/hypercli/hypercli-claude-code:latest";
const DEFAULT_GOOSE_IMAGE: &str = "ghcr.io/hypercli/hypercli-goose:latest";
const DEFAULT_KIMI_CODE_IMAGE: &str = "ghcr.io/hypercli/hypercli-kimi-code:latest";
#[cfg(test)]
const BUZZ_DEV_MCP_COMMAND: &str = "/usr/local/bin/buzz-dev-mcp";

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
    Stop {
        request_id: String,
        agent_id: String,
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
    Goose,
    KimiCode,
}

impl CodingRuntime {
    fn managed(self) -> ManagedRuntime {
        match self {
            Self::Opencode => ManagedRuntime::Opencode,
            Self::Codex => ManagedRuntime::Codex,
            Self::ClaudeCode => ManagedRuntime::ClaudeCode,
            Self::Goose => ManagedRuntime::Goose,
            Self::KimiCode => ManagedRuntime::KimiCode,
        }
    }

    fn default_image(self) -> &'static str {
        match self {
            Self::Opencode => DEFAULT_OPENCODE_IMAGE,
            Self::Codex => DEFAULT_CODEX_IMAGE,
            Self::ClaudeCode => DEFAULT_CLAUDE_CODE_IMAGE,
            Self::Goose => DEFAULT_GOOSE_IMAGE,
            Self::KimiCode => DEFAULT_KIMI_CODE_IMAGE,
        }
    }

    #[cfg(test)]
    fn harness_command(self) -> &'static str {
        match self {
            Self::Opencode => "/usr/local/bin/opencode",
            Self::Codex => "/usr/local/bin/codex-acp",
            Self::ClaudeCode => "/usr/local/bin/claude-agent-acp",
            Self::Goose => "/usr/local/bin/goose",
            Self::KimiCode => "/usr/local/bin/kimi",
        }
    }

    #[cfg(test)]
    fn harness_args(self) -> &'static str {
        match self {
            Self::Opencode | Self::Goose | Self::KimiCode => "acp",
            Self::Codex | Self::ClaudeCode => "",
        }
    }

    fn matches_buzz_command(self, command: &str) -> bool {
        let command = Path::new(command.trim())
            .file_name()
            .and_then(|value| value.to_str())
            .unwrap_or_default();
        match self {
            Self::Opencode => command == "opencode",
            Self::Codex => command == "codex-acp",
            Self::ClaudeCode => matches!(command, "claude-agent-acp" | "claude-code-acp"),
            Self::Goose => command == "goose",
            Self::KimiCode => matches!(command, "kimi" | "kimi-code"),
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
    AgentSize::Large
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
pub struct StopResponse {
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
    #[error("HyperCLI coding agents require size large")]
    InvalidCodingAgentSize,
    #[error("Buzz harness does not match the selected HyperCLI runtime")]
    AgentRuntimeMismatch,
    #[error("Buzz launch configuration is invalid: {0}")]
    BuzzLaunch(#[from] BuzzLaunchError),
    #[error("HyperCLI authentication is not configured")]
    MissingHyperCliAuthentication,
    #[error("HyperCLI deployment request failed: {0}")]
    HyperCli(#[source] HyperCliError),
    #[error("HyperCLI deployment lookup did not find the conflicting agent")]
    MissingConflictingDeployment,
    #[error("provider response could not be encoded")]
    ResponseEncoding,
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
                    "description": "opencode, codex, claude-code, goose, or kimi-code",
                    "enum": ["opencode", "codex", "claude-code", "goose", "kimi-code"],
                    "default": "opencode"
                },
                "size": {
                    "type": "string",
                    "title": "Size",
                    "description": "Required HyperCLI coding-agent tier",
                    "enum": ["large"],
                    "default": "large"
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
    deploy_with_dry_run(client, agent, provider_config, false)
}

pub fn deploy_with_dry_run(
    client: &HyperCliClient,
    agent: BuzzAgentPayload,
    provider_config: Value,
    dry_run: bool,
) -> Result<DeployResponse, ProviderError> {
    validate_provider_config(&provider_config)?;
    let options: ProviderOptions = serde_json::from_value(provider_config)
        .map_err(|_| ProviderError::UnsupportedProviderConfig)?;
    let public_key = derive_agent_pubkey(&agent.private_key_nsec)?;
    let handle = deterministic_handle(&public_key);
    let mut request = build_launch_request(agent, &public_key, &handle, options)?;
    request.dry_run = dry_run;

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
            let existing = find_existing(client, &handle, request.runtime)?
                .ok_or(ProviderError::MissingConflictingDeployment)?;
            Ok(DeployResponse {
                agent_id: existing.id,
            })
        }
        Err(error) => Err(ProviderError::HyperCli(error)),
    }
}

pub fn stop(client: &HyperCliClient, agent_id: String) -> Result<StopResponse, ProviderError> {
    let deployment = client
        .stop_deployment(&agent_id)
        .map_err(ProviderError::HyperCli)?;
    Ok(StopResponse {
        agent_id: deployment.id,
    })
}

fn find_existing(
    client: &HyperCliClient,
    handle: &str,
    runtime: ManagedRuntime,
) -> Result<Option<Deployment>, ProviderError> {
    let mut deployments = client
        .list_deployments_by_handle(handle)
        .map_err(ProviderError::HyperCli)?;
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
        .map_err(ProviderError::HyperCli)
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
    if options.size != AgentSize::Large {
        return Err(ProviderError::InvalidCodingAgentSize);
    }

    let runtime = options.runtime;
    if !runtime.matches_buzz_command(&agent.agent_command) {
        return Err(ProviderError::AgentRuntimeMismatch);
    }
    let display_name = agent.name.trim().to_owned();
    let mut request = CreateDeploymentRequest::new(runtime.managed());
    request.name = Some(deployment_name(&display_name, public_key));
    request.handle = Some(handle.to_owned());
    request.size = Some(options.size);
    request.image = options
        .image
        .filter(|image| !image.trim().is_empty())
        .or_else(|| Some(runtime.default_image().to_owned()));
    request.tags = vec![format!("buzz_agent={public_key}")];

    let mut env = agent.env_vars;
    for reserved in [
        "HYPER_WORKSPACES_BOOT_SYNC",
        "HYPER_WORKSPACES_DIR",
        "HYPER_WORKSPACES_SYNC_READY_ONLY",
        "HYPER_WORKSPACES_SYNC_WORKSPACE",
    ] {
        env.remove(reserved);
    }
    request.env = env;
    let mut buzz = BuzzLaunchConfig::new(agent.private_key_nsec, agent.relay_url);
    buzz.auth_tag = agent.auth_tag;
    buzz.system_prompt = agent.system_prompt;
    buzz.model = agent.model;
    buzz.idle_timeout_seconds = agent.idle_timeout_seconds;
    buzz.max_turn_duration_seconds = agent.max_turn_duration_seconds;
    buzz.parallelism = agent.parallelism;
    buzz.respond_to = agent.respond_to;
    buzz.respond_to_allowlist = agent.respond_to_allowlist;
    buzz.apply_to(&mut request, Some(&display_name))?;

    let env = &mut request.env;
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

pub fn deployment_name(display_name: &str, public_key: &str) -> String {
    const SUFFIX_LEN: usize = 8;
    const MAX_NAME_LEN: usize = 32;

    let mut base = String::with_capacity(display_name.len());
    let mut previous_hyphen = false;
    for character in display_name.chars().flat_map(char::to_lowercase) {
        if character.is_ascii_lowercase() || character.is_ascii_digit() {
            base.push(character);
            previous_hyphen = false;
        } else if !base.is_empty() && !previous_hyphen {
            base.push('-');
            previous_hyphen = true;
        }
    }
    while base.ends_with('-') {
        base.pop();
    }
    if !base
        .chars()
        .next()
        .is_some_and(|character| character.is_ascii_lowercase())
    {
        base.insert_str(0, "buzz-");
    }
    let suffix = &public_key[..public_key.len().min(SUFFIX_LEN)];
    let max_base_len = MAX_NAME_LEN - suffix.len() - 1;
    base.truncate(max_base_len);
    while base.ends_with('-') {
        base.pop();
    }
    if base.len() < 2 {
        base = "buzz".to_owned();
    }
    format!("{base}-{suffix}")
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

pub fn map_client_error(error: HyperCliError) -> ProviderError {
    ProviderError::HyperCli(error)
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

    fn test_agent_for(runtime: CodingRuntime) -> BuzzAgentPayload {
        let mut agent = test_agent();
        agent.agent_command = runtime.harness_command().to_owned();
        agent.agent_args = if runtime.harness_args().is_empty() {
            Vec::new()
        } else {
            vec![runtime.harness_args().to_owned()]
        };
        agent
    }

    fn client(server: &Server) -> HyperCliClient {
        HyperCliClient::new(ClientConfig {
            api_base: Url::parse(&format!("{}/agents", server.url())).unwrap(),
            api_key: SecretString::from("test-credential"),
            trace_file: None,
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
    fn deployment_name_uses_sanitized_buzz_name_and_stable_identity_suffix() {
        assert_eq!(deployment_name("Fizz4", TEST_PUBLIC_HEX), "fizz4-79be667e");
        assert_eq!(
            deployment_name("  42 / Very Long Agent Name With Spaces  ", TEST_PUBLIC_HEX),
            "buzz-42-very-long-agent-79be667e"
        );
        assert_eq!(deployment_name("___", TEST_PUBLIC_HEX), "buzz-79be667e");
    }

    #[test]
    fn client_status_is_preserved_in_provider_error() {
        let error = map_client_error(HyperCliError::Status(StatusCode::UNPROCESSABLE_ENTITY));
        assert_eq!(
            error.to_string(),
            "HyperCLI deployment request failed: HyperCLI returned HTTP 422 Unprocessable Entity"
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
            &serde_json::json!({"runtime":"opencode","size":"large"})
        )
        .is_ok());
    }

    #[test]
    fn goose_and_kimi_code_use_distinct_canonical_images() {
        for (runtime, managed, image) in [
            (
                CodingRuntime::Goose,
                ManagedRuntime::Goose,
                DEFAULT_GOOSE_IMAGE,
            ),
            (
                CodingRuntime::KimiCode,
                ManagedRuntime::KimiCode,
                DEFAULT_KIMI_CODE_IMAGE,
            ),
        ] {
            let request = build_launch_request(
                test_agent_for(runtime),
                TEST_PUBLIC_HEX,
                "buzz-runtime-test",
                ProviderOptions {
                    runtime,
                    size: AgentSize::Large,
                    image: None,
                    workspace: None,
                },
            )
            .unwrap();
            assert_eq!(request.runtime, managed);
            assert_eq!(request.image.as_deref(), Some(image));
        }
    }

    #[test]
    fn runtime_contract_is_explicit_and_reserved_launch_env_cannot_override_it() {
        for (runtime, command, args, mcp) in [
            (
                CodingRuntime::Opencode,
                "/usr/local/bin/opencode",
                "acp",
                BUZZ_DEV_MCP_COMMAND,
            ),
            (
                CodingRuntime::Codex,
                "/usr/local/bin/codex-acp",
                "",
                BUZZ_DEV_MCP_COMMAND,
            ),
            (
                CodingRuntime::ClaudeCode,
                "/usr/local/bin/claude-agent-acp",
                "",
                "",
            ),
            (CodingRuntime::Goose, "/usr/local/bin/goose", "acp", ""),
            (CodingRuntime::KimiCode, "/usr/local/bin/kimi", "acp", ""),
        ] {
            let mut agent = test_agent_for(runtime);
            agent.name = "Fizz 4".to_owned();
            agent.env_vars.extend([
                ("BUZZ_ACP_AGENT_COMMAND".to_owned(), "/tmp/evil".to_owned()),
                ("BUZZ_ACP_AGENT_ARGS".to_owned(), "wrong".to_owned()),
                (
                    "BUZZ_ACP_MCP_COMMAND".to_owned(),
                    "/tmp/evil-mcp".to_owned(),
                ),
                ("BUZZ_ACP_LAZY_POOL".to_owned(), "false".to_owned()),
                ("BUZZ_ACP_RELAY_OBSERVER".to_owned(), "false".to_owned()),
                ("BUZZ_ACP_SESSION_TITLE".to_owned(), "Wrong".to_owned()),
                (
                    "BUZZ_ACP_MULTIPLE_EVENT_HANDLING".to_owned(),
                    "queue".to_owned(),
                ),
                ("BUZZ_ACP_DEDUP".to_owned(), "drop".to_owned()),
                (
                    "HYPER_WORKSPACES_DIR".to_owned(),
                    "/tmp/not-allowed".to_owned(),
                ),
            ]);
            let request = build_launch_request(
                agent,
                TEST_PUBLIC_HEX,
                "buzz-runtime-test",
                ProviderOptions {
                    runtime,
                    size: AgentSize::Large,
                    image: None,
                    workspace: None,
                },
            )
            .unwrap();

            assert_eq!(request.name.as_deref(), Some("fizz-4-79be667e"));
            assert_eq!(request.command, ["/usr/local/bin/buzz-acp"]);
            assert_eq!(request.env["BUZZ_ACP_AGENT_COMMAND"], command);
            assert_eq!(request.env["BUZZ_ACP_AGENT_ARGS"], args);
            assert_eq!(request.env["BUZZ_ACP_MCP_COMMAND"], mcp);
            assert_eq!(request.env["BUZZ_ACP_LAZY_POOL"], "true");
            assert_eq!(request.env["BUZZ_ACP_RELAY_OBSERVER"], "true");
            assert_eq!(request.env["BUZZ_ACP_SESSION_TITLE"], "Fizz 4");
            assert_eq!(request.env["BUZZ_ACP_MULTIPLE_EVENT_HANDLING"], "steer");
            assert_eq!(request.env["BUZZ_ACP_DEDUP"], "queue");
            assert_eq!(request.env["HYPER_WORKSPACES_DIR"], "/home/node/workspaces");
            assert_eq!(
                request.env["RUST_LOG"],
                "info,pool::prompt=info,acp::stream=info"
            );
        }
    }

    #[test]
    fn rejects_buzz_harness_that_does_not_match_selected_runtime() {
        let result = build_launch_request(
            test_agent(),
            TEST_PUBLIC_HEX,
            "buzz-runtime-test",
            ProviderOptions {
                runtime: CodingRuntime::Codex,
                size: AgentSize::Large,
                image: None,
                workspace: None,
            },
        );
        assert!(matches!(result, Err(ProviderError::AgentRuntimeMismatch)));
    }

    #[test]
    fn preserves_explicit_rust_log_filter() {
        let mut agent = test_agent();
        agent
            .env_vars
            .insert("RUST_LOG".to_owned(), "warn,pool::prompt=debug".to_owned());
        let request = build_launch_request(
            agent,
            TEST_PUBLIC_HEX,
            "buzz-runtime-test",
            ProviderOptions {
                runtime: CodingRuntime::Opencode,
                size: AgentSize::Large,
                image: None,
                workspace: None,
            },
        )
        .unwrap();
        assert_eq!(request.env["RUST_LOG"], "warn,pool::prompt=debug");
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
            .with_body(r#"{"items":[]}"#)
            .create();
        let create = server
            .mock("POST", "/agents/deployments")
            .match_header("authorization", "Bearer test-credential")
            .match_body(Matcher::PartialJsonString(
                serde_json::json!({
                    "handle": handle,
                    "runtime": "opencode",
                    "command": ["/usr/local/bin/buzz-acp"],
                    "tags": [format!("buzz_agent={TEST_PUBLIC_HEX}")],
                    "env": {
                        "BUZZ_RELAY_URL": "wss://buzz.example.com",
                        "BUZZ_PRIVATE_KEY": TEST_SECRET_HEX,
                        "NOSTR_PRIVATE_KEY": TEST_SECRET_HEX,
                        "BUZZ_AUTH_TAG": "[\"auth\",\"tag\"]",
                        "BUZZ_ACP_AGENT_COMMAND": "/usr/local/bin/opencode",
                        "BUZZ_ACP_AGENT_ARGS": "acp",
                        "BUZZ_ACP_MCP_COMMAND": "/usr/local/bin/buzz-dev-mcp",
                        "BUZZ_ACP_LAZY_POOL": "true",
                        "BUZZ_ACP_RELAY_OBSERVER": "true",
                        "BUZZ_ACP_SESSION_TITLE": "Fizz",
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
            serde_json::json!({"runtime":"opencode","size":"large"}),
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
                serde_json::json!({
                    "items": [{
                        "id":"existing",
                        "handle":handle,
                        "runtime":"opencode",
                        "state":"running"
                    }]
                })
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

    #[test]
    fn stop_returns_the_stopped_deployment_id() {
        let mut server = Server::new();
        let stop_request = server
            .mock("POST", "/agents/deployments/deployment-1/stop")
            .match_header("authorization", "Bearer test-credential")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id": "deployment-1",
                    "runtime": "opencode",
                    "state": "stopped"
                })
                .to_string(),
            )
            .create();

        let response = stop(&client(&server), "deployment-1".to_owned()).unwrap();
        assert_eq!(response.agent_id, "deployment-1");
        stop_request.assert();
    }
}
