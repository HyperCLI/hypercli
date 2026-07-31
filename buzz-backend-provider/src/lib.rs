use std::collections::{BTreeMap, HashSet};
use std::ffi::OsStr;
use std::path::Path;
use std::thread;
use std::time::{Duration, Instant};

#[cfg(test)]
use hypercli_sdk::BUZZ_RUNTIME_SCOPES;
use hypercli_sdk::{
    AgentSize, BuzzLaunchConfig, BuzzLaunchError, CreateDeploymentRequest, Deployment,
    HyperCliClient, HyperCliError, ManagedRuntime, StartDeploymentRequest,
};
use nostr::Keys;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use thiserror::Error;

const DEFAULT_BUZZ_OPENCODE_IMAGE: &str = "ghcr.io/hypercli/hypercli-buzz-opencode:latest";
const DEFAULT_BUZZ_CODEX_IMAGE: &str = "ghcr.io/hypercli/hypercli-buzz-codex:latest";
const DEFAULT_BUZZ_CLAUDE_CODE_IMAGE: &str = "ghcr.io/hypercli/hypercli-buzz-claude:latest";
const DEFAULT_BUZZ_GOOSE_IMAGE: &str = "ghcr.io/hypercli/hypercli-buzz-goose:latest";
const DEFAULT_BUZZ_KIMI_CODE_IMAGE: &str = "ghcr.io/hypercli/hypercli-buzz-kimi-code:latest";
const DEPLOYMENT_READY_TIMEOUT: Duration = Duration::from_secs(300);
#[cfg(not(test))]
const DEPLOYMENT_READY_POLL_INTERVAL: Duration = Duration::from_secs(2);
#[cfg(test)]
const DEPLOYMENT_READY_POLL_INTERVAL: Duration = Duration::ZERO;
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
            Self::Opencode => DEFAULT_BUZZ_OPENCODE_IMAGE,
            Self::Codex => DEFAULT_BUZZ_CODEX_IMAGE,
            Self::ClaudeCode => DEFAULT_BUZZ_CLAUDE_CODE_IMAGE,
            Self::Goose => DEFAULT_BUZZ_GOOSE_IMAGE,
            Self::KimiCode => DEFAULT_BUZZ_KIMI_CODE_IMAGE,
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
}

