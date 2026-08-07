use std::collections::{BTreeMap, HashSet};
use std::fmt::Write as _;
use std::thread;
use std::time::{Duration, Instant};

use hypercli_sdk::{
    canonical_deployment_name, AgentCapacity, AgentSize, CreateDeploymentRequest, Deployment,
    HyperCliClient, HyperCliError, ManagedRuntime, StartDeploymentRequest, BUZZ_RUNTIME_SCOPES,
};
use nostr::Keys;
use reqwest::StatusCode;
use serde::{Deserialize, Serialize};
use serde_json::Value;
use sha2::{Digest, Sha256};
use thiserror::Error;
use url::Url;

const BUZZ_LAUNCH_TAG_PREFIX: &str = "buzz_launch=";
// CI bakes an immutable candidate into the exact provider binary under test so
// the image remains provider-controlled rather than becoming a user-facing
// schema knob. Release builds do not set this and use the runtime defaults.
const COMPILE_TIME_DEFAULT_IMAGE_OVERRIDE: Option<&str> =
    option_env!("HYPERCLI_BUZZ_DEFAULT_IMAGE_OVERRIDE");
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
    Info,
    Deploy {
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
    #[serde(default)]
    pub launch: Option<BuzzLaunchBlock>,
}

/// Desktop-resolved portable launch data. Legacy top-level launch fields are
/// retained only for payloads from older Buzz versions.
#[derive(Deserialize)]
pub struct BuzzLaunchBlock {
    #[serde(default)]
    pub command: Option<String>,
    #[serde(default)]
    pub args: Vec<String>,
    #[serde(default)]
    pub env: BTreeMap<String, String>,
    #[serde(default)]
    pub policy_env: BTreeMap<String, String>,
    #[serde(default)]
    pub owner_pubkey: Option<String>,
}

fn default_parallelism() -> u32 {
    1
}

#[derive(Clone, Copy, Debug, Deserialize, Eq, PartialEq)]
#[serde(rename_all = "kebab-case")]
pub enum CodingRuntime {
    BuzzAgent,
    Opencode,
    Codex,
    ClaudeCode,
    Goose,
    KimiCode,
}

impl CodingRuntime {
    fn managed(self) -> ManagedRuntime {
        match self {
            Self::BuzzAgent => ManagedRuntime::BuzzAgent,
            Self::Opencode => ManagedRuntime::Opencode,
            Self::Codex => ManagedRuntime::Codex,
            Self::ClaudeCode => ManagedRuntime::ClaudeCode,
            Self::Goose => ManagedRuntime::Goose,
            Self::KimiCode => ManagedRuntime::KimiCode,
        }
    }

    fn default_image(self) -> &'static str {
        self.managed()
            .default_buzz_image()
            .expect("every coding runtime has a managed Buzz image")
    }

    fn harness_command(self) -> &'static str {
        match self {
            Self::BuzzAgent => "/usr/local/bin/buzz-agent",
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
            Self::BuzzAgent => "",
            Self::Opencode | Self::Goose | Self::KimiCode => "acp",
            Self::Codex | Self::ClaudeCode => "",
        }
    }
}

fn runtime_from_agent_command(command: &str) -> Option<CodingRuntime> {
    let command = command
        .trim()
        .rsplit(['/', '\\'])
        .next()
        .unwrap_or_default();
    let command = command
        .get(command.len().saturating_sub(".exe".len())..)
        .filter(|suffix| suffix.eq_ignore_ascii_case(".exe"))
        .map(|_| &command[..command.len() - ".exe".len()])
        .unwrap_or(command);
    match command.to_ascii_lowercase().as_str() {
        "buzz-agent" => Some(CodingRuntime::BuzzAgent),
        "opencode" => Some(CodingRuntime::Opencode),
        "codex-acp" => Some(CodingRuntime::Codex),
        "claude-agent-acp" | "claude-code-acp" => Some(CodingRuntime::ClaudeCode),
        "goose" => Some(CodingRuntime::Goose),
        "kimi" => Some(CodingRuntime::KimiCode),
        _ => None,
    }
}

#[derive(Debug, Deserialize)]
#[serde(deny_unknown_fields)]
struct ProviderOptions {
    // Kept for compatibility with saved provider configurations. Portable
    // launch.command is authoritative when present.
    #[serde(default = "default_runtime")]
    runtime: CodingRuntime,
    #[serde(default = "default_size")]
    size: AgentSize,
    #[serde(default)]
    image: Option<String>,
    #[serde(default)]
    workspace: Option<String>,
    #[serde(default)]
    api_base: Option<String>,
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
    pub protocol_version: u32,
    pub description: &'static str,
    pub config_schema: Value,
}