pub fn runtime_from_provider_program(program: &OsStr) -> CodingRuntime {
    let program = Path::new(program)
        .file_name()
        .and_then(OsStr::to_str)
        .unwrap_or_default();
    match program {
        "buzz-backend-hypercli-codex" => CodingRuntime::Codex,
        "buzz-backend-hypercli-claude" => CodingRuntime::ClaudeCode,
        "buzz-backend-hypercli-goose" => CodingRuntime::Goose,
        "buzz-backend-hypercli-kimi" => CodingRuntime::KimiCode,
        _ => CodingRuntime::Opencode,
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ProviderOptions {
    // Kept for compatibility with agents saved before runtime became
    // provider-filename-owned. New provider schemas advertise neither field.
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

#[derive(Debug, Serialize)]
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
    #[error("agent timeout configuration is invalid")]
    InvalidTimeoutConfiguration,
    #[error("agent respond_to mode is invalid")]
    InvalidRespondTo,
    #[error("agent respond_to allowlist is invalid")]
    InvalidRespondToAllowlist,
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
    #[error("HyperCLI deployment {deployment_id} is still {state}; retry after cleanup completes")]
    DeploymentBusy {
        deployment_id: String,
        state: String,
    },
    #[error("HyperCLI deployment {deployment_id} entered terminal state {state}")]
    DeploymentTerminalState {
        deployment_id: String,
        state: String,
    },
    #[error("HyperCLI deployment {deployment_id} returned unexpected state {state}")]
    UnexpectedDeploymentState {
        deployment_id: String,
        state: String,
    },
    #[error(
        "timed out waiting for HyperCLI deployment {deployment_id} to run (last state: {state})"
    )]
    DeploymentReadinessTimeout {
        deployment_id: String,
        state: String,
    },
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
                "image": {
                    "type": "string",
                    "title": "Runtime image",
                    "description": "Optional runtime image override; pin an immutable digest",
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
    deploy_with_dry_run_for_runtime(client, agent, provider_config, dry_run, None)
}

pub fn deploy_with_dry_run_for_runtime(
    client: &HyperCliClient,
    agent: BuzzAgentPayload,
    provider_config: Value,
    dry_run: bool,
    runtime: Option<CodingRuntime>,
) -> Result<DeployResponse, ProviderError> {
    deploy_with_readiness(
        client,
        agent,
        provider_config,
        dry_run,
        runtime,
        DEPLOYMENT_READY_TIMEOUT,
        DEPLOYMENT_READY_POLL_INTERVAL,
    )
}

fn deploy_with_readiness(
    client: &HyperCliClient,
    agent: BuzzAgentPayload,
    provider_config: Value,
    dry_run: bool,
    runtime_override: Option<CodingRuntime>,
    readiness_timeout: Duration,
    poll_interval: Duration,
) -> Result<DeployResponse, ProviderError> {
    validate_provider_config(&provider_config)?;
    let options: ProviderOptions = serde_json::from_value(provider_config)
        .map_err(|_| ProviderError::UnsupportedProviderConfig)?;
    let public_key = derive_agent_pubkey(&agent.private_key_nsec)?;
    let handle = deterministic_handle(&public_key);
    let mut request =
        build_launch_request_for_runtime(agent, &public_key, &handle, options, runtime_override)?;
    request.dry_run = dry_run;

    // A dry-run validates the requested launch shape and must never enter the
    // idempotent lookup/restart path. In particular, a stopped deployment with
    // the same deterministic handle must not be restarted.
    if dry_run {
        return client
            .create_deployment(&request)
            .map(|deployment| DeployResponse {
                agent_id: deployment.id,
            })
            .map_err(ProviderError::HyperCli);
    }

    if let Some(existing) = find_existing(client, &handle, request.runtime)? {
        let deployment = restart_if_stopped(client, existing, &request)?;
        let deployment = wait_until_running(client, deployment, readiness_timeout, poll_interval)?;
        return Ok(DeployResponse {
            agent_id: deployment.id,
        });
    }

    match client.create_deployment(&request) {
        Ok(deployment) => {
            let deployment =
                wait_until_running(client, deployment, readiness_timeout, poll_interval)?;
            Ok(DeployResponse {
                agent_id: deployment.id,
            })
        }
        Err(error) if error.status() == Some(StatusCode::CONFLICT) => {
            // Close the list-before-create race without inventing a separate
            // provider database. The user-scoped handle is deterministic.
            let existing = find_existing(client, &handle, request.runtime)?
                .ok_or(ProviderError::MissingConflictingDeployment)?;
            let existing = restart_if_stopped(client, existing, &request)?;
            let existing = wait_until_running(client, existing, readiness_timeout, poll_interval)?;
            Ok(DeployResponse {
                agent_id: existing.id,
            })
        }
        Err(error) => Err(ProviderError::HyperCli(error)),
    }
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
        restart: create.restart,
        runtime_scopes: create.runtime_scopes.clone(),
        dry_run: false,
    };
    client
        .start_deployment(&deployment.id, &start)
        .map_err(ProviderError::HyperCli)
}

fn wait_until_running(
    client: &HyperCliClient,
    mut deployment: Deployment,
    timeout: Duration,
    poll_interval: Duration,
) -> Result<Deployment, ProviderError> {
    let started = Instant::now();
    loop {
        let state = deployment.state.trim().to_ascii_lowercase();
        match state.as_str() {
            "running" => return Ok(deployment),
            "pending" | "restoring" | "syncing" | "starting" => {}
            "stopping" => {
                return Err(ProviderError::DeploymentBusy {
                    deployment_id: deployment.id,
                    state,
                });
            }
            "restore_failed" | "sync_failed" | "failed" | "stopped" => {
                return Err(ProviderError::DeploymentTerminalState {
                    deployment_id: deployment.id,
                    state,
                });
            }
            _ => {
                return Err(ProviderError::UnexpectedDeploymentState {
                    deployment_id: deployment.id,
                    state,
                });
            }
        }

        let elapsed = started.elapsed();
        if elapsed >= timeout {
            return Err(ProviderError::DeploymentReadinessTimeout {
                deployment_id: deployment.id,
                state,
            });
        }
        let remaining = timeout.saturating_sub(elapsed);
        thread::sleep(poll_interval.min(remaining));
        deployment = client
            .get_deployment(&deployment.id)
            .map_err(ProviderError::HyperCli)?;
    }
}

#[cfg(test)]
fn build_launch_request(
    agent: BuzzAgentPayload,
    public_key: &str,
    handle: &str,
    options: ProviderOptions,
) -> Result<CreateDeploymentRequest, ProviderError> {
    build_launch_request_for_runtime(agent, public_key, handle, options, None)
}

fn build_launch_request_for_runtime(
    agent: BuzzAgentPayload,
    public_key: &str,
    handle: &str,
    options: ProviderOptions,
    runtime_override: Option<CodingRuntime>,
) -> Result<CreateDeploymentRequest, ProviderError> {
    if agent.relay_url.trim().is_empty() {
        return Err(ProviderError::MissingRelayUrl);
    }
    if !(1..=32).contains(&agent.parallelism) {
        return Err(ProviderError::InvalidParallelism);
    }
    let _legacy_provider_selection = (options.runtime, options.size);
    let runtime = runtime_override.unwrap_or(CodingRuntime::Opencode);
    let behavior = validate_behavior(&agent)?;
    let goose_model = (runtime == CodingRuntime::Goose)
        .then(|| nonempty(agent.model.as_deref()))
        .flatten()
        .map(str::to_owned);
    let goose_provider = (runtime == CodingRuntime::Goose)
        .then(|| nonempty(agent.provider.as_deref()))
        .flatten()
        .map(str::to_owned);
    let display_name = agent.name.trim().to_owned();
    let mut request = CreateDeploymentRequest::new(runtime.managed());
    request.name = Some(deployment_name(&display_name, public_key));
    request.handle = Some(handle.to_owned());
    request.size = Some(AgentSize::Large);
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
    buzz.idle_timeout_seconds = behavior.idle_timeout_seconds;
    buzz.max_turn_duration_seconds = behavior.max_turn_duration_seconds;
    buzz.parallelism = agent.parallelism;
    buzz.respond_to = behavior.respond_to;
    buzz.respond_to_allowlist = behavior.respond_to_allowlist;
    buzz.apply_to(&mut request, Some(&display_name))?;

    let env = &mut request.env;
    if let Some(model) = goose_model {
        env.insert("GOOSE_MODEL".to_owned(), model);
    }
    if let Some(provider) = goose_provider {
        env.insert("GOOSE_PROVIDER".to_owned(), provider);
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
    Ok(request)
}

struct ValidatedBehavior {
    idle_timeout_seconds: Option<u64>,
    max_turn_duration_seconds: Option<u64>,
    respond_to: Option<String>,
    respond_to_allowlist: Vec<String>,
}

fn validate_behavior(agent: &BuzzAgentPayload) -> Result<ValidatedBehavior, ProviderError> {
    const DEFAULT_IDLE_TIMEOUT_SECONDS: u64 = 900;
    const DEFAULT_MAX_TURN_DURATION_SECONDS: u64 = 7200;
    const MAX_TURN_DURATION_CEILING_SECONDS: u64 = 604_800;

    let idle_timeout_seconds = agent
        .idle_timeout_seconds
        .or(agent.turn_timeout_seconds)
        .map(|value| value.max(1));
    let max_turn_duration_seconds =
        agent
            .max_turn_duration_seconds
            .map(|value| if value == 0 { 60 } else { value });
    let effective_idle = idle_timeout_seconds.unwrap_or(DEFAULT_IDLE_TIMEOUT_SECONDS);
    let effective_max = max_turn_duration_seconds.unwrap_or(DEFAULT_MAX_TURN_DURATION_SECONDS);
    if effective_max > MAX_TURN_DURATION_CEILING_SECONDS || effective_idle >= effective_max {
        return Err(ProviderError::InvalidTimeoutConfiguration);
    }

    let respond_to = agent
        .respond_to
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if respond_to
        .is_some_and(|value| !matches!(value, "owner-only" | "allowlist" | "anyone" | "nobody"))
    {
        return Err(ProviderError::InvalidRespondTo);
    }

    let mut seen = HashSet::new();
    let mut normalized_allowlist = Vec::with_capacity(agent.respond_to_allowlist.len());
    for entry in &agent.respond_to_allowlist {
        let entry = entry.trim();
        if entry.len() != 64 || !entry.chars().all(|character| character.is_ascii_hexdigit()) {
            return Err(ProviderError::InvalidRespondToAllowlist);
        }
        let entry = entry.to_ascii_lowercase();
        if seen.insert(entry.clone()) {
            normalized_allowlist.push(entry);
        }
    }
    if respond_to == Some("allowlist") && normalized_allowlist.is_empty() {
        return Err(ProviderError::InvalidRespondToAllowlist);
    }
    if respond_to != Some("allowlist") {
        normalized_allowlist.clear();
    }

    Ok(ValidatedBehavior {
        idle_timeout_seconds,
        max_turn_duration_seconds,
        respond_to: respond_to.map(str::to_owned),
        respond_to_allowlist: normalized_allowlist,
    })
}

fn nonempty(value: Option<&str>) -> Option<&str> {
    value.map(str::trim).filter(|value| !value.is_empty())
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
    use std::sync::{Arc, Barrier};
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
        client_for_url(&server.url())
    }

    fn client_for_url(server_url: &str) -> HyperCliClient {
        HyperCliClient::new(ClientConfig {
            api_base: Url::parse(&format!("{server_url}/agents")).unwrap(),
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
    fn runtime_catalog_uses_distinct_buzz_images() {
        for (runtime, managed, image) in [
            (
                CodingRuntime::Opencode,
                ManagedRuntime::Opencode,
                DEFAULT_BUZZ_OPENCODE_IMAGE,
            ),
            (
                CodingRuntime::Codex,
                ManagedRuntime::Codex,
                DEFAULT_BUZZ_CODEX_IMAGE,
            ),
            (
                CodingRuntime::ClaudeCode,
                ManagedRuntime::ClaudeCode,
                DEFAULT_BUZZ_CLAUDE_CODE_IMAGE,
            ),
            (
                CodingRuntime::Goose,
                ManagedRuntime::Goose,
                DEFAULT_BUZZ_GOOSE_IMAGE,
            ),
            (
                CodingRuntime::KimiCode,
                ManagedRuntime::KimiCode,
                DEFAULT_BUZZ_KIMI_CODE_IMAGE,
            ),
        ] {
            let request = build_launch_request_for_runtime(
                test_agent_for(runtime),
                TEST_PUBLIC_HEX,
                "buzz-runtime-test",
                ProviderOptions {
                    runtime,
                    size: AgentSize::Large,
                    image: None,
                    workspace: None,
                },
                Some(runtime),
            )
            .unwrap();
            assert_eq!(request.runtime, managed);
            assert_eq!(request.image.as_deref(), Some(image));
        }
    }

    #[test]
    fn provider_program_names_resolve_to_canonical_runtimes() {
        for (program, expected) in [
            ("buzz-backend-hypercli", CodingRuntime::Opencode),
            ("buzz-backend-hypercli-opencode", CodingRuntime::Opencode),
            ("buzz-backend-hypercli-codex", CodingRuntime::Codex),
            ("buzz-backend-hypercli-claude", CodingRuntime::ClaudeCode),
            ("buzz-backend-hypercli-goose", CodingRuntime::Goose),
            ("buzz-backend-hypercli-kimi", CodingRuntime::KimiCode),
        ] {
            assert_eq!(runtime_from_provider_program(OsStr::new(program)), expected);
            assert_eq!(
                runtime_from_provider_program(OsStr::new(&format!("/usr/local/bin/{program}"))),
                expected
            );
        }
    }

    #[test]
    fn goose_structured_model_and_provider_override_user_environment() {
        let mut agent = test_agent_for(CodingRuntime::Goose);
        agent.model = Some("structured-model".to_owned());
        agent.provider = Some("structured-provider".to_owned());
        agent
            .env_vars
            .insert("GOOSE_MODEL".to_owned(), "stale-model".to_owned());
        agent
            .env_vars
            .insert("GOOSE_PROVIDER".to_owned(), "stale-provider".to_owned());

        let request = build_launch_request_for_runtime(
            agent,
            TEST_PUBLIC_HEX,
            "buzz-runtime-test",
            ProviderOptions {
                runtime: CodingRuntime::Goose,
                size: AgentSize::Large,
                image: None,
                workspace: None,
            },
            Some(CodingRuntime::Goose),
        )
        .unwrap();

        assert_eq!(request.env["GOOSE_MODEL"], "structured-model");
        assert_eq!(request.env["GOOSE_PROVIDER"], "structured-provider");
    }

    #[test]
    fn stock_behavior_fields_use_legacy_timeout_and_normalize_allowlist() {
        let allowlisted = "A".repeat(64);
        let mut agent = test_agent();
        agent.turn_timeout_seconds = Some(320);
        agent.idle_timeout_seconds = None;
        agent.respond_to = Some("allowlist".to_owned());
        agent.respond_to_allowlist =
            vec![format!(" {allowlisted} "), allowlisted.to_ascii_lowercase()];

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

        assert_eq!(request.env["BUZZ_ACP_IDLE_TIMEOUT"], "320");
        assert_eq!(request.env["BUZZ_ACP_RESPOND_TO"], "allowlist");
        assert_eq!(request.env["BUZZ_ACP_RESPOND_TO_ALLOWLIST"], "a".repeat(64));
    }

    #[test]
    fn rejects_behavior_that_stock_buzz_cannot_launch() {
        let options = || ProviderOptions {
            runtime: CodingRuntime::Opencode,
            size: AgentSize::Large,
            image: None,
            workspace: None,
        };

        let mut invalid_mode = test_agent();
        invalid_mode.respond_to = Some("everybody".to_owned());
        assert!(matches!(
            build_launch_request(
                invalid_mode,
                TEST_PUBLIC_HEX,
                "buzz-runtime-test",
                options()
            ),
            Err(ProviderError::InvalidRespondTo)
        ));

        let mut nobody = test_agent();
        nobody.respond_to = Some("nobody".to_owned());
        nobody.respond_to_allowlist = vec!["a".repeat(64)];
        let nobody_request =
            build_launch_request(nobody, TEST_PUBLIC_HEX, "buzz-runtime-test", options()).unwrap();
        assert_eq!(nobody_request.env["BUZZ_ACP_RESPOND_TO"], "nobody");
        assert!(!nobody_request
            .env
            .contains_key("BUZZ_ACP_RESPOND_TO_ALLOWLIST"));

        let mut empty_allowlist = test_agent();
        empty_allowlist.respond_to = Some("allowlist".to_owned());
        assert!(matches!(
            build_launch_request(
                empty_allowlist,
                TEST_PUBLIC_HEX,
                "buzz-runtime-test",
                options()
            ),
            Err(ProviderError::InvalidRespondToAllowlist)
        ));

        let mut invalid_allowlist = test_agent();
        invalid_allowlist.respond_to = Some("allowlist".to_owned());
        invalid_allowlist.respond_to_allowlist = vec!["not-a-pubkey".to_owned()];
        assert!(matches!(
            build_launch_request(
                invalid_allowlist,
                TEST_PUBLIC_HEX,
                "buzz-runtime-test",
                options()
            ),
            Err(ProviderError::InvalidRespondToAllowlist)
        ));

        let mut invalid_timeout = test_agent();
        invalid_timeout.idle_timeout_seconds = Some(900);
        invalid_timeout.max_turn_duration_seconds = Some(900);
        assert!(matches!(
            build_launch_request(
                invalid_timeout,
                TEST_PUBLIC_HEX,
                "buzz-runtime-test",
                options()
            ),
            Err(ProviderError::InvalidTimeoutConfiguration)
        ));
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
            let request = build_launch_request_for_runtime(
                agent,
                TEST_PUBLIC_HEX,
                "buzz-runtime-test",
                ProviderOptions {
                    runtime,
                    size: AgentSize::Large,
                    image: None,
                    workspace: None,
                },
                Some(runtime),
            )
            .unwrap();

            assert_eq!(request.name.as_deref(), Some("fizz-4-79be667e"));
            assert_eq!(request.command, ["/usr/local/bin/buzz-acp"]);
            assert_eq!(
                request.runtime_scopes,
                BUZZ_RUNTIME_SCOPES.map(str::to_owned)
            );
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
                "buzz_acp=info,pool::prompt=info,acp::stream=off"
            );
        }
    }

    #[test]
    fn provider_runtime_is_authoritative_over_harness_and_legacy_config() {
        let request = build_launch_request_for_runtime(
            test_agent(),
            TEST_PUBLIC_HEX,
            "buzz-runtime-test",
            ProviderOptions {
                runtime: CodingRuntime::Codex,
                size: AgentSize::Large,
                image: None,
                workspace: None,
            },
            Some(CodingRuntime::Codex),
        )
        .unwrap();
        assert_eq!(request.runtime, ManagedRuntime::Codex);
        assert_eq!(request.size, Some(AgentSize::Large));
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
                    "restart": false,
                    "runtime_scopes": BUZZ_RUNTIME_SCOPES,
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
        let ready = server
            .mock("GET", "/agents/deployments/deployment-1")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id":"deployment-1",
                    "handle":format!("buzz-{}", &TEST_PUBLIC_HEX[..48]),
                    "runtime":"opencode",
                    "state":"running"
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
        ready.assert();
    }

    #[test]
    fn deploy_restarts_stopped_agent_with_buzz_restart_policy() {
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
                        "state":"stopped"
                    }]
                })
                .to_string(),
            )
            .create();
        let restart = server
            .mock("POST", "/agents/deployments/existing/start")
            .match_body(Matcher::PartialJsonString(
                serde_json::json!({
                    "image": "ghcr.io/hypercli/hypercli-buzz-opencode:latest",
                    "restart": false,
                    "command": ["/usr/local/bin/buzz-acp"],
                    "sync_root": "/home/node",
                    "sync_enabled": true,
                    "sync_uid": 1000,
                    "sync_gid": 1000,
                    "runtime_scopes": BUZZ_RUNTIME_SCOPES,
                    "env": {
                        "BUZZ_PRIVATE_KEY": TEST_SECRET_HEX,
                        "NOSTR_PRIVATE_KEY": TEST_SECRET_HEX,
                        "BUZZ_RELAY_URL": "wss://buzz.example.com",
                        "BUZZ_ACP_AGENT_COMMAND": "/usr/local/bin/opencode",
                        "BUZZ_ACP_AGENT_ARGS": "acp",
                        "BUZZ_ACP_MCP_COMMAND": "/usr/local/bin/buzz-dev-mcp",
                        "HYPER_WORKSPACES_BOOT_SYNC": "1",
                        "HYPER_WORKSPACES_DIR": "/home/node/workspaces"
                    }
                })
                .to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id":"existing",
                    "handle":format!("buzz-{}", &TEST_PUBLIC_HEX[..48]),
                    "runtime":"opencode",
                    "state":"pending"
                })
                .to_string(),
            )
            .create();
        let ready = server
            .mock("GET", "/agents/deployments/existing")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id":"existing",
                    "handle":format!("buzz-{}", &TEST_PUBLIC_HEX[..48]),
                    "runtime":"opencode",
                    "state":"running"
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
        restart.assert();
        ready.assert();
    }

    #[test]
    fn deploy_conflict_recovery_restarts_stopped_agent_without_creating_a_copy() {
        let mut server = Server::new();
        let handle = format!("buzz-{}", &TEST_PUBLIC_HEX[..48]);
        let initial_lookup = server
            .mock("GET", "/agents/deployments")
            .match_query(Matcher::UrlEncoded("handle".into(), handle.clone()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"items":[]}"#)
            .expect(1)
            .create();
        let recovered_lookup = server
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
                        "state":"stopped"
                    }]
                })
                .to_string(),
            )
            .expect(1)
            .create();
        let conflicting_create = server
            .mock("POST", "/agents/deployments")
            .with_status(409)
            .expect(1)
            .create();
        let restart = server
            .mock("POST", "/agents/deployments/existing/start")
            .match_body(Matcher::PartialJsonString(
                serde_json::json!({
                    "restart": false,
                    "command": ["/usr/local/bin/buzz-acp"],
                    "runtime_scopes": BUZZ_RUNTIME_SCOPES
                })
                .to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id":"existing",
                    "handle":format!("buzz-{}", &TEST_PUBLIC_HEX[..48]),
                    "runtime":"opencode",
                    "state":"pending"
                })
                .to_string(),
            )
            .expect(1)
            .create();
        let ready = server
            .mock("GET", "/agents/deployments/existing")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id":"existing",
                    "handle":format!("buzz-{}", &TEST_PUBLIC_HEX[..48]),
                    "runtime":"opencode",
                    "state":"running"
                })
                .to_string(),
            )
            .expect(1)
            .create();

        let response = deploy(
            &client(&server),
            test_agent(),
            serde_json::json!({"runtime":"opencode"}),
        )
        .unwrap();

        assert_eq!(response.agent_id, "existing");
        initial_lookup.assert();
        recovered_lookup.assert();
        conflicting_create.assert();
        restart.assert();
        ready.assert();
    }

    #[test]
    fn simultaneous_first_deploys_converge_on_one_deterministic_handle() {
        let mut server = Server::new();
        let server_url = server.url();
        let handle = format!("buzz-{}", &TEST_PUBLIC_HEX[..48]);
        let initial_lookups = server
            .mock("GET", "/agents/deployments")
            .match_query(Matcher::UrlEncoded("handle".into(), handle.clone()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"items":[]}"#)
            .expect(2)
            .create();
        let recovered_lookup = server
            .mock("GET", "/agents/deployments")
            .match_query(Matcher::UrlEncoded("handle".into(), handle.clone()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "items": [{
                        "id":"shared",
                        "handle":handle,
                        "runtime":"opencode",
                        "state":"pending"
                    }]
                })
                .to_string(),
            )
            .expect(1)
            .create();
        let winning_create = server
            .mock("POST", "/agents/deployments")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id":"shared",
                    "handle":format!("buzz-{}", &TEST_PUBLIC_HEX[..48]),
                    "runtime":"opencode",
                    "state":"pending"
                })
                .to_string(),
            )
            .expect(1)
            .create();
        let losing_create = server
            .mock("POST", "/agents/deployments")
            .with_status(409)
            .expect(1)
            .create();
        let ready = server
            .mock("GET", "/agents/deployments/shared")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id":"shared",
                    "handle":format!("buzz-{}", &TEST_PUBLIC_HEX[..48]),
                    "runtime":"opencode",
                    "state":"running"
                })
                .to_string(),
            )
            .expect(2)
            .create();

        let barrier = Arc::new(Barrier::new(2));
        let workers: Vec<_> = (0..2)
            .map(|_| {
                let barrier = Arc::clone(&barrier);
                let server_url = server_url.clone();
                std::thread::spawn(move || {
                    barrier.wait();
                    deploy_with_readiness(
                        &client_for_url(&server_url),
                        test_agent(),
                        serde_json::json!({"runtime":"opencode"}),
                        false,
                        None,
                        Duration::from_secs(1),
                        Duration::ZERO,
                    )
                })
            })
            .collect();
        let responses: Vec<_> = workers
            .into_iter()
            .map(|worker| worker.join().unwrap().unwrap())
            .collect();

        assert!(responses
            .iter()
            .all(|response| response.agent_id == "shared"));
        initial_lookups.assert();
        recovered_lookup.assert();
        winning_create.assert();
        losing_create.assert();
        ready.assert();
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
        let readiness_poll = server
            .mock("GET", "/agents/deployments/existing")
            .expect(0)
            .create();

        let response = deploy(
            &client(&server),
            test_agent(),
            serde_json::json!({"runtime":"opencode"}),
        )
        .unwrap();
        assert_eq!(response.agent_id, "existing");
        lookup.assert();
        readiness_poll.assert();
    }

    #[test]
    fn deploy_does_not_restart_agent_while_backend_cleanup_is_stopping() {
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
                        "state":"stopping"
                    }]
                })
                .to_string(),
            )
            .create();

        let error = deploy(
            &client(&server),
            test_agent(),
            serde_json::json!({"runtime":"opencode"}),
        )
        .unwrap_err();

        assert!(matches!(
            error,
            ProviderError::DeploymentBusy {
                deployment_id,
                state
            } if deployment_id == "existing" && state == "stopping"
        ));
        lookup.assert();
    }

    #[test]
    fn deploy_waits_for_an_existing_booting_agent_without_restarting_it() {
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
                        "state":"restoring"
                    }]
                })
                .to_string(),
            )
            .create();
        let create = server
            .mock("POST", "/agents/deployments")
            .expect(0)
            .create();
        let restart = server
            .mock("POST", "/agents/deployments/existing/start")
            .expect(0)
            .create();
        let ready = server
            .mock("GET", "/agents/deployments/existing")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id":"existing",
                    "handle":format!("buzz-{}", &TEST_PUBLIC_HEX[..48]),
                    "runtime":"opencode",
                    "state":"running"
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
        create.assert();
        restart.assert();
        ready.assert();
    }

    #[test]
    fn readiness_wait_accepts_every_booting_state_before_running() {
        let mut server = Server::new();
        let restoring = server
            .mock("GET", "/agents/deployments/deployment-1")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"id":"deployment-1","runtime":"opencode","state":"restoring"}"#)
            .expect(1)
            .create();
        let syncing = server
            .mock("GET", "/agents/deployments/deployment-1")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"id":"deployment-1","runtime":"opencode","state":"syncing"}"#)
            .expect(1)
            .create();
        let starting = server
            .mock("GET", "/agents/deployments/deployment-1")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"id":"deployment-1","runtime":"opencode","state":"starting"}"#)
            .expect(1)
            .create();
        let running = server
            .mock("GET", "/agents/deployments/deployment-1")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"id":"deployment-1","runtime":"opencode","state":"running"}"#)
            .expect(1)
            .create();
        let initial = Deployment {
            id: "deployment-1".to_owned(),
            name: String::new(),
            handle: None,
            runtime: Some(ManagedRuntime::Opencode),
            state: "pending".to_owned(),
            pod_id: None,
            hostname: None,
        };

        let ready = wait_until_running(
            &client(&server),
            initial,
            Duration::from_secs(1),
            Duration::ZERO,
        )
        .unwrap();

        assert_eq!(ready.state, "running");
        restoring.assert();
        syncing.assert();
        starting.assert();
        running.assert();
    }

    #[test]
    fn readiness_wait_fails_immediately_for_terminal_states() {
        for state in ["restore_failed", "sync_failed", "failed", "stopped"] {
            let mut server = Server::new();
            let poll = server
                .mock("GET", "/agents/deployments/deployment-1")
                .expect(0)
                .create();
            let deployment = Deployment {
                id: "deployment-1".to_owned(),
                name: String::new(),
                handle: None,
                runtime: Some(ManagedRuntime::Opencode),
                state: state.to_owned(),
                pod_id: None,
                hostname: None,
            };

            let error = wait_until_running(
                &client(&server),
                deployment,
                Duration::from_secs(1),
                Duration::ZERO,
            )
            .unwrap_err();

            assert!(matches!(
                error,
                ProviderError::DeploymentTerminalState {
                    deployment_id,
                    state: terminal_state
                } if deployment_id == "deployment-1" && terminal_state == state
            ));
            poll.assert();
        }
    }

    #[test]
    fn readiness_timeout_reports_only_deployment_id_and_last_state() {
        let mut server = Server::new();
        let poll = server
            .mock("GET", "/agents/deployments/deployment-1")
            .expect(0)
            .create();
        let deployment = Deployment {
            id: "deployment-1".to_owned(),
            name: String::new(),
            handle: None,
            runtime: Some(ManagedRuntime::Opencode),
            state: "starting".to_owned(),
            pod_id: None,
            hostname: None,
        };

        let error =
            wait_until_running(&client(&server), deployment, Duration::ZERO, Duration::ZERO)
                .unwrap_err();

        assert!(matches!(
            &error,
            ProviderError::DeploymentReadinessTimeout {
                deployment_id,
                state
            } if deployment_id == "deployment-1" && state == "starting"
        ));
        assert_eq!(
            error.to_string(),
            "timed out waiting for HyperCLI deployment deployment-1 to run (last state: starting)"
        );
        poll.assert();
    }

    #[test]
    fn dry_run_never_looks_up_or_restarts_an_existing_deployment() {
        for state in ["running", "stopped"] {
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
                            "id": "existing",
                            "handle": handle,
                            "runtime": "opencode",
                            "state": state
                        }]
                    })
                    .to_string(),
                )
                .expect(0)
                .create();
            let restart = server
                .mock("POST", "/agents/deployments/existing/start")
                .expect(0)
                .create();
            let readiness_poll = server
                .mock(
                    "GET",
                    format!("/agents/deployments/dry-run-{state}").as_str(),
                )
                .expect(0)
                .create();
            let create = server
                .mock("POST", "/agents/deployments")
                .match_body(Matcher::PartialJsonString(
                    serde_json::json!({"dry_run": true}).to_string(),
                ))
                .with_status(200)
                .with_header("content-type", "application/json")
                .with_body(
                    serde_json::json!({
                        "id": format!("dry-run-{state}"),
                        "runtime": "opencode",
                        "state": "pending"
                    })
                    .to_string(),
                )
                .create();

            let response = deploy_with_dry_run(
                &client(&server),
                test_agent(),
                serde_json::json!({"runtime":"opencode"}),
                true,
            )
            .unwrap();

            assert_eq!(response.agent_id, format!("dry-run-{state}"));
            lookup.assert();
            restart.assert();
            readiness_poll.assert();
            create.assert();
        }
    }
}