#[derive(Debug, Serialize)]
pub struct DeployResponse {
    pub ok: bool,
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
    #[error("provider_config.api_base must be a valid HTTP(S) HyperCLI API URL")]
    InvalidProviderApiBase,
    #[error("agent identity is invalid")]
    InvalidAgentIdentity,
    #[error("agent relay URL is required")]
    MissingRelayUrl,
    #[error("agent parallelism must be between 1 and 32")]
    InvalidParallelism,
    #[error("Buzz launch arguments cannot contain commas")]
    InvalidLaunchArguments,
    #[error("agent timeout configuration is invalid")]
    InvalidTimeoutConfiguration,
    #[error("agent respond_to mode is invalid")]
    InvalidRespondTo,
    #[error("agent respond_to allowlist is invalid")]
    InvalidRespondToAllowlist,
    #[error("Buzz launch command is unsupported")]
    UnsupportedLaunchCommand,
    #[error("Buzz launch environment contains an invalid variable name")]
    InvalidEnvironmentKey,
    #[error("BUZZ_ACP_NO_PRESENCE is not permitted for a hosted agent")]
    PresenceSuppression,
    #[error("Buzz launch has no authenticated owner")]
    MissingOwner,
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
    #[error("existing deployment identity tag does not match the requested Buzz agent")]
    IdentityMismatch,
    #[error("existing deployment runtime does not match the requested runtime")]
    RuntimeMismatch,
    #[error(
        "existing deployment launch settings differ from this request; shut it down before redeploying"
    )]
    LaunchMismatch,
    #[error("Buzz launch fingerprint could not be encoded")]
    LaunchFingerprintEncoding,
    #[error("no HyperCLI agent slots are currently available")]
    NoAvailableSlots,
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
        protocol_version: 1,
        description: "Run Buzz coding agents in isolated HyperCLI Reef pods",
        config_schema: serde_json::json!({
            "type": "object",
            "additionalProperties": false,
            "properties": {
                "api_base": {
                    "type": "string",
                    "title": "HyperCLI API base URL",
                    "description": "Advanced: leave empty to use your installed HyperCLI configuration. Set this only for a trusted dev or self-hosted control plane; your HyperCLI credential is sent to this URL."
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
    deploy_with_readiness(
        client,
        agent,
        provider_config,
        dry_run,
        DEPLOYMENT_READY_TIMEOUT,
        DEPLOYMENT_READY_POLL_INTERVAL,
    )
}

fn deploy_with_readiness(
    client: &HyperCliClient,
    agent: BuzzAgentPayload,
    provider_config: Value,
    dry_run: bool,
    readiness_timeout: Duration,
    poll_interval: Duration,
) -> Result<DeployResponse, ProviderError> {
    validate_provider_config(&provider_config)?;
    let options: ProviderOptions = serde_json::from_value(provider_config)
        .map_err(|_| ProviderError::UnsupportedProviderConfig)?;
    let public_key = derive_agent_pubkey(&agent.private_key_nsec)?;
    let handle = deterministic_handle(&public_key);
    let product_api_base = match provider_api_base_from_options(&options)? {
        Some(api_base) => product_api_base_from_agents_url(&api_base),
        None => client.product_api_base(),
    };
    let mut request = build_launch_request_with_inference_base(
        agent,
        &public_key,
        &handle,
        options,
        &product_api_base,
    )?;
    request.dry_run = dry_run;
    mark_launch_fingerprint(&mut request)?;
    // Apply tier defaults only when concurrency is genuinely unspecified.
    // Any concrete Buzz value — including 1 — is authoritative.
    let size_based_parallelism = !request.env.contains_key("BUZZ_ACP_AGENTS");

    // A dry-run validates the requested launch shape and must never enter the
    // idempotent lookup/restart path. In particular, a stopped deployment with
    // the same deterministic handle must not be restarted.
    if dry_run {
        let capacity = client
            .list_deployments_with_capacity()
            .map_err(ProviderError::HyperCli)?;
        let selected_size = capacity
            .largest_available_size()
            .ok_or(ProviderError::NoAvailableSlots)?;
        request.size = Some(selected_size);
        apply_size_based_parallelism(&mut request, selected_size, size_based_parallelism);
        return client
            .create_deployment(&request)
            .map(|deployment| DeployResponse {
                ok: true,
                agent_id: deployment.id,
            })
            .map_err(ProviderError::HyperCli);
    }

    let (existing, mut capacity) = find_existing_with_capacity(client, &handle, &public_key)?;
    if let Some(existing) = existing {
        apply_existing_size_parallelism(&mut request, &existing, size_based_parallelism);
        if let Some(deployment) = reconcile_existing(client, existing, &request)? {
            let deployment =
                wait_until_running(client, deployment, readiness_timeout, poll_interval)?;
            return Ok(DeployResponse {
                ok: true,
                agent_id: deployment.id,
            });
        }
    }

    let mut attempted_sizes = Vec::new();
    loop {
        let selected_size = largest_unattempted_size(&capacity, &attempted_sizes)
            .ok_or(ProviderError::NoAvailableSlots)?;
        request.size = Some(selected_size);
        apply_size_based_parallelism(&mut request, selected_size, size_based_parallelism);
        attempted_sizes.push(selected_size);

        match client.create_deployment(&request) {
            Ok(deployment) => {
                let deployment =
                    wait_until_running(client, deployment, readiness_timeout, poll_interval)?;
                return Ok(DeployResponse {
                    ok: true,
                    agent_id: deployment.id,
                });
            }
            Err(error) if error.status() == Some(StatusCode::CONFLICT) => {
                // Close the list-before-create race without inventing a separate
                // provider database. The user-scoped handle is deterministic.
                let (existing, refreshed) =
                    find_existing_with_capacity(client, &handle, &public_key)?;
                let existing = existing.ok_or(ProviderError::MissingConflictingDeployment)?;
                apply_existing_size_parallelism(&mut request, &existing, size_based_parallelism);
                if let Some(existing) = reconcile_existing(client, existing, &request)? {
                    let existing =
                        wait_until_running(client, existing, readiness_timeout, poll_interval)?;
                    return Ok(DeployResponse {
                        ok: true,
                        agent_id: existing.id,
                    });
                }
                capacity = refreshed;
                attempted_sizes.clear();
            }
            Err(error) if error.status() == Some(StatusCode::TOO_MANY_REQUESTS) => {
                let (existing, refreshed) =
                    find_existing_with_capacity(client, &handle, &public_key)?;
                if let Some(existing) = existing {
                    apply_existing_size_parallelism(
                        &mut request,
                        &existing,
                        size_based_parallelism,
                    );
                    if let Some(existing) = reconcile_existing(client, existing, &request)? {
                        let existing =
                            wait_until_running(client, existing, readiness_timeout, poll_interval)?;
                        return Ok(DeployResponse {
                            ok: true,
                            agent_id: existing.id,
                        });
                    }
                    attempted_sizes.clear();
                }
                capacity = refreshed;
                if largest_unattempted_size(&capacity, &attempted_sizes).is_none() {
                    return Err(ProviderError::HyperCli(error));
                }
            }
            Err(error) => return Err(ProviderError::HyperCli(error)),
        }
    }
}

fn default_parallelism_for_size(size: AgentSize) -> u32 {
    match size {
        AgentSize::Small => 2,
        AgentSize::Medium => 5,
        AgentSize::Large => 10,
    }
}

fn apply_size_based_parallelism(
    request: &mut CreateDeploymentRequest,
    size: AgentSize,
    enabled: bool,
) {
    if enabled {
        request.env.insert(
            "BUZZ_ACP_AGENTS".to_owned(),
            default_parallelism_for_size(size).to_string(),
        );
    }
}

fn apply_existing_size_parallelism(
    request: &mut CreateDeploymentRequest,
    existing: &Deployment,
    enabled: bool,
) {
    let size = match existing.requested_size.as_deref() {
        Some("small") => Some(AgentSize::Small),
        Some("medium") => Some(AgentSize::Medium),
        Some("large") => Some(AgentSize::Large),
        _ => None,
    };
    if let Some(size) = size {
        apply_size_based_parallelism(request, size, enabled);
    }
}

fn largest_unattempted_size(
    capacity: &AgentCapacity,
    attempted: &[AgentSize],
) -> Option<AgentSize> {
    [AgentSize::Large, AgentSize::Medium, AgentSize::Small]
        .into_iter()
        .find(|size| {
            !attempted.contains(size)
                && capacity
                    .slots
                    .get(size.as_str())
                    .is_some_and(|slot| slot.available > 0)
        })
}

fn find_existing_with_capacity(
    client: &HyperCliClient,
    handle: &str,
    public_key: &str,
) -> Result<(Option<Deployment>, AgentCapacity), ProviderError> {
    let mut capacity = client
        .list_deployments_by_handle_with_capacity(handle)
        .map_err(ProviderError::HyperCli)?;
    let deployments = std::mem::take(&mut capacity.items);
    let expected_tag = format!("buzz_agent={public_key}");
    let mut tagged_matches = deployments
        .iter()
        .filter(|deployment| deployment.tags.iter().any(|tag| tag == &expected_tag));
    let tagged_match = tagged_matches.next().cloned();
    if tagged_matches.next().is_some() {
        return Err(ProviderError::AmbiguousDeployment);
    }
    if tagged_match.is_some() {
        return Ok((tagged_match, capacity));
    }
    if deployments.iter().any(|deployment| {
        deployment
            .tags
            .iter()
            .any(|tag| tag.starts_with("buzz_agent="))
    }) {
        return Err(ProviderError::IdentityMismatch);
    }
    if deployments.len() > 1 {
        return Err(ProviderError::AmbiguousDeployment);
    }
    // Backward compatibility for deployments created before the identity tag
    // shipped. New deployments always take the exact tagged path above.
    Ok((deployments.into_iter().next(), capacity))
}

fn mark_launch_fingerprint(request: &mut CreateDeploymentRequest) -> Result<(), ProviderError> {
    request
        .tags
        .retain(|tag| !tag.starts_with(BUZZ_LAUNCH_TAG_PREFIX));
    let mut fingerprint_request = request.clone();
    // This anti-replay nonce must change on each real process start, but it is
    // not user launch intent and therefore must not make an identical deploy
    // look like configuration drift.
    fingerprint_request
        .env
        .remove("BUZZ_MANAGED_AGENT_START_NONCE");
    let encoded = serde_json::to_vec(&fingerprint_request)
        .map_err(|_| ProviderError::LaunchFingerprintEncoding)?;
    let digest = Sha256::digest(encoded);
    let mut fingerprint = String::with_capacity(digest.len() * 2);
    for byte in digest {
        write!(&mut fingerprint, "{byte:02x}")
            .map_err(|_| ProviderError::LaunchFingerprintEncoding)?;
    }
    request
        .tags
        .push(format!("{BUZZ_LAUNCH_TAG_PREFIX}{fingerprint}"));
    Ok(())
}

fn reconcile_existing(
    client: &HyperCliClient,
    deployment: Deployment,
    create: &CreateDeploymentRequest,
) -> Result<Option<Deployment>, ProviderError> {
    let stopped = deployment.state.eq_ignore_ascii_case("stopped");
    let runtime_matches =
        deployment.runtime.is_none() || deployment.runtime == Some(create.runtime);
    let desired_fingerprint = create
        .tags
        .iter()
        .find(|tag| tag.starts_with(BUZZ_LAUNCH_TAG_PREFIX));
    let existing_fingerprint = deployment
        .tags
        .iter()
        .find(|tag| tag.starts_with(BUZZ_LAUNCH_TAG_PREFIX));
    let known_launch_matches = match (desired_fingerprint, existing_fingerprint) {
        (Some(desired), Some(existing)) => desired == existing,
        _ => true,
    };

    if !runtime_matches || !known_launch_matches {
        if !stopped {
            return Err(if runtime_matches {
                ProviderError::LaunchMismatch
            } else {
                ProviderError::RuntimeMismatch
            });
        }
        client
            .delete_deployment(&deployment.id)
            .map_err(ProviderError::HyperCli)?;
        return Ok(None);
    }

    restart_if_stopped(client, deployment, create).map(Some)
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
        sync_include: None,
        sync_exclude: None,
        sync_uid: create.sync_uid,
        sync_gid: create.sync_gid,
        restart: create.restart,
        runtime_scopes: create.runtime_scopes.clone(),
        dry_run: false,
    };
    // The Rust SDK derives the compatibility sync_enabled wire field from
    // sync_root. Keep the include/exclude filters omitted here so a relaunch
    // does not overwrite the backend's stored filter policy.
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
            // `starting` is accepted only as a rollout compatibility alias;
            // canonical deployments progress through DOWNLOADING before
            // RESTORING/SYNCING and then RUNNING.
            "pending" | "downloading" | "restoring" | "syncing" | "starting" => {}
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
    build_launch_request_with_inference_base(
        agent,
        public_key,
        handle,
        options,
        HYPERCLI_ANTHROPIC_BASE_URL,
    )
}

fn build_launch_request_with_inference_base(
    agent: BuzzAgentPayload,
    public_key: &str,
    handle: &str,
    options: ProviderOptions,
    inference_api_base: &str,
) -> Result<CreateDeploymentRequest, ProviderError> {
    if agent.relay_url.trim().is_empty() {
        return Err(ProviderError::MissingRelayUrl);
    }
    let _legacy_provider_selection = (options.runtime, options.size);
    let behavior = validate_behavior(&agent)?;
    let launch_command = match agent.launch.as_ref() {
        Some(launch) => launch
            .command
            .as_deref()
            .ok_or(ProviderError::UnsupportedLaunchCommand)?,
        None => &agent.agent_command,
    };
    let runtime = runtime_from_agent_command(launch_command)
        .ok_or(ProviderError::UnsupportedLaunchCommand)?;
    let display_name = agent.name.trim().to_owned();
    let mut request = CreateDeploymentRequest::new(runtime.managed());
    request.name = Some(deployment_name(&display_name, public_key));
    request.handle = Some(handle.to_owned());
    request.size = None;
    request.image = options
        .image
        .filter(|image| !image.trim().is_empty())
        .or_else(|| {
            COMPILE_TIME_DEFAULT_IMAGE_OVERRIDE
                .filter(|image| !image.trim().is_empty())
                .map(str::to_owned)
        })
        .or_else(|| Some(runtime.default_image().to_owned()));
    request.mark_buzz_deployment(Some(public_key));

    request.command = vec!["/usr/local/bin/buzz-acp".to_owned()];
    request.sync_root = Some("/home/node".to_owned());
    request.sync_include = request
        .runtime
        .default_sync_include()
        .map(|paths| paths.iter().map(|path| (*path).to_owned()).collect());
    request.sync_exclude = None;
    request.sync_uid = Some(1000);
    request.sync_gid = Some(1000);
    request.restart = Some(false);
    request.runtime_scopes = BUZZ_RUNTIME_SCOPES.map(str::to_owned).to_vec();

    // Local Desktop policy is a floor. The fully resolved descriptor env wins
    // over it; legacy env_vars is used only when no launch block exists.
    let mut env = BTreeMap::from([
        (
            "BUZZ_ACP_MULTIPLE_EVENT_HANDLING".to_owned(),
            "steer".to_owned(),
        ),
        ("BUZZ_ACP_DEDUP".to_owned(), "queue".to_owned()),
        (
            "RUST_LOG".to_owned(),
            "buzz_acp=info,pool::prompt=info,acp::stream=off".to_owned(),
        ),
    ]);
    let launch_args = if let Some(launch) = agent.launch.as_ref() {
        env.extend(launch.policy_env.clone());
        env.extend(launch.env.clone());
        launch.args.clone()
    } else {
        env.insert("BUZZ_ACP_LAZY_POOL".to_owned(), "true".to_owned());
        env.insert("BUZZ_ACP_RELAY_OBSERVER".to_owned(), "true".to_owned());
        env.insert("BUZZ_ACP_AGENTS".to_owned(), agent.parallelism.to_string());
        let goose_model = if runtime == CodingRuntime::Goose {
            env.insert("GOOSE_MODE".to_owned(), "auto".to_owned());
            nonempty(agent.model.as_deref()).map(str::to_owned)
        } else {
            None
        };
        let goose_provider = (runtime == CodingRuntime::Goose)
            .then(|| nonempty(agent.provider.as_deref()))
            .flatten()
            .map(str::to_owned);
        insert_nonempty_env(
            &mut env,
            "BUZZ_ACP_SYSTEM_PROMPT",
            agent.system_prompt.as_deref(),
        );
        insert_nonempty_env(&mut env, "BUZZ_ACP_MODEL", agent.model.as_deref());
        if let Some(value) = behavior.idle_timeout_seconds {
            env.insert("BUZZ_ACP_IDLE_TIMEOUT".to_owned(), value.to_string());
        }
        if let Some(value) = behavior.max_turn_duration_seconds {
            env.insert("BUZZ_ACP_MAX_TURN_DURATION".to_owned(), value.to_string());
        }
        insert_nonempty_env(&mut env, "BUZZ_ACP_SESSION_TITLE", Some(&display_name));
        env.extend(agent.env_vars.clone());
        if let Some(model) = goose_model {
            env.insert("GOOSE_MODEL".to_owned(), model);
        }
        if let Some(provider) = goose_provider {
            env.insert("GOOSE_PROVIDER".to_owned(), provider);
        }
        agent.agent_args.clone()
    };

    apply_hypercli_inference_defaults(&mut env, runtime, inference_api_base);

    if launch_args.iter().any(|argument| argument.contains(',')) {
        return Err(ProviderError::InvalidLaunchArguments);
    }
    let parallelism = if agent.launch.is_some() {
        env.get("BUZZ_ACP_AGENTS")
            .map(String::as_str)
            .unwrap_or("1")
            .parse::<u32>()
            .map_err(|_| ProviderError::InvalidParallelism)?
    } else {
        agent.parallelism
    };
    if !(1..=32).contains(&parallelism) {
        return Err(ProviderError::InvalidParallelism);
    }

    for key in env.keys() {
        if !is_posix_env_key(key) {
            return Err(ProviderError::InvalidEnvironmentKey);
        }
        if key.eq_ignore_ascii_case("BUZZ_ACP_NO_PRESENCE") {
            return Err(ProviderError::PresenceSuppression);
        }
    }

    // Desktop/provider-owned values clear both launch tiers before being set.
    env.retain(|key, _| {
        !AUTHORITATIVE_ENV_KEYS
            .iter()
            .any(|owned| key.eq_ignore_ascii_case(owned))
    });
    env.insert(
        "BUZZ_PRIVATE_KEY".to_owned(),
        agent.private_key_nsec.clone(),
    );
    env.insert("NOSTR_PRIVATE_KEY".to_owned(), agent.private_key_nsec);
    env.insert(
        "BUZZ_RELAY_URL".to_owned(),
        agent.relay_url.trim().to_owned(),
    );
    env.insert(
        "BUZZ_MANAGED_AGENT_START_NONCE".to_owned(),
        uuid::Uuid::new_v4().simple().to_string(),
    );
    let auth_tag = nonempty(agent.auth_tag.as_deref());
    if let Some(auth_tag) = auth_tag {
        env.insert("BUZZ_AUTH_TAG".to_owned(), auth_tag.to_owned());
    } else if let Some(owner) = agent
        .launch
        .as_ref()
        .and_then(|launch| launch.owner_pubkey.as_deref())
        .and_then(|owner| nonempty(Some(owner)))
    {
        env.insert("BUZZ_ACP_AGENT_OWNER".to_owned(), owner.to_owned());
    } else {
        return Err(ProviderError::MissingOwner);
    }

    env.insert(
        "BUZZ_ACP_AGENT_COMMAND".to_owned(),
        runtime.harness_command().to_owned(),
    );
    env.insert("BUZZ_ACP_AGENT_ARGS".to_owned(), launch_args.join(","));
    env.insert(
        "BUZZ_ACP_MCP_COMMAND".to_owned(),
        if matches!(runtime, CodingRuntime::BuzzAgent | CodingRuntime::Codex) {
            "/usr/local/bin/buzz-dev-mcp"
        } else {
            ""
        }
        .to_owned(),
    );
    if runtime == CodingRuntime::ClaudeCode {
        env.insert(
            "CLAUDE_CODE_EXECUTABLE".to_owned(),
            "/usr/local/bin/claude".to_owned(),
        );
    }
    if let Some(mode) = behavior.respond_to {
        env.insert("BUZZ_ACP_RESPOND_TO".to_owned(), mode);
    }
    if !behavior.respond_to_allowlist.is_empty() {
        env.insert(
            "BUZZ_ACP_RESPOND_TO_ALLOWLIST".to_owned(),
            behavior.respond_to_allowlist.join(","),
        );
    }
    env.insert("BUZZ_ACP_DISPLAY_NAME".to_owned(), display_name.clone());
    if supports_text_mentions(&display_name) {
        env.insert("BUZZ_ACP_TEXT_MENTIONS".to_owned(), "true".to_owned());
    }
    env.insert("BUZZ_ACP_REQUIRE_REPLY".to_owned(), "true".to_owned());
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

const AUTHORITATIVE_ENV_KEYS: &[&str] = &[
    "BUZZ_PRIVATE_KEY",
    "NOSTR_PRIVATE_KEY",
    "BUZZ_AUTH_TAG",
    "BUZZ_API_TOKEN",
    "BUZZ_ACP_PRIVATE_KEY",
    "BUZZ_ACP_API_TOKEN",
    "BUZZ_RELAY_URL",
    "BUZZ_ACP_AGENT_OWNER",
    "BUZZ_ACP_AGENT_COMMAND",
    "BUZZ_ACP_AGENT_ARGS",
    "BUZZ_ACP_MCP_COMMAND",
    "BUZZ_ACP_RESPOND_TO",
    "BUZZ_ACP_RESPOND_TO_ALLOWLIST",
    "BUZZ_ACP_EXIT_AFTER_INACTIVITY",
    "BUZZ_ACP_SETUP_PAYLOAD",
    "BUZZ_MANAGED_AGENT",
    "BUZZ_MANAGED_AGENT_START_NONCE",
    "BUZZ_ACP_DISPLAY_NAME",
    "BUZZ_ACP_TEXT_MENTIONS",
    "BUZZ_ACP_REQUIRE_REPLY",
    "CLAUDE_CODE_EXECUTABLE",
    "HYPER_WORKSPACES_BOOT_SYNC",
    "HYPER_WORKSPACES_DIR",
    "HYPER_WORKSPACES_SYNC_READY_ONLY",
    "HYPER_WORKSPACES_SYNC_WORKSPACE",
];

fn insert_nonempty_env(env: &mut BTreeMap<String, String>, key: &str, value: Option<&str>) {
    if let Some(value) = nonempty(value) {
        env.insert(key.to_owned(), value.to_owned());
    }
}

fn is_posix_env_key(key: &str) -> bool {
    let mut chars = key.chars();
    matches!(chars.next(), Some(character) if character == '_' || character.is_ascii_alphabetic())
        && chars.all(|character| character == '_' || character.is_ascii_alphanumeric())
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

    let (idle_timeout_seconds, max_turn_duration_seconds) = if agent.launch.is_some() {
        // The launch block already contains Desktop's resolved policy. Legacy
        // top-level timeout fields are bookkeeping and must not revalidate it.
        (None, None)
    } else {
        let idle = agent
            .idle_timeout_seconds
            .or(agent.turn_timeout_seconds)
            .map(|value| value.max(1));
        let max = agent
            .max_turn_duration_seconds
            .map(|value| if value == 0 { 60 } else { value });
        let effective_idle = idle.unwrap_or(DEFAULT_IDLE_TIMEOUT_SECONDS);
        let effective_max = max.unwrap_or(DEFAULT_MAX_TURN_DURATION_SECONDS);
        if effective_max > MAX_TURN_DURATION_CEILING_SECONDS || effective_idle >= effective_max {
            return Err(ProviderError::InvalidTimeoutConfiguration);
        }
        (idle, max)
    };

    let respond_to = agent
        .respond_to
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if respond_to.is_some_and(|value| !matches!(value, "owner-only" | "allowlist" | "anyone")) {
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

fn supports_text_mentions(display_name: &str) -> bool {
    let display_name = display_name.trim();
    !display_name.is_empty()
        && display_name.chars().count() <= 80
        && !display_name.contains('@')
        && !display_name.chars().any(char::is_control)
}

/// Provider ids `buzz-agent` accepts; anything else aborts the harness at
/// startup with `BUZZ_AGENT_PROVIDER=<id> not supported`.
const BUZZ_AGENT_NATIVE_PROVIDERS: [&str; 7] = [
    "anthropic",
    "openai",
    "openai-compat",
    "databricks",
    "databricks_v2",
    "databricks-v2",
    "openrouter",
];

/// Anthropic Messages base for HyperCLI inference. Deliberately has no
/// `/v1`: buzz-agent appends `/v1/messages` itself, and an unset value
/// silently defaults to `api.anthropic.com` — i.e. our key would go to the
/// wrong vendor.
#[cfg(test)]
const HYPERCLI_ANTHROPIC_BASE_URL: &str = "https://api.hypercli.com";

/// Translate the vendor-neutral `hypercli` selection Buzz Desktop sends into
/// each harness's own dialect.
///
/// Buzz has no notion of what `hypercli` means: it copies the user's
/// provider string verbatim into the harness's provider env var, and its own
/// readiness check passes unknown ids through. Only this provider knows how
/// to resolve it, and every harness resolves it differently:
///
/// * `buzz-agent` validates the id against a fixed list and exits otherwise,
///   so `hypercli` must be rewritten (its image entrypoint defaults the same
///   values, but only when the variable is *unset* — which Buzz never leaves
///   it).
/// * `goose` ships a declarative custom provider named `hypercli` in its
///   image, so the id is already valid and must not be touched.
/// * `opencode` names models `<provider>/<model>`; a bare id never matches
///   its advertised options, so the model switch silently no-ops.
/// * `claude-code`, `codex`, and `kimi` take no provider from Buzz at all;
///   `hypercli-buzz-acp` derives their native child env at spawn time from
///   Lagoon's short-lived `HYPER_*` environment.
///
/// User-supplied values always win: nothing here overwrites an explicit
/// setting except a provider id the harness would reject outright.
fn apply_hypercli_inference_defaults(
    env: &mut BTreeMap<String, String>,
    runtime: CodingRuntime,
    inference_api_base: &str,
) {
    let inference_api_base = inference_api_base.trim_end_matches('/');
    match runtime {
        CodingRuntime::BuzzAgent => {
            let native = env
                .get("BUZZ_AGENT_PROVIDER")
                .map(|raw| {
                    let raw = raw.trim().to_ascii_lowercase();
                    BUZZ_AGENT_NATIVE_PROVIDERS.contains(&raw.as_str())
                })
                .unwrap_or(false);
            if !native {
                env.insert("BUZZ_AGENT_PROVIDER".to_owned(), "anthropic".to_owned());
                // Forced, not defaulted: the harness falls back to
                // api.anthropic.com when this is absent.
                env.insert(
                    "ANTHROPIC_BASE_URL".to_owned(),
                    inference_api_base.to_owned(),
                );
            }
        }
        CodingRuntime::Goose => {
            // `hypercli` is a real provider inside the goose image. Only
            // fill it in when Buzz sent nothing at all.
            env.entry("GOOSE_PROVIDER".to_owned())
                .or_insert_with(|| "hypercli".to_owned());
        }
        CodingRuntime::Opencode => {
            // Qualify the model so opencode's `<provider>/<model>` option
            // values match and the switch actually applies.
            if let Some(model) = env.get("BUZZ_ACP_MODEL").cloned() {
                let model = model.trim().to_owned();
                if !model.is_empty() && !model.contains('/') {
                    env.insert("BUZZ_ACP_MODEL".to_owned(), format!("hypercli/{model}"));
                }
            }
        }
        // These runtimes receive their provider config at the ACP child-spawn
        // boundary; Buzz sends them no provider id to translate here.
        CodingRuntime::ClaudeCode | CodingRuntime::Codex | CodingRuntime::KimiCode => {}
    }
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
    canonical_deployment_name(display_name, public_key)
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

/// Resolve the optional provider-specific API base before constructing the
/// control-plane client. This is intentionally non-secret schema data: auth
/// continues to come from the installed HyperCLI credential/configuration.
pub fn provider_api_base(value: &Value) -> Result<Option<Url>, ProviderError> {
    validate_provider_config(value)?;
    let options: ProviderOptions = serde_json::from_value(value.clone())
        .map_err(|_| ProviderError::UnsupportedProviderConfig)?;
    provider_api_base_from_options(&options)
}

fn provider_api_base_from_options(options: &ProviderOptions) -> Result<Option<Url>, ProviderError> {
    options
        .api_base
        .as_deref()
        .and_then(|value| nonempty(Some(value)))
        .map(hypercli_sdk::normalize_agents_api_base)
        .transpose()
        .map_err(|_| ProviderError::InvalidProviderApiBase)
}

fn product_api_base_from_agents_url(api_base: &Url) -> String {
    let base = api_base.as_str().trim_end_matches('/');
    base.strip_suffix("/agents").unwrap_or(base).to_owned()
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

    fn buzz_nonce_rule() -> serde_json::Value {
        let golden: serde_json::Value = serde_json::from_str(include_str!(
            "../../tests/fixtures/buzz-launch-contract.json"
        ))
        .unwrap();
        golden["dynamic_env"]["BUZZ_MANAGED_AGENT_START_NONCE"].clone()
    }
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
            launch: None,
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

    fn test_options() -> ProviderOptions {
        ProviderOptions {
            runtime: CodingRuntime::Opencode,
            size: AgentSize::Large,
            image: None,
            workspace: None,
            api_base: None,
        }
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
    fn unspecified_parallelism_uses_memory_tier_defaults() {
        for (size, expected) in [
            (AgentSize::Small, "2"),
            (AgentSize::Medium, "5"),
            (AgentSize::Large, "10"),
        ] {
            let mut request = CreateDeploymentRequest::new(ManagedRuntime::Opencode);
            apply_size_based_parallelism(&mut request, size, true);
            assert_eq!(request.env["BUZZ_ACP_AGENTS"], expected);
        }
    }

    #[test]
    fn concrete_parallelism_is_never_reinterpreted_as_auto() {
        for concrete in ["1", "7", "10"] {
            let mut request = CreateDeploymentRequest::new(ManagedRuntime::Opencode);
            request
                .env
                .insert("BUZZ_ACP_AGENTS".to_owned(), concrete.to_owned());
            apply_size_based_parallelism(&mut request, AgentSize::Large, false);
            assert_eq!(request.env["BUZZ_ACP_AGENTS"], concrete);
        }
    }

    #[test]
    fn request_id_is_ignored_one_shot_metadata() {
        let info: ProviderRequest = serde_json::from_value(serde_json::json!({
            "op": "info",
            "request_id": {"future": "metadata"}
        }))
        .unwrap();
        assert!(matches!(info, ProviderRequest::Info));

        let deploy: ProviderRequest = serde_json::from_value(serde_json::json!({
            "op": "deploy",
            "request_id": ["future", "metadata"],
            "agent": {
                "name": "Fizz",
                "relay_url": "wss://relay.example",
                "private_key_nsec": TEST_SECRET_HEX,
                "agent_command": "opencode"
            }
        }))
        .unwrap();
        assert!(matches!(deploy, ProviderRequest::Deploy { .. }));
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
    fn provider_api_base_is_optional_normalized_and_non_secret() {
        assert_eq!(provider_api_base(&serde_json::json!({})).unwrap(), None);
        assert_eq!(
            provider_api_base(&serde_json::json!({"api_base": "  "})).unwrap(),
            None
        );
        assert_eq!(
            provider_api_base(&serde_json::json!({
                "api_base": "https://self-hosted.example/api"
            }))
            .unwrap()
            .unwrap()
            .as_str(),
            "https://self-hosted.example/agents"
        );
        assert!(matches!(
            provider_api_base(&serde_json::json!({"api_base": "file:///tmp/api"})),
            Err(ProviderError::InvalidProviderApiBase)
        ));
    }

    #[test]
    fn runtime_catalog_uses_distinct_buzz_images() {
        for (runtime, managed) in [
            (CodingRuntime::BuzzAgent, ManagedRuntime::BuzzAgent),
            (CodingRuntime::Opencode, ManagedRuntime::Opencode),
            (CodingRuntime::Codex, ManagedRuntime::Codex),
            (CodingRuntime::ClaudeCode, ManagedRuntime::ClaudeCode),
            (CodingRuntime::Goose, ManagedRuntime::Goose),
            (CodingRuntime::KimiCode, ManagedRuntime::KimiCode),
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
                    api_base: None,
                },
            )
            .unwrap();
            assert_eq!(request.runtime, managed);
            assert_eq!(request.image.as_deref(), managed.default_buzz_image());
        }
    }

    #[test]
    fn portable_agent_command_names_resolve_to_canonical_runtimes() {
        for (command, expected) in [
            ("buzz-agent", CodingRuntime::BuzzAgent),
            ("opencode", CodingRuntime::Opencode),
            ("codex-acp", CodingRuntime::Codex),
            ("claude-agent-acp", CodingRuntime::ClaudeCode),
            ("claude-code-acp", CodingRuntime::ClaudeCode),
            ("goose", CodingRuntime::Goose),
            ("kimi", CodingRuntime::KimiCode),
        ] {
            for candidate in [
                command.to_owned(),
                format!("/usr/local/bin/{command}"),
                format!(r"C:\\Users\\tester\\.local\\bin\\{command}.exe"),
                format!(r"C:\\Users\\tester\\.local\\bin\\{command}.Exe"),
                format!(r"C:\\Users\\tester\\.local\\bin\\{command}.EXE"),
            ] {
                assert_eq!(
                    runtime_from_agent_command(&candidate),
                    Some(expected),
                    "agent command {candidate:?} selected the wrong runtime"
                );
            }
        }
    }

    #[test]
    fn goose_structured_model_and_provider_override_legacy_environment() {
        let mut agent = test_agent_for(CodingRuntime::Goose);
        agent.model = Some("structured-model".to_owned());
        agent.provider = Some("structured-provider".to_owned());
        agent
            .env_vars
            .insert("GOOSE_MODEL".to_owned(), "stale-model".to_owned());
        agent
            .env_vars
            .insert("GOOSE_PROVIDER".to_owned(), "stale-provider".to_owned());

        let request = build_launch_request(
            agent,
            TEST_PUBLIC_HEX,
            "buzz-runtime-test",
            ProviderOptions {
                runtime: CodingRuntime::Goose,
                size: AgentSize::Large,
                image: None,
                workspace: None,
                api_base: None,
            },
        )
        .unwrap();

        assert_eq!(request.env["GOOSE_MODEL"], "structured-model");
        assert_eq!(request.env["GOOSE_PROVIDER"], "structured-provider");
    }

    /// Buzz always sends a launch block; these mirror the real payloads
    /// captured from Buzz Desktop 0.5.4 (`launch.command` + `launch.env`
    /// carrying the user's provider/model selection).
    fn agent_with_launch(runtime: CodingRuntime, env: &[(&str, &str)]) -> BuzzAgentPayload {
        let mut agent = test_agent_for(runtime);
        agent.launch = Some(BuzzLaunchBlock {
            command: Some(
                runtime
                    .harness_command()
                    .rsplit('/')
                    .next()
                    .unwrap()
                    .to_owned(),
            ),
            args: Vec::new(),
            env: env
                .iter()
                .map(|(key, value)| ((*key).to_owned(), (*value).to_owned()))
                .collect(),
            policy_env: BTreeMap::new(),
            owner_pubkey: None,
        });
        agent
    }

    fn launch_env(runtime: CodingRuntime, env: &[(&str, &str)]) -> BTreeMap<String, String> {
        build_launch_request(
            agent_with_launch(runtime, env),
            TEST_PUBLIC_HEX,
            "buzz-runtime-test",
            ProviderOptions {
                runtime,
                size: AgentSize::Large,
                image: None,
                workspace: None,
                api_base: None,
            },
        )
        .unwrap()
        .env
    }

    #[test]
    fn buzz_agent_rewrites_unknown_provider_and_forces_anthropic_base_url() {
        // `hypercli` is not a provider id buzz-agent accepts; left as-is the
        // harness exits with "BUZZ_AGENT_PROVIDER=hypercli not supported".
        let env = launch_env(
            CodingRuntime::BuzzAgent,
            &[
                ("BUZZ_AGENT_PROVIDER", "hypercli"),
                ("BUZZ_AGENT_MODEL", "kimi-k2.6-anthropic"),
            ],
        );

        assert_eq!(env["BUZZ_AGENT_PROVIDER"], "anthropic");
        // Forced, not defaulted: unset silently routes to api.anthropic.com.
        assert_eq!(env["ANTHROPIC_BASE_URL"], HYPERCLI_ANTHROPIC_BASE_URL);
        assert!(!env["ANTHROPIC_BASE_URL"].ends_with("/v1"));
        // The user's model selection is never overwritten.
        assert_eq!(env["BUZZ_AGENT_MODEL"], "kimi-k2.6-anthropic");
    }

    #[test]
    fn buzz_agent_preserves_a_provider_the_harness_accepts() {
        let env = launch_env(
            CodingRuntime::BuzzAgent,
            &[
                ("BUZZ_AGENT_PROVIDER", "openrouter"),
                ("OPENROUTER_API_KEY", "user-supplied"),
            ],
        );

        assert_eq!(env["BUZZ_AGENT_PROVIDER"], "openrouter");
        assert!(!env.contains_key("ANTHROPIC_BASE_URL"));
    }

    #[test]
    fn goose_keeps_the_hypercli_provider_its_image_defines() {
        // The goose image ships custom_providers/hypercli.json, so the id is
        // valid there and must survive untouched.
        let env = launch_env(CodingRuntime::Goose, &[("GOOSE_PROVIDER", "hypercli")]);
        assert_eq!(env["GOOSE_PROVIDER"], "hypercli");
    }

    #[test]
    fn goose_defaults_the_provider_only_when_buzz_sends_none() {
        let defaulted = launch_env(CodingRuntime::Goose, &[]);
        assert_eq!(defaulted["GOOSE_PROVIDER"], "hypercli");

        let explicit = launch_env(CodingRuntime::Goose, &[("GOOSE_PROVIDER", "anthropic")]);
        assert_eq!(explicit["GOOSE_PROVIDER"], "anthropic");
    }

    #[test]
    fn opencode_model_is_qualified_so_the_switch_matches() {
        // opencode advertises `<provider>/<model>`; a bare id never matches
        // and the model switch silently no-ops.
        let env = launch_env(
            CodingRuntime::Opencode,
            &[("BUZZ_ACP_MODEL", "kimi-k2.6-anthropic")],
        );
        assert_eq!(env["BUZZ_ACP_MODEL"], "hypercli/kimi-k2.6-anthropic");

        let already = launch_env(
            CodingRuntime::Opencode,
            &[("BUZZ_ACP_MODEL", "someprovider/some-model")],
        );
        assert_eq!(already["BUZZ_ACP_MODEL"], "someprovider/some-model");
    }

    #[test]
    fn acp_injected_runtimes_take_no_provider_wire_injection() {
        // Buzz locks the provider for claude and drops it for kimi presets;
        // their inference config lives in the image.
        for runtime in [
            CodingRuntime::ClaudeCode,
            CodingRuntime::Codex,
            CodingRuntime::KimiCode,
        ] {
            let env = launch_env(runtime, &[("BUZZ_ACP_MODEL", "kimi-k2.6-anthropic")]);
            assert!(!env.contains_key("BUZZ_AGENT_PROVIDER"));
            assert!(!env.contains_key("ANTHROPIC_BASE_URL"));
            assert_eq!(env["BUZZ_ACP_MODEL"], "kimi-k2.6-anthropic");
        }
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
                api_base: None,
            },
        )
        .unwrap();

        assert_eq!(request.env["BUZZ_ACP_IDLE_TIMEOUT"], "320");
        assert_eq!(request.env["BUZZ_ACP_RESPOND_TO"], "allowlist");
        assert_eq!(request.env["BUZZ_ACP_RESPOND_TO_ALLOWLIST"], "a".repeat(64));
    }

    #[test]
    fn portable_launch_uses_desktop_precedence_and_authoritative_security() {
        let mut agent = test_agent();
        agent
            .env_vars
            .insert("LEGACY_ONLY".into(), "ignored".into());
        agent.launch = Some(BuzzLaunchBlock {
            command: Some("/host/bin/goose".into()),
            args: vec!["acp".into(), "--profile".into(), "hosted".into()],
            policy_env: BTreeMap::from([
                ("TIER".into(), "policy".into()),
                ("BUZZ_ACP_MODEL".into(), "policy-model".into()),
            ]),
            env: BTreeMap::from([
                ("TIER".into(), "launch".into()),
                ("BUZZ_ACP_MODEL".into(), "launch-model".into()),
                ("BUZZ_PRIVATE_KEY".into(), "forged".into()),
                ("buzz_auth_tag".into(), "mixed-case-forgery".into()),
                ("BUZZ_MANAGED_AGENT".into(), "forged".into()),
                ("BUZZ_MANAGED_AGENT_START_NONCE".into(), "forged".into()),
                ("HYPER_WORKSPACES_DIR".into(), "/tmp/forged".into()),
            ]),
            owner_pubkey: Some("b".repeat(64)),
        });

        let request =
            build_launch_request(agent, TEST_PUBLIC_HEX, "buzz-runtime-test", test_options())
                .unwrap();

        assert_eq!(request.runtime, ManagedRuntime::Goose);
        assert_eq!(request.restart, Some(false));
        assert_eq!(request.env["TIER"], "launch");
        assert_eq!(request.env["BUZZ_ACP_MODEL"], "launch-model");
        assert_eq!(request.env["BUZZ_PRIVATE_KEY"], TEST_SECRET_HEX);
        assert_eq!(request.env["BUZZ_AUTH_TAG"], "[\"auth\",\"tag\"]");
        assert!(!request.env.contains_key("buzz_auth_tag"));
        assert!(!request.env.contains_key("BUZZ_ACP_AGENT_OWNER"));
        assert!(!request.env.contains_key("BUZZ_MANAGED_AGENT"));
        assert_eq!(
            buzz_nonce_rule(),
            serde_json::json!({
                "format": "lowercase-hex",
                "length": 32,
                "fresh_per_launch": true
            })
        );
        let start_nonce = &request.env["BUZZ_MANAGED_AGENT_START_NONCE"];
        assert_eq!(
            start_nonce.len(),
            buzz_nonce_rule()["length"].as_u64().unwrap() as usize
        );
        assert!(start_nonce
            .chars()
            .all(|character| character.is_ascii_hexdigit()));
        assert_ne!(start_nonce, "forged");
        assert!(!request.env.contains_key("LEGACY_ONLY"));
        assert_eq!(
            request.env["BUZZ_ACP_AGENT_COMMAND"],
            "/usr/local/bin/goose"
        );
        assert_eq!(request.env["BUZZ_ACP_AGENT_ARGS"], "acp,--profile,hosted");
        assert_eq!(request.env["BUZZ_ACP_MCP_COMMAND"], "");
        assert_eq!(request.env["HYPER_WORKSPACES_DIR"], "/home/node/workspaces");
    }

    #[test]
    fn each_launch_attempt_gets_a_fresh_start_nonce() {
        let first = build_launch_request(
            test_agent(),
            TEST_PUBLIC_HEX,
            "buzz-runtime-test",
            test_options(),
        )
        .unwrap();
        let second = build_launch_request(
            test_agent(),
            TEST_PUBLIC_HEX,
            "buzz-runtime-test",
            test_options(),
        )
        .unwrap();

        assert_ne!(
            first.env["BUZZ_MANAGED_AGENT_START_NONCE"],
            second.env["BUZZ_MANAGED_AGENT_START_NONCE"]
        );
    }

    #[test]
    fn portable_launch_validates_resolved_parallelism_not_stale_legacy_value() {
        let mut agent = test_agent();
        agent.parallelism = 99;
        agent.launch = Some(BuzzLaunchBlock {
            command: Some("opencode".to_owned()),
            args: vec!["acp".to_owned()],
            policy_env: BTreeMap::from([("BUZZ_ACP_AGENTS".to_owned(), "4".to_owned())]),
            env: BTreeMap::from([("BUZZ_ACP_AGENTS".to_owned(), "7".to_owned())]),
            owner_pubkey: Some("a".repeat(64)),
        });

        let request =
            build_launch_request(agent, TEST_PUBLIC_HEX, "buzz-runtime-test", test_options())
                .unwrap();
        assert_eq!(request.env["BUZZ_ACP_AGENTS"], "7");

        for invalid in ["0", "33", "not-a-number"] {
            let mut agent = test_agent();
            agent.launch = Some(BuzzLaunchBlock {
                command: Some("opencode".to_owned()),
                args: vec!["acp".to_owned()],
                policy_env: BTreeMap::new(),
                env: BTreeMap::from([("BUZZ_ACP_AGENTS".to_owned(), invalid.to_owned())]),
                owner_pubkey: Some("a".repeat(64)),
            });
            assert!(matches!(
                build_launch_request(agent, TEST_PUBLIC_HEX, "buzz-runtime-test", test_options()),
                Err(ProviderError::InvalidParallelism)
            ));
        }

        let mut legacy = test_agent();
        legacy.parallelism = 0;
        assert!(matches!(
            build_launch_request(legacy, TEST_PUBLIC_HEX, "buzz-runtime-test", test_options()),
            Err(ProviderError::InvalidParallelism)
        ));
    }

    #[test]
    fn portable_launch_rejects_unrepresentable_comma_arguments() {
        let mut agent = test_agent();
        agent.launch = Some(BuzzLaunchBlock {
            command: Some(r"C:\\host\\opencode.Exe".to_owned()),
            args: vec!["acp".to_owned(), "value,split".to_owned()],
            policy_env: BTreeMap::new(),
            env: BTreeMap::new(),
            owner_pubkey: Some("a".repeat(64)),
        });

        assert!(matches!(
            build_launch_request(agent, TEST_PUBLIC_HEX, "buzz-runtime-test", test_options()),
            Err(ProviderError::InvalidLaunchArguments)
        ));
    }

    #[test]
    fn portable_launch_uses_owner_only_as_legacy_auth_fallback() {
        let mut agent = test_agent();
        agent.auth_tag = None;
        agent.launch = Some(BuzzLaunchBlock {
            command: Some("codex-acp".into()),
            args: Vec::new(),
            env: BTreeMap::new(),
            policy_env: BTreeMap::new(),
            owner_pubkey: Some("A".repeat(64)),
        });
        let request =
            build_launch_request(agent, TEST_PUBLIC_HEX, "buzz-runtime-test", test_options())
                .unwrap();
        assert!(!request.env.contains_key("BUZZ_AUTH_TAG"));
        assert_eq!(request.env["BUZZ_ACP_AGENT_OWNER"], "A".repeat(64));
        assert_eq!(request.env["BUZZ_ACP_AGENT_ARGS"], "");
        assert_eq!(
            request.env["BUZZ_ACP_MCP_COMMAND"],
            "/usr/local/bin/buzz-dev-mcp"
        );
    }

    #[test]
    fn rejects_behavior_that_stock_buzz_cannot_launch() {
        let options = || ProviderOptions {
            runtime: CodingRuntime::Opencode,
            size: AgentSize::Large,
            image: None,
            workspace: None,
            api_base: None,
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
        assert!(matches!(
            build_launch_request(nobody, TEST_PUBLIC_HEX, "buzz-runtime-test", options()),
            Err(ProviderError::InvalidRespondTo)
        ));

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
                CodingRuntime::BuzzAgent,
                "/usr/local/bin/buzz-agent",
                "",
                BUZZ_DEV_MCP_COMMAND,
            ),
            (
                CodingRuntime::Opencode,
                "/usr/local/bin/opencode",
                "acp",
                "",
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
                ("BUZZ_ACP_DISPLAY_NAME".to_owned(), "Wrong".to_owned()),
                ("BUZZ_ACP_TEXT_MENTIONS".to_owned(), "false".to_owned()),
                ("BUZZ_ACP_REQUIRE_REPLY".to_owned(), "false".to_owned()),
                (
                    "cLaUdE_cOdE_eXeCuTaBlE".to_owned(),
                    "/tmp/not-claude".to_owned(),
                ),
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
                    api_base: None,
                },
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
            assert_eq!(request.env["BUZZ_ACP_LAZY_POOL"], "false");
            assert_eq!(request.env["BUZZ_ACP_RELAY_OBSERVER"], "false");
            assert_eq!(request.env["BUZZ_ACP_DISPLAY_NAME"], "Fizz 4");
            assert_eq!(request.env["BUZZ_ACP_TEXT_MENTIONS"], "true");
            assert_eq!(request.env["BUZZ_ACP_REQUIRE_REPLY"], "true");
            if runtime == CodingRuntime::ClaudeCode {
                assert_eq!(
                    request.env["CLAUDE_CODE_EXECUTABLE"],
                    "/usr/local/bin/claude"
                );
            } else {
                assert!(!request.env.contains_key("CLAUDE_CODE_EXECUTABLE"));
            }
            assert!(!request.env.contains_key("cLaUdE_cOdE_eXeCuTaBlE"));
            assert_eq!(request.env["BUZZ_ACP_SESSION_TITLE"], "Wrong");
            assert_eq!(request.env["BUZZ_ACP_MULTIPLE_EVENT_HANDLING"], "queue");
            assert_eq!(request.env["BUZZ_ACP_DEDUP"], "drop");
            assert_eq!(request.env["HYPER_WORKSPACES_DIR"], "/home/node/workspaces");
            assert_eq!(
                request.env["RUST_LOG"],
                "buzz_acp=info,pool::prompt=info,acp::stream=off"
            );
        }
    }

    #[test]
    fn incompatible_display_names_disable_textual_mentions_without_blocking_launch() {
        for name in [
            "Agent@Home".to_owned(),
            "Agent\nHome".to_owned(),
            "x".repeat(81),
        ] {
            let mut agent = test_agent();
            agent.name = name.clone();
            agent
                .env_vars
                .insert("BUZZ_ACP_TEXT_MENTIONS".to_owned(), "true".to_owned());

            let request =
                build_launch_request(agent, TEST_PUBLIC_HEX, "buzz-runtime-test", test_options())
                    .unwrap();

            assert_eq!(
                request.env.get("BUZZ_ACP_DISPLAY_NAME").map(String::as_str),
                Some(name.as_str())
            );
            assert!(!request.env.contains_key("BUZZ_ACP_TEXT_MENTIONS"));
        }
    }

    #[test]
    fn textual_mentions_accept_eighty_character_display_names() {
        let mut agent = test_agent();
        agent.name = "x".repeat(80);

        let request =
            build_launch_request(agent, TEST_PUBLIC_HEX, "buzz-runtime-test", test_options())
                .unwrap();

        assert_eq!(request.env["BUZZ_ACP_TEXT_MENTIONS"], "true");
    }

    #[test]
    fn portable_launch_command_is_authoritative_over_legacy_config() {
        let mut agent = test_agent();
        agent.launch = Some(BuzzLaunchBlock {
            command: Some("/host/path/codex-acp".to_owned()),
            args: Vec::new(),
            env: BTreeMap::new(),
            policy_env: BTreeMap::new(),
            owner_pubkey: Some("a".repeat(64)),
        });
        let request = build_launch_request(
            agent,
            TEST_PUBLIC_HEX,
            "buzz-runtime-test",
            ProviderOptions {
                runtime: CodingRuntime::Codex,
                size: AgentSize::Large,
                image: None,
                workspace: None,
                api_base: None,
            },
        )
        .unwrap();
        assert_eq!(request.runtime, ManagedRuntime::Codex);
        assert_eq!(request.size, None);
    }

    #[test]
    fn portable_launch_without_command_does_not_fall_back_to_legacy_command() {
        let mut agent = test_agent();
        agent.launch = Some(BuzzLaunchBlock {
            command: None,
            args: Vec::new(),
            env: BTreeMap::new(),
            policy_env: BTreeMap::new(),
            owner_pubkey: Some("a".repeat(64)),
        });

        assert!(matches!(
            build_launch_request(agent, TEST_PUBLIC_HEX, "buzz-runtime-test", test_options()),
            Err(ProviderError::UnsupportedLaunchCommand)
        ));
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
                api_base: None,
            },
        )
        .unwrap();
        assert_eq!(request.env["RUST_LOG"], "warn,pool::prompt=debug");
    }

    #[test]
    fn launch_fingerprint_is_stable_and_covers_runtime_environment() {
        let mut first = build_launch_request(
            test_agent(),
            TEST_PUBLIC_HEX,
            "buzz-runtime-test",
            test_options(),
        )
        .unwrap();
        let mut identical = build_launch_request(
            test_agent(),
            TEST_PUBLIC_HEX,
            "buzz-runtime-test",
            test_options(),
        )
        .unwrap();
        assert_ne!(
            first.env.get("BUZZ_MANAGED_AGENT_START_NONCE"),
            identical.env.get("BUZZ_MANAGED_AGENT_START_NONCE")
        );
        mark_launch_fingerprint(&mut first).unwrap();
        mark_launch_fingerprint(&mut identical).unwrap();
        let first_tag = first
            .tags
            .iter()
            .find(|tag| tag.starts_with(BUZZ_LAUNCH_TAG_PREFIX))
            .unwrap();
        let identical_tag = identical
            .tags
            .iter()
            .find(|tag| tag.starts_with(BUZZ_LAUNCH_TAG_PREFIX))
            .unwrap();
        assert_eq!(first_tag, identical_tag);

        identical
            .env
            .insert("BUZZ_ACP_MODEL".into(), "different-model".into());
        mark_launch_fingerprint(&mut identical).unwrap();
        let changed_tag = identical
            .tags
            .iter()
            .find(|tag| tag.starts_with(BUZZ_LAUNCH_TAG_PREFIX))
            .unwrap();
        assert_ne!(first_tag, changed_tag);
    }

    #[test]
    fn existing_lookup_uses_exact_buzz_identity_tag_not_list_order() {
        let mut server = Server::new();
        let handle = format!("buzz-{}", &TEST_PUBLIC_HEX[..48]);
        let lookup = server
            .mock("GET", "/agents/deployments")
            .match_query(Matcher::UrlEncoded("handle".into(), handle.clone()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "items": [
                        {
                            "id":"wrong-first",
                            "handle":handle,
                            "runtime":"opencode",
                            "state":"stopped",
                            "tags":["app=buzz",format!("buzz_agent={}", "a".repeat(64))]
                        },
                        {
                            "id":"right-second",
                            "handle":handle,
                            "runtime":"opencode",
                            "state":"stopped",
                            "tags":["app=buzz",format!("buzz_agent={TEST_PUBLIC_HEX}")]
                        }
                    ]
                })
                .to_string(),
            )
            .create();

        let (existing, _) =
            find_existing_with_capacity(&client(&server), &handle, TEST_PUBLIC_HEX).unwrap();

        assert_eq!(existing.unwrap().id, "right-second");
        lookup.assert();
    }

    #[test]
    fn existing_lookup_refuses_a_conflicting_buzz_identity_tag() {
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
                        "id":"wrong-agent",
                        "handle":handle,
                        "runtime":"opencode",
                        "state":"stopped",
                        "tags":["app=buzz",format!("buzz_agent={}", "a".repeat(64))]
                    }]
                })
                .to_string(),
            )
            .create();

        let error =
            find_existing_with_capacity(&client(&server), &handle, TEST_PUBLIC_HEX).unwrap_err();

        assert!(matches!(error, ProviderError::IdentityMismatch));
        lookup.assert();
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
            .with_body(r#"{"items":[],"slots":{"large":{"available":1}}}"#)
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
                    "tags": ["app=buzz", format!("buzz_agent={TEST_PUBLIC_HEX}")],
                    "env": {
                        "BUZZ_RELAY_URL": "wss://buzz.example.com",
                        "BUZZ_PRIVATE_KEY": TEST_SECRET_HEX,
                        "NOSTR_PRIVATE_KEY": TEST_SECRET_HEX,
                        "BUZZ_AUTH_TAG": "[\"auth\",\"tag\"]",
                        "BUZZ_ACP_AGENT_COMMAND": "/usr/local/bin/opencode",
                        "BUZZ_ACP_AGENT_ARGS": "acp",
                        "BUZZ_ACP_MCP_COMMAND": "",
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
    fn deploy_refreshes_capacity_and_falls_back_after_large_slot_race() {
        let mut server = Server::new();
        let handle = format!("buzz-{}", &TEST_PUBLIC_HEX[..48]);
        let initial_capacity = server
            .mock("GET", "/agents/deployments")
            .match_query(Matcher::UrlEncoded("handle".into(), handle.clone()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                r#"{"items":[],"slots":{"large":{"available":1},"medium":{"available":1},"small":{"available":1}}}"#,
            )
            .expect(1)
            .create();
        let raced_large = server
            .mock("POST", "/agents/deployments")
            .match_body(Matcher::PartialJsonString(
                serde_json::json!({"size": "large"}).to_string(),
            ))
            .with_status(429)
            .with_header("content-type", "application/json")
            .with_body(r#"{"detail":"large slot is no longer available"}"#)
            .expect(1)
            .create();
        let refreshed_capacity = server
            .mock("GET", "/agents/deployments")
            .match_query(Matcher::UrlEncoded("handle".into(), handle.clone()))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                r#"{"items":[],"slots":{"large":{"available":0},"medium":{"available":1},"small":{"available":1}}}"#,
            )
            .expect(1)
            .create();
        let medium_create = server
            .mock("POST", "/agents/deployments")
            .match_body(Matcher::PartialJsonString(
                serde_json::json!({"size": "medium"}).to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id": "deployment-medium",
                    "handle": handle,
                    "runtime": "opencode",
                    "state": "pending"
                })
                .to_string(),
            )
            .expect(1)
            .create();
        let ready = server
            .mock("GET", "/agents/deployments/deployment-medium")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id": "deployment-medium",
                    "handle": handle,
                    "runtime": "opencode",
                    "state": "running"
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

        assert_eq!(response.agent_id, "deployment-medium");
        initial_capacity.assert();
        raced_large.assert();
        refreshed_capacity.assert();
        medium_create.assert();
        ready.assert();
    }

    #[test]
    fn deploy_restarts_stopped_agent_with_buzz_restart_policy() {
        let mut server = Server::new();
        let handle = format!("buzz-{}", &TEST_PUBLIC_HEX[..48]);
        let mut portable_agent = test_agent();
        portable_agent.launch = Some(BuzzLaunchBlock {
            command: Some("opencode".into()),
            args: vec!["acp".into()],
            policy_env: BTreeMap::from([("PORTABLE_TIER".into(), "policy".into())]),
            env: BTreeMap::from([
                ("PORTABLE_TIER".into(), "launch".into()),
                ("PORTABLE_ONLY".into(), "preserved".into()),
            ]),
            owner_pubkey: Some("b".repeat(64)),
        });
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
                        "BUZZ_ACP_MCP_COMMAND": "",
                        "PORTABLE_TIER": "launch",
                        "PORTABLE_ONLY": "preserved",
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
            portable_agent,
            serde_json::json!({"runtime":"opencode"}),
        )
        .unwrap();
        assert_eq!(response.agent_id, "existing");
        lookup.assert();
        restart.assert();
        ready.assert();
    }

    #[test]
    fn stopped_agent_relaunch_without_sync_root_disables_sync() {
        let mut server = Server::new();
        let restart = server
            .mock("POST", "/agents/deployments/existing/start")
            .match_body(Matcher::Json(serde_json::json!({
                "sync_enabled": false,
                "dry_run": false
            })))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"id":"existing","runtime":"opencode","state":"pending"}"#)
            .create();
        let deployment: Deployment = serde_json::from_value(serde_json::json!({
            "id": "existing",
            "runtime": "opencode",
            "state": "stopped"
        }))
        .unwrap();
        let create = CreateDeploymentRequest::new(ManagedRuntime::Opencode);

        let restarted = restart_if_stopped(&client(&server), deployment, &create).unwrap();

        assert_eq!(restarted.id, "existing");
        restart.assert();
    }

    #[test]
    fn stopped_agent_relaunch_filter_does_not_enable_sync_without_root() {
        let mut server = Server::new();
        let restart = server
            .mock("POST", "/agents/deployments/existing/start")
            .match_body(Matcher::Json(serde_json::json!({
                "sync_enabled": false,
                "dry_run": false
            })))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"id":"existing","runtime":"opencode","state":"pending"}"#)
            .create();
        let deployment: Deployment = serde_json::from_value(serde_json::json!({
            "id": "existing",
            "runtime": "opencode",
            "state": "stopped"
        }))
        .unwrap();
        let mut create = CreateDeploymentRequest::new(ManagedRuntime::Opencode);
        create.sync_include = Some(vec![".config/opencode".to_owned()]);

        let restarted = restart_if_stopped(&client(&server), deployment, &create).unwrap();

        assert_eq!(restarted.id, "existing");
        restart.assert();
    }

    #[test]
    fn deploy_replaces_a_stopped_agent_when_its_runtime_changes() {
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
                        "id":"old-runtime",
                        "handle":handle,
                        "runtime":"goose",
                        "state":"stopped"
                    }],
                    "slots":{"large":{"available":1}}
                })
                .to_string(),
            )
            .create();
        let delete = server
            .mock("DELETE", "/agents/deployments/old-runtime")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"ok":true,"id":"old-runtime"}"#)
            .create();
        let create = server
            .mock("POST", "/agents/deployments")
            .match_body(Matcher::PartialJsonString(
                serde_json::json!({"runtime":"opencode","size":"large"}).to_string(),
            ))
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id":"new-runtime",
                    "handle":handle,
                    "runtime":"opencode",
                    "state":"pending"
                })
                .to_string(),
            )
            .create();
        let ready = server
            .mock("GET", "/agents/deployments/new-runtime")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(
                serde_json::json!({
                    "id":"new-runtime",
                    "handle":handle,
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

        assert_eq!(response.agent_id, "new-runtime");
        lookup.assert();
        delete.assert();
        create.assert();
        ready.assert();
    }

    #[test]
    fn deploy_rejects_changed_launch_settings_while_agent_is_running() {
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
                        "state":"running",
                        "tags":["app=buzz","buzz_launch=stale"]
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

        assert!(matches!(error, ProviderError::LaunchMismatch));
        lookup.assert();
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
            .with_body(r#"{"items":[],"slots":{"large":{"available":1}}}"#)
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
            .with_body(r#"{"items":[],"slots":{"large":{"available":2}}}"#)
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
        let downloading = server
            .mock("GET", "/agents/deployments/deployment-1")
            .with_status(200)
            .with_header("content-type", "application/json")
            .with_body(r#"{"id":"deployment-1","runtime":"opencode","state":"downloading"}"#)
            .expect(1)
            .create();
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
            avatar_url: None,
            runtime: Some(ManagedRuntime::Opencode),
            state: "pending".to_owned(),
            pod_id: None,
            hostname: None,
            tags: Vec::new(),
            requested_size: None,
            stage: None,
            error: None,
            message: None,
            last_error: None,
            runtime_status: None,
            placement_epoch: 0,
            runtime_generation: 0,
            finalize_epoch: None,
            restore_state: None,
            launch_config: Default::default(),
        };

        let ready = wait_until_running(
            &client(&server),
            initial,
            Duration::from_secs(1),
            Duration::ZERO,
        )
        .unwrap();

        assert_eq!(ready.state, "running");
        downloading.assert();
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
                avatar_url: None,
                runtime: Some(ManagedRuntime::Opencode),
                state: state.to_owned(),
                pod_id: None,
                hostname: None,
                tags: Vec::new(),
                requested_size: None,
                stage: None,
                error: None,
                message: None,
                last_error: None,
                runtime_status: None,
                placement_epoch: 0,
                runtime_generation: 0,
                finalize_epoch: None,
                restore_state: None,
                launch_config: Default::default(),
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
            avatar_url: None,
            runtime: Some(ManagedRuntime::Opencode),
            state: "starting".to_owned(),
            pod_id: None,
            hostname: None,
            tags: Vec::new(),
            requested_size: None,
            stage: None,
            error: None,
            message: None,
            last_error: None,
            runtime_status: None,
            placement_epoch: 0,
            runtime_generation: 0,
            finalize_epoch: None,
            restore_state: None,
            launch_config: Default::default(),
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
            let capacity = server
                .mock("GET", "/agents/deployments")
                .with_status(200)
                .with_header("content-type", "application/json")
                .with_body(r#"{"items":[],"slots":{"large":{"available":1}}}"#)
                .expect(1)
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
            capacity.assert();
            create.assert();
        }
    }
}
