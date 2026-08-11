mod buzz_connections;

use std::collections::{BTreeMap, HashMap};
use std::fs;
use std::path::PathBuf;
use std::sync::{Arc, Mutex};
use std::time::Duration;

use base64::Engine;
use hypercli_sdk::{
    discover_agents_api_base, discover_client_config, remove_config_api_keys,
    save_api_key as write_api_key, AgentSize, BuzzLaunchConfig, ClientConfig, ConfigError,
    CreateApiKeyRequest, CreateDeploymentRequest, Deployment, DeploymentLaunchConfig,
    ExecDeploymentRequest, HyperCliClient, ManagedRuntime, NativeRuntime, RuntimeAuthError,
    RuntimeLoginChallenge, RuntimeLoginSession, StartDeploymentRequest, UpdateDeploymentRequest,
};
use nostr::hashes::{sha256, Hash};
use nostr::{
    Event as NostrEvent, EventBuilder as NostrEventBuilder, Kind as NostrKind, Tag as NostrTag,
};
use nostr_sdk::Client as NostrClient;
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use serde_json::{Map as JsonMap, Value};
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;
use tauri_plugin_dialog::DialogExt;
use tokio::sync::watch;
use tokio::sync::Mutex as AsyncMutex;

use buzz_connections::{
    build_agent_profile_event, build_bot_enrollment_event, build_bot_removal_event,
    build_owner_attestation, discover_visible_channels, AgentIdentity, BuzzConnectionMetadata,
    BuzzConnectionRepository, ChannelReference, ManagedBuzzAgentMetadata, OwnerNsec,
    SystemOwnerSecretStore, VisibleChannel,
};

/// Runtime identities Buzz discovers as separate `Run on` choices. Keep in
/// sync with `buzz-backend-provider/README.md`.
const RUNTIMES: [&str; 6] = ["buzz-agent", "opencode", "codex", "claude", "goose", "kimi"];
const PROVIDER_BIN: &str = "buzz-backend-hypercli";

/// Capabilities held by a Desktop-minted machine key. Agent management is
/// the primary surface; files are needed for the explicit SSH-key workflow,
/// and the single model grant powers the short prompt-drafting helper without
/// turning the Desktop credential into an unrestricted inference key.
const DESKTOP_KEY_SCOPES: [&str; 4] = ["agents:*", "files:*", "models:kimi-k2.6", "user:self"];

/// Web login page. Its allowlist accepts the `hypercli://auth` scheme
/// callback (site/apps/claw/src/app/desktop-login/page.tsx) — the exact
/// Backseat Driver pattern: token in the URL fragment, no server round-trip.
const DESKTOP_LOGIN_PAGE: &str = "https://agents.hypercli.com/desktop-login";

struct DeploymentEventStream {
    restart: watch::Sender<u64>,
}

impl DeploymentEventStream {
    fn restart(&self) {
        self.restart.send_modify(|generation| *generation += 1);
    }
}

async fn run_deployment_event_stream(app: tauri::AppHandle, mut restart: watch::Receiver<u64>) {
    loop {
        let client = match tauri::async_runtime::spawn_blocking(managed_client).await {
            Ok(Ok(client)) => Arc::new(client),
            _ => {
                if restart.changed().await.is_err() {
                    return;
                }
                continue;
            }
        };
        let outcome = {
            let event_client = Arc::clone(&client);
            let event_app = app.clone();
            tokio::select! {
                result = event_client.subscribe_deployments(move |_| {
                    let _ = event_app.emit("deployments-invalidated", ());
                }) => Some(result),
                result = restart.changed() => {
                    if result.is_err() { return; }
                    None
                },
            }
        };
        let _ = tauri::async_runtime::spawn_blocking(move || drop(client)).await;
        let Some(outcome) = outcome else {
            continue;
        };
        if outcome
            .as_ref()
            .err()
            .and_then(|error| error.status())
            .is_some_and(|status| matches!(status.as_u16(), 401 | 403))
        {
            if restart.changed().await.is_err() {
                return;
            }
            continue;
        }
        tokio::select! {
            _ = tokio::time::sleep(Duration::from_secs(1)) => {}
            result = restart.changed() => if result.is_err() { return; },
        }
    }
}

#[derive(Serialize)]
pub struct ProviderStatus {
    installed: Vec<String>,
    missing: Vec<String>,
    /// Present but unusable — a leftover link whose target is gone. Reported
    /// separately so the UI can say "reinstall" instead of "never installed".
    broken: Vec<String>,
    /// macOS is running the app from a translocation mount; the install
    /// still works (we copy), but the user should move the app.
    translocated: bool,
    has_api_key: bool,
    config_error: Option<String>,
    bin_dir: String,
    bin_dir_exists: bool,
}

#[derive(Serialize)]
pub struct KeyValidation {
    valid: bool,
    email: Option<String>,
    key_name: Option<String>,
    has_agents_capability: bool,
    has_editor_capability: bool,
    /// None = plan status unknowable (key lacks the `user` scope family) —
    /// the UI must not show a purchase hint in that case.
    has_active_plan: Option<bool>,
    detail: Option<String>,
}

/// Secret-free deployment summary rendered by the Desktop fleet view.
#[derive(Serialize)]
pub struct DesktopAgent {
    id: String,
    name: String,
    handle: Option<String>,
    avatar_url: Option<String>,
    runtime: Option<String>,
    state: String,
    tags: Vec<String>,
    hostname: Option<String>,
    requested_size: Option<String>,
    is_buzz: bool,
    agent_public_key: Option<String>,
    native_auth_runtime: Option<String>,
    can_start: bool,
    can_stop: bool,
    can_restart: bool,
    can_delete: bool,
}

#[derive(Serialize)]
pub struct DesktopAgentDetail {
    id: String,
    name: String,
    runtime: String,
    state: String,
    size: Option<String>,
    instructions: String,
    avatar_url: Option<String>,
    model: Option<String>,
    concurrency: Option<u32>,
    sync_all: bool,
    relay: String,
    community: String,
    connection_id: Option<String>,
    respond_to: String,
    allowlist: Vec<String>,
    env: BTreeMap<String, String>,
    secret_env_keys: Vec<String>,
    agent_public_key: Option<String>,
    recent_communities: Vec<String>,
}

#[derive(Clone, Deserialize)]
pub struct AgentEditorInput {
    name: String,
    instructions: String,
    avatar_url: Option<String>,
    #[serde(default)]
    avatar_upload_id: Option<String>,
    #[serde(default)]
    avatar_remove: bool,
    runtime: String,
    size: Option<String>,
    model: Option<String>,
    concurrency: Option<u32>,
    #[serde(default)]
    sync_all: Option<bool>,
    relay: String,
    community: String,
    #[serde(default)]
    connection_id: Option<String>,
    #[serde(default)]
    channels: Vec<String>,
    respond_to: String,
    #[serde(default)]
    allowlist: Vec<String>,
    #[serde(default)]
    env: BTreeMap<String, String>,
}

#[derive(Deserialize)]
pub struct BuzzConnectionInput {
    label: String,
    relay: String,
    nsec: String,
}

#[derive(Deserialize)]
struct ChatCompletionResponse {
    choices: Vec<ChatCompletionChoice>,
}

#[derive(Deserialize)]
struct ChatCompletionChoice {
    message: ChatCompletionMessage,
}

#[derive(Deserialize)]
struct ChatCompletionMessage {
    content: String,
}

#[derive(Serialize)]
pub struct DesktopRuntimeAuthStatus {
    authenticated: Option<bool>,
    status: String,
    detail: String,
}

#[derive(Serialize)]
pub struct DesktopRuntimeLoginChallenge {
    url: Option<String>,
    code: Option<String>,
    instructions: String,
    interactive_required: bool,
    completed: bool,
    failed: bool,
    status: String,
}

#[derive(Serialize)]
pub struct DesktopSshKeyStatus {
    configured: bool,
    public_key: Option<String>,
    fingerprint: Option<String>,
}

impl From<RuntimeLoginChallenge> for DesktopRuntimeLoginChallenge {
    fn from(challenge: RuntimeLoginChallenge) -> Self {
        let failed = challenge.completed && challenge.exit_code != Some(0);
        let completed = challenge.completed && !failed;
        Self {
            url: challenge.verification_url,
            code: challenge.user_code,
            instructions: challenge.instructions,
            interactive_required: challenge.interactive_required,
            completed,
            failed,
            status: if failed {
                "failed"
            } else if completed {
                "completed"
            } else {
                "running"
            }
            .to_owned(),
        }
    }
}

#[derive(Default)]
struct RuntimeLoginSessions {
    sessions: AsyncMutex<HashMap<String, Arc<AsyncMutex<RuntimeLoginSession>>>>,
}

const MAX_AVATAR_BYTES: u64 = 2 * 1024 * 1024;

struct StagedAvatar {
    content: Vec<u8>,
    content_type: String,
}

#[derive(Default)]
struct StagedAvatarUploads {
    uploads: Mutex<HashMap<String, StagedAvatar>>,
}

#[derive(Serialize)]
struct DesktopAvatarSelection {
    upload_id: String,
    preview_data_url: String,
    file_name: String,
}

#[derive(Clone, Copy, Debug, Eq, PartialEq)]
struct AgentActions {
    start: bool,
    stop: bool,
    restart: bool,
    delete: bool,
}

fn normalized_state(state: &str) -> String {
    state.trim().to_ascii_lowercase()
}

fn runtime_id(runtime: ManagedRuntime) -> &'static str {
    match runtime {
        ManagedRuntime::Generic => "generic",
        ManagedRuntime::Openclaw => "openclaw",
        ManagedRuntime::OpenclawPro => "openclaw-pro",
        ManagedRuntime::HermesAgent => "hermes-agent",
        ManagedRuntime::BuzzAgent => "buzz-agent",
        ManagedRuntime::Opencode => "opencode",
        ManagedRuntime::Codex => "codex",
        ManagedRuntime::ClaudeCode => "claude-code",
        ManagedRuntime::Goose => "goose",
        ManagedRuntime::KimiCode => "kimi-code",
    }
}

fn native_runtime(runtime: ManagedRuntime) -> Option<NativeRuntime> {
    match runtime {
        ManagedRuntime::ClaudeCode => Some(NativeRuntime::ClaudeCode),
        ManagedRuntime::Codex => Some(NativeRuntime::Codex),
        ManagedRuntime::KimiCode => Some(NativeRuntime::KimiCode),
        _ => None,
    }
}

fn parse_editor_runtime(value: &str) -> Result<ManagedRuntime, String> {
    match value.trim() {
        "buzz-agent" => Ok(ManagedRuntime::BuzzAgent),
        "opencode" => Ok(ManagedRuntime::Opencode),
        "goose" => Ok(ManagedRuntime::Goose),
        "claude-code" => Ok(ManagedRuntime::ClaudeCode),
        "codex" => Ok(ManagedRuntime::Codex),
        "kimi-code" => Ok(ManagedRuntime::KimiCode),
        _ => Err("Unsupported coding runtime".to_owned()),
    }
}

fn parse_editor_size(value: Option<&str>) -> Result<Option<AgentSize>, String> {
    match value.map(str::trim).filter(|value| !value.is_empty()) {
        None => Ok(None),
        Some("small") => Ok(Some(AgentSize::Small)),
        Some("medium") => Ok(Some(AgentSize::Medium)),
        Some("large") => Ok(Some(AgentSize::Large)),
        Some(_) => Err("Size must be small, medium, large, or automatic".to_owned()),
    }
}

fn deployment_runtime(deployment: &Deployment) -> Result<ManagedRuntime, String> {
    deployment
        .runtime
        .ok_or_else(|| "Agent has no managed runtime".to_owned())
}

/// Variables owned by Lagoon, the Buzz identity contract, or process startup
/// are never accepted through the free-form editor. Runtime vendor variables
/// such as ANTHROPIC_*, OPENAI_*, and KIMI_* remain available deliberately.
fn is_protected_launch_env(key: &str) -> bool {
    let key = key.trim().to_ascii_uppercase();
    if key == "HYPERCLI_RUNTIME_INFERENCE" {
        return false;
    }
    key.starts_with("BUZZ_")
        || key.starts_with("HYPER_")
        || key.starts_with("NOSTR_")
        || key.starts_with("KUBERNETES_")
        || key.starts_with("DYLD_")
        || matches!(
            key.as_str(),
            "PATH"
                | "HOME"
                | "USER"
                | "SHELL"
                | "HOSTNAME"
                | "PWD"
                | "OLDPWD"
                | "LD_PRELOAD"
                | "LD_LIBRARY_PATH"
                | "CLAUDE_CODE_EXECUTABLE"
        )
}

fn is_secret_env_key(key: &str) -> bool {
    if key == "HYPERCLI_RUNTIME_INFERENCE" || key.ends_with("_BASE_URL") {
        return false;
    }
    let normalized = key.to_ascii_lowercase();
    [
        "key",
        "token",
        "secret",
        "password",
        "credential",
        "auth",
        "cookie",
        "private",
        "database_url",
        "connection_string",
        "dsn",
    ]
    .iter()
    .any(|needle| normalized.contains(needle))
}

fn validate_additional_env(env: &BTreeMap<String, String>) -> Result<(), String> {
    for (key, value) in env {
        let valid_key = !key.is_empty()
            && key.len() <= 128
            && key.chars().enumerate().all(|(index, character)| {
                character == '_'
                    || character.is_ascii_alphanumeric()
                        && (index > 0 || !character.is_ascii_digit())
            });
        if !valid_key {
            return Err(format!("Invalid environment variable name: {key}"));
        }
        if is_protected_launch_env(key) {
            return Err(format!(
                "{key} is managed by HyperCLI and cannot be overridden"
            ));
        }
        if key.eq_ignore_ascii_case("HYPERCLI_RUNTIME_INFERENCE")
            && (key != "HYPERCLI_RUNTIME_INFERENCE"
                || !matches!(value.as_str(), "native" | "hypercli"))
        {
            return Err(
                "HYPERCLI_RUNTIME_INFERENCE must use that exact name and the value native or hypercli"
                    .to_owned(),
            );
        }
        if value.len() > 16 * 1024 {
            return Err(format!("{key} is too large"));
        }
    }
    Ok(())
}

fn launch_env(config: &DeploymentLaunchConfig) -> Result<BTreeMap<String, String>, String> {
    let Some(value) = config.as_map().get("env") else {
        return Ok(BTreeMap::new());
    };
    let object = value
        .as_object()
        .ok_or_else(|| "Stored launch environment is invalid".to_owned())?;
    object
        .iter()
        .map(|(key, value)| {
            value
                .as_str()
                .map(|value| (key.clone(), value.to_owned()))
                .ok_or_else(|| format!("Stored launch environment value for {key} is invalid"))
        })
        .collect()
}

fn insert_launch_env(config: &mut BTreeMap<String, Value>, env: BTreeMap<String, String>) {
    config.insert(
        "env".to_owned(),
        Value::Object(
            env.into_iter()
                .map(|(key, value)| (key, Value::String(value)))
                .collect::<JsonMap<String, Value>>(),
        ),
    );
}

fn launch_syncs_all(config: &DeploymentLaunchConfig) -> bool {
    let policy_is_set = |key: &str| {
        config
            .as_map()
            .get(key)
            .is_some_and(|value| !value.is_null())
    };
    !policy_is_set("sync_include") && !policy_is_set("sync_exclude")
}

fn apply_editor_sync_policy(
    config: &mut BTreeMap<String, Value>,
    runtime: ManagedRuntime,
    sync_all: bool,
) {
    if sync_all {
        // Explicit null is the backend's clear-to-full-root operation. Omitting
        // both keys on a restart means "inherit the stored selective policy".
        config.insert("sync_include".to_owned(), Value::Null);
        config.remove("sync_exclude");
        return;
    }
    config.retain(|key, value| {
        !matches!(key.as_str(), "sync_include" | "sync_exclude") || !value.is_null()
    });
    if !config.contains_key("sync_include") && !config.contains_key("sync_exclude") {
        if let Some(paths) = runtime.default_sync_include() {
            config.insert(
                "sync_include".to_owned(),
                Value::Array(
                    paths
                        .iter()
                        .map(|path| Value::String((*path).to_owned()))
                        .collect(),
                ),
            );
        }
    }
    if config.contains_key("sync_include") {
        config.remove("sync_exclude");
    }
}

fn env_value(env: &BTreeMap<String, String>, key: &str) -> Option<String> {
    env.get(key)
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

fn split_env_list(value: Option<String>) -> Vec<String> {
    value
        .unwrap_or_default()
        .split([',', '\n'])
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .map(str::to_owned)
        .collect()
}

fn agent_actions(state: &str) -> AgentActions {
    match normalized_state(state).as_str() {
        "stopped" => AgentActions {
            start: true,
            stop: false,
            restart: false,
            delete: true,
        },
        "running" => AgentActions {
            start: false,
            stop: true,
            restart: true,
            delete: false,
        },
        "creating" | "restoring" | "starting" => AgentActions {
            start: false,
            stop: true,
            restart: false,
            delete: false,
        },
        "failed" => AgentActions {
            start: false,
            stop: false,
            restart: true,
            delete: false,
        },
        _ => AgentActions {
            start: false,
            stop: false,
            restart: false,
            delete: false,
        },
    }
}

fn buzz_agent_public_key(deployment: &Deployment) -> Option<String> {
    deployment.tags.iter().find_map(|tag| {
        tag.strip_prefix("buzz_agent=")
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .map(str::to_owned)
    })
}

fn deployment_display_name(deployment: &Deployment) -> String {
    launch_env(&deployment.launch_config)
        .ok()
        .and_then(|env| env_value(&env, "BUZZ_ACP_DISPLAY_NAME"))
        .unwrap_or_else(|| deployment.name.clone())
}

impl From<Deployment> for DesktopAgent {
    fn from(deployment: Deployment) -> Self {
        let actions = agent_actions(&deployment.state);
        let is_buzz = deployment.is_buzz_managed();
        let agent_public_key = buzz_agent_public_key(&deployment);
        let display_name = deployment_display_name(&deployment);
        let native_auth_runtime = match deployment.runtime.as_ref() {
            Some(hypercli_sdk::ManagedRuntime::ClaudeCode) => Some("claude-code"),
            Some(hypercli_sdk::ManagedRuntime::Codex) => Some("codex"),
            Some(hypercli_sdk::ManagedRuntime::KimiCode) => Some("kimi-code"),
            _ => None,
        }
        .map(str::to_owned);
        let launch_avatar = launch_env(&deployment.launch_config)
            .ok()
            .and_then(|env| env_value(&env, "BUZZ_PROFILE_PICTURE"));
        Self {
            id: deployment.id,
            name: display_name,
            handle: deployment.handle,
            avatar_url: deployment.avatar_url.or(launch_avatar),
            runtime: deployment
                .runtime
                .and_then(|runtime| serde_json::to_value(runtime).ok())
                .and_then(|value| value.as_str().map(str::to_owned)),
            state: normalized_state(&deployment.state),
            tags: deployment.tags,
            hostname: deployment.hostname,
            requested_size: deployment.requested_size,
            is_buzz,
            agent_public_key,
            native_auth_runtime,
            can_start: actions.start,
            can_stop: actions.stop,
            can_restart: actions.restart,
            can_delete: actions.delete,
        }
    }
}

fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "cannot resolve home directory".to_string())
}

fn buzz_connections_path() -> Result<PathBuf, String> {
    let root = dirs::config_dir().unwrap_or(home_dir()?.join(".config"));
    Ok(root.join("hypercli").join("buzz-connections.json"))
}

fn buzz_connection_repository() -> Result<BuzzConnectionRepository<SystemOwnerSecretStore>, String>
{
    Ok(BuzzConnectionRepository::new(
        buzz_connections_path()?,
        SystemOwnerSecretStore::new(),
    ))
}

#[tauri::command]
fn list_buzz_connections() -> Result<Vec<BuzzConnectionMetadata>, String> {
    buzz_connection_repository()?
        .load()
        .map(|document| document.connections)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn save_buzz_connection(input: BuzzConnectionInput) -> Result<BuzzConnectionMetadata, String> {
    let nsec = OwnerNsec::parse(&input.nsec).map_err(|error| error.to_string())?;
    buzz_connection_repository()?
        .add_connection(&input.label, &input.relay, nsec)
        .map_err(|error| error.to_string())
}

#[tauri::command]
fn remove_buzz_connection(connection_id: String) -> Result<(), String> {
    let connection_id = checked_agent_id(&connection_id)?;
    buzz_connection_repository()?
        .remove_connection(&connection_id)
        .map_err(|error| error.to_string())
}

async fn fetch_buzz_channels(
    relay: String,
    signer: nostr::Keys,
) -> Result<Vec<VisibleChannel>, String> {
    let viewer = signer.public_key();
    // Match upstream Buzz Desktop/buzz-acp: private group discovery is read
    // through the relay's authenticated HTTP query bridge, not a bare WS
    // subscription. The latter can connect successfully yet see no private
    // 39002 state on hosted communities.
    let memberships = query_buzz_events_http(
        &relay,
        &signer,
        serde_json::json!([{
            "kinds": [39002],
            "#p": [viewer.to_hex()],
            "limit": 1000,
        }]),
    )
    .await
    .map_err(|error| format!("Could not read Buzz channel memberships: {error}"))?;
    let mut channel_ids = memberships
        .iter()
        .filter_map(|event| {
            event.tags.iter().find_map(|tag| {
                let values = tag.as_slice();
                (values.first().map(String::as_str) == Some("d"))
                    .then(|| values.get(1).cloned())
                    .flatten()
            })
        })
        .collect::<Vec<_>>();
    channel_ids.sort();
    channel_ids.dedup();
    let metadata = if channel_ids.is_empty() {
        Vec::new()
    } else {
        let channel_limit = channel_ids.len();
        query_buzz_events_http(
            &relay,
            &signer,
            serde_json::json!([{
                "kinds": [39000],
                "#d": channel_ids,
                "limit": channel_limit,
            }]),
        )
        .await
        .map_err(|error| format!("Could not read Buzz channels: {error}"))?
    };
    discover_visible_channels(&metadata, &memberships, &viewer).map_err(|error| error.to_string())
}

#[tauri::command]
async fn list_buzz_channels(connection_id: String) -> Result<Vec<VisibleChannel>, String> {
    let connection_id = checked_agent_id(&connection_id)?;
    let (relay, signer) = tauri::async_runtime::spawn_blocking(move || {
        let repository = buzz_connection_repository()?;
        let document = repository.load().map_err(|error| error.to_string())?;
        let connection = document
            .connections
            .iter()
            .find(|connection| connection.id == connection_id)
            .ok_or_else(|| "Saved Buzz connection not found".to_owned())?;
        let signer = repository
            .owner_signer(&connection_id)
            .map_err(|error| error.to_string())?;
        Ok::<_, String>((connection.relay_url.clone(), signer.keys()))
    })
    .await
    .map_err(|error| error.to_string())??;
    fetch_buzz_channels(relay, signer).await
}

fn canonical_hex_public_key(value: &str) -> Option<String> {
    let value = value.trim();
    (value.len() == 64 && value.chars().all(|character| character.is_ascii_hexdigit()))
        .then(|| nostr::PublicKey::from_hex(value).ok())
        .flatten()
        .map(|public_key| public_key.to_hex())
}

fn explicit_allowlist_public_key(value: &str) -> Result<Option<String>, String> {
    let value = value.trim();
    if value.starts_with("npub1") {
        return nostr::PublicKey::parse(value)
            .map(|public_key| Some(public_key.to_hex()))
            .map_err(|_| format!("Invalid npub: {value}"));
    }
    if value.len() == 64 {
        return canonical_hex_public_key(value)
            .map(Some)
            .ok_or_else(|| "Invalid 64-character public key".to_owned());
    }
    Ok(None)
}

fn profile_aliases(content: &str) -> Vec<String> {
    let Ok(metadata) = serde_json::from_str::<nostr::Metadata>(content) else {
        return Vec::new();
    };
    let mut aliases = Vec::new();
    for value in [metadata.name, metadata.display_name].into_iter().flatten() {
        let value = value.to_ascii_lowercase();
        if value.is_empty() {
            continue;
        }
        aliases.push(value);
    }
    aliases.sort();
    aliases.dedup();
    aliases
}

fn resolve_allowlist_entries(
    entries: &[String],
    selected_channels: &[String],
    membership_events: &[NostrEvent],
    profile_events: &[NostrEvent],
) -> Result<Vec<String>, String> {
    let explicit_entries = entries
        .iter()
        .map(|entry| explicit_allowlist_public_key(entry))
        .collect::<Result<Vec<_>, _>>()?;
    let needs_nickname_lookup = explicit_entries.iter().any(Option::is_none);
    let selected_channels = selected_channels
        .iter()
        .map(String::as_str)
        .collect::<std::collections::HashSet<_>>();
    let mut newest_memberships: HashMap<&str, &NostrEvent> = HashMap::new();
    for event in membership_events
        .iter()
        .filter(|event| event.kind.as_u16() == 39002)
    {
        let channel = event.tags.iter().find_map(|tag| {
            let values = tag.as_slice();
            (values.first().map(String::as_str) == Some("d"))
                .then(|| values.get(1).map(String::as_str))
                .flatten()
        });
        let Some(channel) = channel.filter(|channel| selected_channels.contains(channel)) else {
            continue;
        };
        let replace = newest_memberships
            .get(channel)
            .map(|current| {
                event.created_at > current.created_at
                    || (event.created_at == current.created_at && event.id < current.id)
            })
            .unwrap_or(true);
        if replace {
            newest_memberships.insert(channel, event);
        }
    }
    if needs_nickname_lookup {
        if let Some(missing) = selected_channels
            .iter()
            .find(|channel| !newest_memberships.contains_key(**channel))
        {
            return Err(format!(
                "Could not load the current member roster for Buzz channel {missing}"
            ));
        }
    }

    let mut member_keys = std::collections::HashSet::new();
    for event in newest_memberships.values() {
        for tag in event.tags.iter() {
            let values = tag.as_slice();
            if values.first().map(String::as_str) != Some("p") {
                continue;
            }
            if let Some(public_key) = values
                .get(1)
                .and_then(|value| canonical_hex_public_key(value))
            {
                member_keys.insert(public_key);
            }
        }
    }

    let mut newest_profiles: HashMap<String, &NostrEvent> = HashMap::new();
    for event in profile_events
        .iter()
        .filter(|event| event.kind == nostr::Kind::Metadata)
    {
        let public_key = event.pubkey.to_hex();
        if !member_keys.contains(&public_key) {
            continue;
        }
        let replace = newest_profiles
            .get(&public_key)
            .map(|current| {
                event.created_at > current.created_at
                    || (event.created_at == current.created_at && event.id < current.id)
            })
            .unwrap_or(true);
        if replace {
            newest_profiles.insert(public_key, event);
        }
    }

    let aliases = newest_profiles
        .into_iter()
        .map(|(public_key, event)| (public_key, profile_aliases(&event.content)))
        .collect::<Vec<_>>();
    let mut resolved = Vec::new();
    for entry in entries {
        let entry = entry.trim();
        if let Some(public_key) = explicit_allowlist_public_key(entry)? {
            resolved.push(public_key);
            continue;
        }
        let needle = entry.to_ascii_lowercase();
        let mut matches = aliases
            .iter()
            .filter(|(_, candidate_aliases)| candidate_aliases.contains(&needle))
            .map(|(public_key, _)| public_key.clone())
            .collect::<Vec<_>>();
        matches.sort();
        matches.dedup();
        match matches.as_slice() {
            [public_key] => resolved.push(public_key.clone()),
            [] => {
                return Err(format!(
                    "No member named '{entry}' was found in the selected Buzz channels; use an npub or hex public key"
                ));
            }
            _ => {
                return Err(format!(
                    "More than one member is named '{entry}'; use an npub to disambiguate"
                ));
            }
        }
    }
    resolved.sort();
    resolved.dedup();
    Ok(resolved)
}

async fn resolve_buzz_allowlist(
    relay: &str,
    signer: nostr::Keys,
    channels: &[String],
    entries: &[String],
) -> Result<Vec<String>, String> {
    use nostr::{Alphabet, Filter, Kind, SingleLetterTag};

    if entries.is_empty() {
        return Ok(Vec::new());
    }
    let explicit_entries = entries
        .iter()
        .map(|entry| explicit_allowlist_public_key(entry))
        .collect::<Result<Vec<_>, _>>()?;
    if explicit_entries.iter().all(Option::is_some) {
        return resolve_allowlist_entries(entries, channels, &[], &[]);
    }
    let client = NostrClient::new(signer);
    client
        .add_relay(relay)
        .await
        .map_err(|_| "Could not configure the Buzz relay".to_owned())?;
    client
        .try_connect_relay(relay, Duration::from_secs(10))
        .await
        .map_err(|_| "Could not connect to the Buzz relay".to_owned())?;
    let membership_filter = Filter::new()
        .kind(Kind::Custom(39002))
        .custom_tags(
            SingleLetterTag::lowercase(Alphabet::D),
            channels.iter().cloned(),
        )
        .limit(1000);
    let memberships = client
        .fetch_events(membership_filter, Duration::from_secs(10))
        .await
        .map_err(|_| "Could not read Buzz channel members".to_owned())?
        .into_iter()
        .collect::<Vec<_>>();
    let mut members = memberships
        .iter()
        .flat_map(|event| event.tags.iter())
        .filter_map(|tag| {
            let values = tag.as_slice();
            (values.first().map(String::as_str) == Some("p"))
                .then(|| values.get(1))
                .flatten()
                .and_then(|value| nostr::PublicKey::from_hex(value).ok())
        })
        .collect::<Vec<_>>();
    members.sort_by_key(nostr::PublicKey::to_hex);
    members.dedup();
    if members.len() > 2000 {
        client.disconnect().await;
        return Err(
            "The selected Buzz channels have too many members for nickname lookup; use npubs"
                .to_owned(),
        );
    }
    let profiles = if members.is_empty() {
        Vec::new()
    } else {
        client
            .fetch_events(
                Filter::new()
                    .kind(Kind::Metadata)
                    .authors(members)
                    .limit(2000),
                Duration::from_secs(10),
            )
            .await
            .map_err(|_| "Could not read Buzz member profiles".to_owned())?
            .into_iter()
            .collect::<Vec<_>>()
    };
    client.disconnect().await;
    resolve_allowlist_entries(entries, channels, &memberships, &profiles)
}

/// Buzz scans this directory explicitly on every platform.
fn bin_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".local").join("bin"))
}

/// The single real binary installed in `~/.local/bin`; every Buzz runtime
/// identity links to it. Generic on purpose — the same executable serves
/// the provider protocol and (per buzz-backend-provider/README.md) the
/// planned `hypercli-configure` argv[0] surface.
fn canonical_bin_name() -> String {
    let ext = if cfg!(windows) { ".exe" } else { "" };
    format!("hypercli-configure{ext}")
}

fn provider_names() -> Vec<String> {
    let ext = if cfg!(windows) { ".exe" } else { "" };
    let mut names = vec![format!("{PROVIDER_BIN}{ext}")];
    names.extend(
        RUNTIMES
            .iter()
            .map(|rt| format!("{PROVIDER_BIN}-{rt}{ext}")),
    );
    names
}

/// True when macOS is running this app from an App Translocation mount — a
/// randomized read-only copy of a still-quarantined download, torn down when
/// the app quits. Installing by copy is safe from there; only links into the
/// bundle would break, which is exactly why we no longer create any.
fn is_translocated() -> bool {
    std::env::current_exe()
        .map(|exe| exe.to_string_lossy().contains("/AppTranslocation/"))
        .unwrap_or(false)
}

/// The sidecar binary Tauri bundles next to the app executable.
fn sidecar_path() -> Result<PathBuf, String> {
    let exe = std::env::current_exe().map_err(|e| e.to_string())?;
    let dir = exe
        .parent()
        .ok_or_else(|| "cannot resolve app directory".to_string())?;
    let ext = if cfg!(windows) { ".exe" } else { "" };
    let path = dir.join(format!("{PROVIDER_BIN}{ext}"));
    if !path.exists() {
        return Err(format!("bundled provider not found at {}", path.display()));
    }
    Ok(path)
}

/// Install a binary by streaming its bytes to a temp file and renaming it
/// into place.
///
/// Deliberately NOT `fs::copy`: on macOS that clones extended attributes, so
/// copying out of a quarantined app bundle would produce a quarantined
/// binary and Gatekeeper would kill it the moment Buzz executed it. The
/// rename is atomic and safe even while a previous copy is running — the
/// live process keeps the old inode.
fn install_binary(source: &std::path::Path, dest: &std::path::Path) -> std::io::Result<()> {
    if let Some(parent) = dest.parent() {
        fs::create_dir_all(parent)?;
    }
    let tmp = dest.with_extension("tmp-install");
    let _ = fs::remove_file(&tmp);
    {
        let mut reader = fs::File::open(source)?;
        let mut writer = fs::File::create(&tmp)?;
        std::io::copy(&mut reader, &mut writer)?;
        writer.sync_all()?;
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&tmp, fs::Permissions::from_mode(0o755))?;
    }
    fs::rename(&tmp, dest)
}

/// Drop the quarantine flag a copied binary inherits from a downloaded app.
/// Buzz spawns these directly; a quarantined, not-yet-notarized binary would
/// be blocked by Gatekeeper. Best effort — the attribute is often absent.
#[cfg(target_os = "macos")]
fn clear_quarantine(path: &std::path::Path) {
    let _ = std::process::Command::new("/usr/bin/xattr")
        .args(["-d", "com.apple.quarantine"])
        .arg(path)
        .output();
}

#[cfg(not(target_os = "macos"))]
fn clear_quarantine(_path: &std::path::Path) {}

/// Credential presence via the SDK's discovery (env vars, config file,
/// legacy agent-key.json) — exactly what the provider itself will see.
fn credential_state() -> (bool, Option<String>) {
    match discover_client_config() {
        Ok(_) => (true, None),
        Err(ConfigError::MissingCredential) => (false, None),
        Err(error) => (false, Some(error.to_string())),
    }
}

#[tauri::command]
fn provider_status() -> Result<ProviderStatus, String> {
    let dir = bin_dir()?;
    // `exists()` follows symlinks, so a link left dangling by an older
    // install (which pointed into the app bundle) correctly reads as missing
    // and gets replaced on the next install.
    let (installed, missing): (Vec<String>, Vec<String>) = provider_names()
        .into_iter()
        .partition(|name| dir.join(name).exists());
    // A name that exists as a link but resolves nowhere: installed by an
    // older build that pointed into the app bundle.
    let broken = missing
        .iter()
        .filter(|name| dir.join(name).symlink_metadata().is_ok())
        .cloned()
        .collect();
    let (has_api_key, config_error) = credential_state();
    Ok(ProviderStatus {
        installed,
        missing,
        broken,
        translocated: is_translocated(),
        has_api_key,
        config_error,
        bin_dir: dir.display().to_string(),
        bin_dir_exists: dir.is_dir(),
    })
}

/// Install the provider into `~/.local/bin`, owned by the user rather than
/// the app bundle: one real copy under the generic `hypercli-configure`
/// name, with every Buzz runtime identity a relative symlink beside it
/// (copies on Windows, where symlinks need admin or Developer Mode).
///
/// Copying — rather than linking into `HyperCLI.app` — is deliberate: a
/// downloaded app may run from an App Translocation mount that vanishes on
/// quit, and the app can be moved or deleted. The install must outlive it.
#[tauri::command]
fn install_providers() -> Result<ProviderStatus, String> {
    let source = sidecar_path()?;
    let dir = bin_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;

    let primary = dir.join(canonical_bin_name());
    install_binary(&source, &primary)
        .map_err(|e| format!("installing {}: {e}", primary.display()))?;
    clear_quarantine(&primary);

    for name in provider_names() {
        let target = dir.join(&name);
        // symlink_metadata, not exists(): a link left dangling by an older
        // install still needs removing, and exists() follows the link.
        if target.symlink_metadata().is_ok() {
            fs::remove_file(&target).map_err(|e| e.to_string())?;
        }
        // Relative target: resolves through the directory itself, so the
        // install survives the home directory being moved or renamed.
        #[cfg(unix)]
        std::os::unix::fs::symlink(canonical_bin_name(), &target).map_err(|e| e.to_string())?;
        #[cfg(windows)]
        {
            fs::copy(&primary, &target).map_err(|e| e.to_string())?;
            clear_quarantine(&target);
        }
    }
    provider_status()
}

/// Remove every provider name and the shared binary. Only touches our names.
#[tauri::command]
fn uninstall_providers() -> Result<ProviderStatus, String> {
    let dir = bin_dir()?;
    for name in provider_names().into_iter().chain([canonical_bin_name()]) {
        let target = dir.join(&name);
        if target.symlink_metadata().is_ok() {
            fs::remove_file(&target).map_err(|e| e.to_string())?;
        }
    }
    provider_status()
}

#[tauri::command]
fn save_api_key(
    api_key: String,
    events: tauri::State<'_, DeploymentEventStream>,
) -> Result<(), String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("API key is empty".into());
    }
    write_api_key(&home_dir()?, api_key).map_err(|e| e.to_string())?;
    events.restart();
    Ok(())
}

/// Returns true when a key is still discoverable afterwards — i.e. the
/// environment exports one that logout cannot (and should not) remove.
#[tauri::command]
fn logout(events: tauri::State<'_, DeploymentEventStream>) -> Result<bool, String> {
    remove_config_api_keys(&home_dir()?).map_err(|e| e.to_string())?;
    events.restart();
    let (still_has_key, _) = credential_state();
    Ok(still_has_key)
}

/// Check the configured key against the API and report whether it carries
/// the `agents:*` capability the Buzz provider needs.
fn validate_key_blocking() -> Result<KeyValidation, String> {
    let config = discover_client_config().map_err(|e| e.to_string())?;
    let client = HyperCliClient::new(config).map_err(|e| e.to_string())?;
    match client.auth_me() {
        Ok(me) => {
            let has_scope = |scope: &str| me.capabilities.iter().any(|value| value == scope);
            Ok(KeyValidation {
                valid: true,
                email: me.email,
                key_name: me.key_name,
                has_agents_capability: has_scope("agents:*"),
                has_editor_capability: has_scope("agents:*")
                    && has_scope("files:*")
                    && has_scope("models:kimi-k2.6"),
                // The HyperClaw plan lives in the entitlements summary, NOT in
                // auth_me.has_active_subscription (that flag is the Orchestra
                // product subscription). Scoped keys without the `user` family
                // get 403 here — report unknown, never a false "no plan".
                has_active_plan: client
                    .entitlements_summary()
                    .ok()
                    .map(|summary| summary.has_active_plan()),
                detail: None,
            })
        }
        Err(error) => {
            let detail = match error.status().map(|s| s.as_u16()) {
                Some(401) | Some(403) => "API key is invalid or revoked".to_string(),
                _ => error.to_string(),
            };
            Ok(KeyValidation {
                valid: false,
                email: None,
                key_name: None,
                has_agents_capability: false,
                has_editor_capability: false,
                has_active_plan: None,
                detail: Some(detail),
            })
        }
    }
}

/// The SDK's HTTP client is blocking; it must not be created or dropped on
/// the async runtime (tokio panics), so the work runs on a blocking thread.
#[tauri::command]
async fn validate_key() -> Result<KeyValidation, String> {
    tauri::async_runtime::spawn_blocking(validate_key_blocking)
        .await
        .map_err(|e| e.to_string())?
}

fn managed_client() -> Result<HyperCliClient, String> {
    let config = discover_client_config().map_err(|error| error.to_string())?;
    HyperCliClient::new(config).map_err(|error| error.to_string())
}

fn prompt_drafting_status_error(status: u16) -> String {
    match status {
        400 => "The inference gateway rejected this draft request (HTTP 400). Try a shorter description or sign in again.".to_owned(),
        401 | 403 => {
            "This Desktop key needs to be reauthorized for prompt drafting".to_owned()
        }
        402 => "This account does not currently have inference access (HTTP 402). Check the account plan and try again.".to_owned(),
        404 => "Prompt drafting is not available at the configured HyperCLI endpoint (HTTP 404).".to_owned(),
        408 | 504 => "Prompt drafting timed out at the inference gateway. Try again in a moment.".to_owned(),
        429 => "Prompt drafting is temporarily rate limited. Wait a moment, then try again.".to_owned(),
        500..=599 => format!(
            "HyperCLI inference is temporarily unavailable (HTTP {status}). Try again in a moment."
        ),
        _ => format!(
            "Prompt drafting failed at the inference gateway (HTTP {status})."
        ),
    }
}

fn draft_agent_prompt_blocking(keywords: String) -> Result<String, String> {
    let keywords = keywords.trim();
    if keywords.len() < 2 || keywords.len() > 1000 {
        return Err("Describe the agent in 2 to 1000 characters".to_owned());
    }
    let config = discover_client_config().map_err(|error| error.to_string())?;
    let mut url = config.api_base.clone();
    url.set_path("/v1/chat/completions");
    url.set_query(None);
    url.set_fragment(None);
    let response = reqwest::blocking::Client::builder()
        .timeout(Duration::from_secs(60))
        .build()
        .map_err(|_| "Could not initialize prompt drafting".to_owned())?
        .post(url)
        .bearer_auth(config.api_key.expose_secret())
        .json(&serde_json::json!({
            "model": "kimi-k2.6",
            "messages": [
                {
                    "role": "system",
                    "content": "Write one practical system prompt for a remote coding agent. Return only the prompt, 90-160 words, in plain text. State role, priorities, operating style, safety boundaries, and how to report results. Do not mention this request, token limits, or add markdown fences. Stay under 160 words even if the model ignores output limits."
                },
                {"role": "user", "content": keywords}
            ],
            "temperature": 0.4
        }))
        .send()
        .map_err(|error| {
            if error.is_timeout() {
                "Could not reach HyperCLI inference within 60 seconds. Check the connection and try again."
                    .to_owned()
            } else if error.is_connect() {
                "Could not connect to the configured HyperCLI inference endpoint. Check the connection and API URL."
                    .to_owned()
            } else {
                "The prompt drafting request could not be completed. Check the connection and try again."
                    .to_owned()
            }
        })?;
    if !response.status().is_success() {
        return Err(prompt_drafting_status_error(response.status().as_u16()));
    }
    let completion: ChatCompletionResponse = response
        .json()
        .map_err(|_| "Prompt drafting returned an invalid response".to_owned())?;
    let prompt = completion
        .choices
        .into_iter()
        .next()
        .map(|choice| choice.message.content.trim().to_owned())
        .filter(|value| (40..=4000).contains(&value.len()))
        .ok_or_else(|| "Prompt drafting returned no usable text".to_owned())?;
    Ok(prompt)
}

#[tauri::command]
async fn draft_agent_prompt(keywords: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || draft_agent_prompt_blocking(keywords))
        .await
        .map_err(|error| error.to_string())?
}

fn checked_agent_id(agent_id: &str) -> Result<String, String> {
    uuid::Uuid::parse_str(agent_id.trim())
        .map(|value| value.to_string())
        .map_err(|_| "Invalid agent id".to_owned())
}

fn list_agents_blocking() -> Result<Vec<DesktopAgent>, String> {
    let capacity = managed_client()?
        .list_deployments_with_capacity()
        .map_err(|error| error.to_string())?;
    Ok(capacity.items.into_iter().map(DesktopAgent::from).collect())
}

fn get_agent_detail_blocking(agent_id: String) -> Result<DesktopAgentDetail, String> {
    let agent_id = checked_agent_id(&agent_id)?;
    let deployment = managed_client()?
        .get_deployment(&agent_id)
        .map_err(|error| error.to_string())?;
    if !deployment.is_buzz_managed() {
        return Err("Only Buzz-managed agents can be edited here".to_owned());
    }
    let runtime = deployment_runtime(&deployment)?;
    let env = launch_env(&deployment.launch_config)?;
    let additional_env = env
        .iter()
        .filter(|(key, _)| !is_protected_launch_env(key) && !is_secret_env_key(key))
        .map(|(key, value)| (key.clone(), value.clone()))
        .collect();
    let secret_env_keys = env
        .keys()
        .filter(|key| !is_protected_launch_env(key) && is_secret_env_key(key))
        .cloned()
        .collect();
    let agent_public_key = buzz_agent_public_key(&deployment);
    let stored_agent = buzz_connection_repository()
        .and_then(|repository| repository.load().map_err(|error| error.to_string()))
        .ok()
        .and_then(|document| {
            document
                .agents
                .into_iter()
                .find(|agent| agent.deployment_id.as_deref() == Some(deployment.id.as_str()))
        });
    let community = deployment
        .tags
        .iter()
        .find_map(|tag| tag.strip_prefix("buzz_community=").map(str::to_owned))
        .or_else(|| {
            deployment
                .tags
                .iter()
                .find_map(|tag| tag.strip_prefix("buzz_channel=").map(str::to_owned))
        })
        .or_else(|| {
            stored_agent
                .as_ref()
                .and_then(|agent| agent.channels.first().map(|channel| channel.id.clone()))
        })
        .unwrap_or_default();
    let connection_id = stored_agent
        .as_ref()
        .map(|agent| agent.connection_id.clone());
    let recent_communities = stored_agent
        .as_ref()
        .map(|agent| {
            agent
                .channels
                .iter()
                .map(|channel| channel.id.clone())
                .collect()
        })
        .unwrap_or_default();

    Ok(DesktopAgentDetail {
        id: deployment.id,
        name: env_value(&env, "BUZZ_ACP_DISPLAY_NAME").unwrap_or(deployment.name),
        runtime: runtime_id(runtime).to_owned(),
        state: normalized_state(&deployment.state),
        size: deployment.requested_size,
        instructions: env_value(&env, "BUZZ_ACP_SYSTEM_PROMPT").unwrap_or_default(),
        avatar_url: env_value(&env, "BUZZ_PROFILE_PICTURE"),
        model: env_value(&env, "BUZZ_ACP_MODEL"),
        concurrency: env_value(&env, "BUZZ_ACP_AGENTS").and_then(|value| value.parse().ok()),
        sync_all: launch_syncs_all(&deployment.launch_config),
        relay: env_value(&env, "BUZZ_RELAY_URL").unwrap_or_default(),
        community,
        connection_id,
        respond_to: match env_value(&env, "BUZZ_ACP_RESPOND_TO").as_deref() {
            Some("owner") | None => "owner-only".to_owned(),
            Some(value) => value.to_owned(),
        },
        allowlist: split_env_list(env_value(&env, "BUZZ_ACP_RESPOND_TO_ALLOWLIST")),
        env: additional_env,
        secret_env_keys,
        agent_public_key,
        recent_communities,
    })
}

#[tauri::command]
async fn get_agent_detail(agent_id: String) -> Result<DesktopAgentDetail, String> {
    tauri::async_runtime::spawn_blocking(move || get_agent_detail_blocking(agent_id))
        .await
        .map_err(|error| error.to_string())?
}

fn runtime_auth_status_blocking(
    agent_id: String,
    runtime_hint: String,
) -> Result<DesktopRuntimeAuthStatus, String> {
    let agent_id = checked_agent_id(&agent_id)?;
    let client = managed_client()?;
    let deployment = client
        .get_deployment(&agent_id)
        .map_err(|error| error.to_string())?;
    let runtime = deployment_runtime(&deployment)?;
    let native = native_runtime(runtime).ok_or_else(|| {
        "This runtime uses HyperCLI inference and does not need a vendor login".to_owned()
    })?;
    if native.as_str() != runtime_hint.trim() {
        return Err("Runtime changed; refresh the agent before checking login".to_owned());
    }
    if normalized_state(&deployment.state) != "running" {
        return Ok(DesktopRuntimeAuthStatus {
            authenticated: None,
            status: "stopped".to_owned(),
            detail: "Start the agent to check its native login.".to_owned(),
        });
    }
    let status = client
        .runtime_auth_status(&agent_id)
        .map_err(|error| error.to_string())?;
    if status.runtime != native {
        return Err("Runtime auth wrapper reported the wrong runtime".to_owned());
    }
    Ok(DesktopRuntimeAuthStatus {
        authenticated: Some(status.authenticated),
        status: if status.authenticated {
            "authenticated"
        } else {
            "login_required"
        }
        .to_owned(),
        detail: if status.authenticated {
            "Native runtime login is available in the synced agent home."
        } else {
            "Log in once; credentials persist across stop and restart."
        }
        .to_owned(),
    })
}

#[tauri::command]
async fn runtime_auth_status(
    agent_id: String,
    runtime: String,
) -> Result<DesktopRuntimeAuthStatus, String> {
    tauri::async_runtime::spawn_blocking(move || runtime_auth_status_blocking(agent_id, runtime))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn begin_runtime_login(
    sessions: tauri::State<'_, RuntimeLoginSessions>,
    agent_id: String,
    runtime: String,
) -> Result<DesktopRuntimeLoginChallenge, String> {
    let agent_id = checked_agent_id(&agent_id)?;
    let lookup_id = agent_id.clone();
    let runtime_hint = runtime.trim().to_owned();
    let (token, native) = tauri::async_runtime::spawn_blocking(move || {
        let client = managed_client()?;
        let deployment = client
            .get_deployment(&lookup_id)
            .map_err(|error| error.to_string())?;
        if normalized_state(&deployment.state) != "running" {
            return Err("Start the agent before logging in".to_owned());
        }
        let native = native_runtime(deployment_runtime(&deployment)?)
            .ok_or_else(|| "This runtime does not require a vendor login".to_owned())?;
        if native.as_str() != runtime_hint {
            return Err("Runtime changed; refresh the agent before logging in".to_owned());
        }
        let token = client
            .create_runtime_shell_token(&lookup_id, Some("/bin/bash"))
            .map_err(|error| error.to_string())?;
        Ok::<_, String>((token, native))
    })
    .await
    .map_err(|error| error.to_string())??;

    if let Some(previous) = sessions.sessions.lock().await.remove(&agent_id) {
        previous.lock().await.cancel().await;
    }
    let session = RuntimeLoginSession::connect(token, native, Duration::from_secs(45))
        .await
        .map_err(|error| error.to_string())?;
    let challenge = session.challenge().clone();
    if !challenge.completed {
        sessions
            .sessions
            .lock()
            .await
            .insert(agent_id, Arc::new(AsyncMutex::new(session)));
    }

    Ok(challenge.into())
}

#[tauri::command]
async fn poll_runtime_login(
    sessions: tauri::State<'_, RuntimeLoginSessions>,
    agent_id: String,
) -> Result<DesktopRuntimeLoginChallenge, String> {
    let agent_id = checked_agent_id(&agent_id)?;
    let session = sessions
        .sessions
        .lock()
        .await
        .get(&agent_id)
        .cloned()
        .ok_or_else(|| "No runtime login is active for this agent".to_owned())?;
    let mut session_guard = session.lock().await;
    let challenge = match session_guard.refresh(Duration::from_millis(500)).await {
        Ok(challenge) => challenge,
        Err(RuntimeAuthError::ChallengeTimeout(_)) => session_guard.challenge().clone(),
        Err(error) => {
            session_guard.cancel().await;
            drop(session_guard);
            sessions.sessions.lock().await.remove(&agent_id);
            return Err(error.to_string());
        }
    };
    let finished = challenge.completed;
    if finished {
        session_guard.cancel().await;
    }
    drop(session_guard);
    if finished {
        sessions.sessions.lock().await.remove(&agent_id);
    }
    Ok(challenge.into())
}

#[tauri::command]
async fn send_runtime_login_input(
    sessions: tauri::State<'_, RuntimeLoginSessions>,
    agent_id: String,
    value: String,
) -> Result<(), String> {
    let agent_id = checked_agent_id(&agent_id)?;
    if value.is_empty() || value.len() > 4096 {
        return Err("Login input must be between 1 and 4096 characters".to_owned());
    }
    let session = sessions
        .sessions
        .lock()
        .await
        .get(&agent_id)
        .cloned()
        .ok_or_else(|| "No runtime login is active for this agent".to_owned())?;
    let result = session
        .lock()
        .await
        .send_input(&value)
        .await
        .map_err(|error| error.to_string());
    result
}

#[tauri::command]
async fn cancel_runtime_login(
    sessions: tauri::State<'_, RuntimeLoginSessions>,
    agent_id: String,
) -> Result<(), String> {
    let agent_id = checked_agent_id(&agent_id)?;
    if let Some(session) = sessions.sessions.lock().await.remove(&agent_id) {
        session.lock().await.cancel().await;
    }
    Ok(())
}

fn set_optional_env(env: &mut BTreeMap<String, String>, key: &str, value: Option<String>) {
    match value
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
    {
        Some(value) => {
            env.insert(key.to_owned(), value);
        }
        None => {
            env.remove(key);
        }
    }
}

fn validate_editor_input(input: &AgentEditorInput) -> Result<(), String> {
    if input.avatar_remove && input.avatar_upload_id.is_some() {
        return Err("Choose a new agent image or remove it, not both".to_owned());
    }
    let name = input.name.trim();
    if name.is_empty() || name.len() > 32 {
        return Err("Agent name must be between 1 and 32 characters".to_owned());
    }
    if input.instructions.len() > 64 * 1024 {
        return Err("Agent instructions are too large".to_owned());
    }
    if let Some(avatar_url) = input
        .avatar_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        if avatar_url.len() > 2048
            || !(avatar_url.starts_with("https://") || avatar_url.starts_with("http://"))
            || avatar_url.chars().any(char::is_control)
        {
            return Err("Avatar must be an http:// or https:// URL".to_owned());
        }
    }
    if input.relay.trim().is_empty()
        || !(input.relay.trim().starts_with("wss://") || input.relay.trim().starts_with("ws://"))
    {
        return Err("Relay must be a ws:// or wss:// URL".to_owned());
    }
    if !matches!(
        input.respond_to.trim(),
        "owner-only" | "allowlist" | "anyone"
    ) {
        return Err("Invalid respond-to policy".to_owned());
    }
    if input.respond_to.trim() == "allowlist" && input.allowlist.is_empty() {
        return Err("Selected people requires at least one npub or nickname".to_owned());
    }
    if input.allowlist.len() > 64 {
        return Err("Selected people supports at most 64 entries".to_owned());
    }
    if let Some(concurrency) = input.concurrency {
        if !(1..=32).contains(&concurrency) {
            return Err("Concurrency must be between 1 and 32".to_owned());
        }
    }
    for entry in &input.allowlist {
        if entry.trim().is_empty()
            || entry.len() > 256
            || entry.chars().any(char::is_control)
            || entry.contains(',')
        {
            return Err("Allowlist entries must be one npub or nickname per line".to_owned());
        }
    }
    validate_additional_env(&input.env)
}

fn wait_for_stopped(client: &HyperCliClient, deployment: Deployment) -> Result<Deployment, String> {
    if normalized_state(&deployment.state) == "stopped" {
        return Ok(deployment);
    }
    tauri::async_runtime::block_on(client.wait_deployment_state(
        &deployment.id,
        &["stopped"],
        &[],
        RESTART_STOP_TIMEOUT,
    ))
    .map_err(|error| format!("Agent is still stopping: {error}"))
}

fn save_agent_blocking(agent_id: String, input: AgentEditorInput) -> Result<DesktopAgent, String> {
    validate_editor_input(&input)?;
    let agent_id = checked_agent_id(&agent_id)?;
    let client = managed_client()?;
    let current = client
        .get_deployment(&agent_id)
        .map_err(|error| error.to_string())?;
    if !current.is_buzz_managed() {
        return Err("Only Buzz-managed agents can be edited here".to_owned());
    }
    let runtime = deployment_runtime(&current)?;
    if parse_editor_runtime(&input.runtime)? != runtime {
        return Err("Changing runtimes requires cloning this Buzz agent".to_owned());
    }

    let original_config = current.launch_config.as_map().clone();
    let mut launch_config = original_config.clone();
    let mut env = launch_env(&current.launch_config)?;
    let stored_relay = env_value(&env, "BUZZ_RELAY_URL").unwrap_or_default();
    if !stored_relay.is_empty() && stored_relay != input.relay.trim() {
        return Err("Moving an agent to another relay/community requires Clone or Move".to_owned());
    }
    let stored_community = current
        .tags
        .iter()
        .find_map(|tag| tag.strip_prefix("buzz_community="))
        .or_else(|| {
            current
                .tags
                .iter()
                .find_map(|tag| tag.strip_prefix("buzz_channel="))
        });
    if let Some(stored_community) = stored_community {
        if stored_community != input.community.trim() {
            return Err(
                "Moving an agent to another relay/community requires Clone or Move".to_owned(),
            );
        }
    }

    env.retain(|key, _| is_protected_launch_env(key) || is_secret_env_key(key));
    env.extend(input.env.clone());
    env.insert("BUZZ_RELAY_URL".to_owned(), input.relay.trim().to_owned());
    set_optional_env(
        &mut env,
        "BUZZ_ACP_SYSTEM_PROMPT",
        Some(input.instructions.clone()),
    );
    env.insert(
        "BUZZ_ACP_DISPLAY_NAME".to_owned(),
        input.name.trim().to_owned(),
    );
    set_optional_env(&mut env, "BUZZ_PROFILE_PICTURE", input.avatar_url.clone());
    env.insert(
        "BUZZ_ACP_RESPOND_TO".to_owned(),
        input.respond_to.trim().to_owned(),
    );
    set_optional_env(
        &mut env,
        "BUZZ_ACP_RESPOND_TO_ALLOWLIST",
        (input.respond_to.trim() == "allowlist").then(|| {
            input
                .allowlist
                .iter()
                .map(|value| value.trim())
                .collect::<Vec<_>>()
                .join(",")
        }),
    );
    env.remove("BUZZ_ACP_AGENTS");
    if let Some(concurrency) = input.concurrency {
        env.insert("BUZZ_ACP_AGENTS".to_owned(), concurrency.to_string());
    }

    let model = input
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    let hypercli_native_opt_in =
        env.get("HYPERCLI_RUNTIME_INFERENCE").map(String::as_str) == Some("hypercli");
    if native_runtime(runtime).is_some() && model.is_some() && !hypercli_native_opt_in {
        return Err(
            "Native Claude, Codex, and Kimi choose models from their own login/config; leave Model blank"
                .to_owned(),
        );
    }
    set_optional_env(
        &mut env,
        "BUZZ_ACP_MODEL",
        (native_runtime(runtime).is_none() || hypercli_native_opt_in)
            .then(|| model.map(str::to_owned))
            .flatten(),
    );
    insert_launch_env(&mut launch_config, env);
    if let Some(sync_all) = input.sync_all {
        apply_editor_sync_policy(&mut launch_config, runtime, sync_all);
    }

    let requested_size = parse_editor_size(input.size.as_deref())?;
    let size_changed =
        requested_size.filter(|size| current.requested_size.as_deref() != Some(size.as_str()));
    let deployment_name = buzz_agent_public_key(&current)
        .map(|public_key| hypercli_sdk::canonical_deployment_name(input.name.trim(), &public_key))
        .unwrap_or_else(|| current.name.clone());
    let name_changed = (deployment_name != current.name).then_some(deployment_name);
    let config_changed =
        (launch_config != original_config).then(|| DeploymentLaunchConfig::from_map(launch_config));
    if name_changed.is_none() && size_changed.is_none() && config_changed.is_none() {
        return Ok(DesktopAgent::from(current));
    }

    let was_running = normalized_state(&current.state) == "running";
    let mut stopped = current;
    if was_running {
        stopped = client
            .stop_deployment(&agent_id)
            .map_err(|error| error.to_string())?;
        stopped = wait_for_stopped(&client, stopped)?;
    }
    let updated = client
        .update_deployment(
            &agent_id,
            &UpdateDeploymentRequest {
                name: name_changed,
                size: size_changed,
                launch_config: config_changed,
                ..Default::default()
            },
        )
        .map_err(|error| error.to_string())?;
    if was_running {
        client
            .start_deployment(&agent_id, &StartDeploymentRequest::default())
            .map(DesktopAgent::from)
            .map_err(|error| error.to_string())
    } else {
        let _ = stopped;
        Ok(DesktopAgent::from(updated))
    }
}

struct PreparedAgentProfileUpdate {
    relay: String,
    agent_keys: nostr::Keys,
    auth_tag: SecretString,
    event: NostrEvent,
}

fn prepare_agent_profile_update_blocking(
    agent_id: String,
    input: &AgentEditorInput,
) -> Result<PreparedAgentProfileUpdate, String> {
    let agent_id = checked_agent_id(&agent_id)?;
    let deployment = managed_client()?
        .get_deployment(&agent_id)
        .map_err(|error| error.to_string())?;
    if !deployment.is_buzz_managed() {
        return Err("Only Buzz-managed agents can be edited here".to_owned());
    }
    let env = launch_env(&deployment.launch_config)?;
    let private_key = env_value(&env, "BUZZ_PRIVATE_KEY").ok_or_else(|| {
        "This legacy deployment has no recoverable Buzz agent identity".to_owned()
    })?;
    let auth_tag = env_value(&env, "BUZZ_AUTH_TAG").ok_or_else(|| {
        "This legacy deployment has no recoverable Buzz owner attestation".to_owned()
    })?;
    let relay = env_value(&env, "BUZZ_RELAY_URL")
        .ok_or_else(|| "This legacy deployment has no recoverable Buzz relay".to_owned())?;
    let identity = AgentIdentity::from_nsec(&SecretString::from(private_key))
        .map_err(|error| error.to_string())?;
    if deployment
        .tags
        .iter()
        .find_map(|tag| tag.strip_prefix("buzz_agent="))
        .is_some_and(|public_key| public_key != identity.public_hex())
    {
        return Err("Stored Buzz identity does not match this deployment".to_owned());
    }
    let auth_tag = SecretString::from(auth_tag);
    let event = build_agent_profile_event(
        &identity,
        input.name.trim(),
        input.avatar_url.as_deref(),
        Some(input.instructions.trim()),
        &auth_tag,
    )
    .map_err(|error| error.to_string())?;
    Ok(PreparedAgentProfileUpdate {
        relay,
        agent_keys: identity.keys(),
        auth_tag,
        event,
    })
}

fn apply_avatar_change_blocking(
    agent_id: &str,
    input: &mut AgentEditorInput,
    staged: Option<StagedAvatar>,
) -> Result<(), String> {
    let client = managed_client()?;
    if let Some(staged) = staged {
        let uploaded = client
            .upload_deployment_profile_image(agent_id, &staged.content, &staged.content_type)
            .map_err(|error| error.to_string())?;
        input.avatar_url = uploaded.avatar_url;
    } else if input.avatar_remove {
        client
            .delete_deployment_profile_image(agent_id)
            .map_err(|error| error.to_string())?;
        input.avatar_url = None;
    }
    input.avatar_upload_id = None;
    input.avatar_remove = false;
    Ok(())
}

#[tauri::command]
async fn save_agent(
    uploads: tauri::State<'_, StagedAvatarUploads>,
    agent_id: String,
    input: AgentEditorInput,
) -> Result<DesktopAgent, String> {
    let mut input = input;
    if input.respond_to.trim() == "allowlist" {
        let lookup_id = checked_agent_id(&agent_id)?;
        let lookup = tauri::async_runtime::spawn_blocking(move || {
            let repository = buzz_connection_repository()?;
            let document = repository.load().map_err(|error| error.to_string())?;
            let Some(agent) = document
                .agents
                .iter()
                .find(|agent| agent.deployment_id.as_deref() == Some(lookup_id.as_str()))
            else {
                return Ok::<_, String>(None);
            };
            let connection = document
                .connections
                .iter()
                .find(|connection| connection.id == agent.connection_id)
                .ok_or_else(|| "Saved Buzz connection not found".to_owned())?;
            let signer = repository
                .owner_signer(&connection.id)
                .map_err(|error| error.to_string())?;
            Ok(Some((
                connection.relay_url.clone(),
                signer.keys(),
                agent
                    .channels
                    .iter()
                    .map(|channel| channel.id.clone())
                    .collect::<Vec<_>>(),
            )))
        })
        .await
        .map_err(|error| error.to_string())??;
        if let Some((relay, signer, channels)) = lookup {
            input.allowlist =
                resolve_buzz_allowlist(&relay, signer, &channels, &input.allowlist).await?;
        } else {
            let explicit = input
                .allowlist
                .iter()
                .map(|entry| explicit_allowlist_public_key(entry))
                .collect::<Result<Vec<_>, _>>()?;
            if explicit.iter().any(Option::is_none) {
                return Err(
                    "Nickname lookup is unavailable for this legacy agent; enter npubs instead"
                        .to_owned(),
                );
            }
            input.allowlist = resolve_allowlist_entries(&input.allowlist, &[], &[], &[])?;
        }
    } else {
        input.allowlist.clear();
    }
    let staged = take_staged_avatar(&uploads, input.avatar_upload_id.as_deref())?;
    let avatar_agent_id = checked_agent_id(&agent_id)?;
    input = tauri::async_runtime::spawn_blocking(move || {
        let mut input = input;
        apply_avatar_change_blocking(&avatar_agent_id, &mut input, staged)?;
        Ok::<_, String>(input)
    })
    .await
    .map_err(|error| error.to_string())??;
    let profile_agent_id = agent_id.clone();
    let profile_input = input.clone();
    let profile = tauri::async_runtime::spawn_blocking(move || {
        prepare_agent_profile_update_blocking(profile_agent_id, &profile_input)
    })
    .await
    .map_err(|error| error.to_string())??;
    let updated =
        tauri::async_runtime::spawn_blocking(move || save_agent_blocking(agent_id, input))
            .await
            .map_err(|error| error.to_string())??;
    publish_signed_buzz_event_http(
        &profile.relay,
        &profile.agent_keys,
        &profile.event,
        Some(&profile.auth_tag),
    )
    .await
    .map_err(|error| format!("Deployment saved, but Buzz profile update failed: {error}"))?;
    Ok(updated)
}

async fn publish_buzz_events(
    relay: &str,
    signer: nostr::Keys,
    events: &[NostrEvent],
) -> Result<(), String> {
    let client = NostrClient::new(signer);
    client
        .add_relay(relay)
        .await
        .map_err(|_| "Could not configure the Buzz relay".to_owned())?;
    client
        .try_connect_relay(relay, Duration::from_secs(10))
        .await
        .map_err(|_| "Could not connect to the Buzz relay".to_owned())?;
    for event in events {
        let output = tokio::time::timeout(Duration::from_secs(20), client.send_event(event))
            .await
            .map_err(|_| "Buzz relay publish timed out".to_owned())?
            .map_err(|_| "Buzz relay rejected an enrollment event".to_owned())?;
        if output.success.is_empty() {
            client.disconnect().await;
            return Err("Buzz relay did not confirm the enrollment event".to_owned());
        }
    }
    client.disconnect().await;
    Ok(())
}

#[derive(Deserialize)]
struct BuzzEventSubmitResponse {
    accepted: bool,
}

fn relay_http_events_url(relay: &str) -> Result<String, String> {
    let relay = relay.trim().trim_end_matches('/');
    if let Some(suffix) = relay.strip_prefix("wss://") {
        return Ok(format!("https://{suffix}/events"));
    }
    if let Some(suffix) = relay.strip_prefix("ws://") {
        return Ok(format!("http://{suffix}/events"));
    }
    Err("Buzz relay must use ws:// or wss://".to_owned())
}

fn relay_http_query_url(relay: &str) -> Result<String, String> {
    relay_http_events_url(relay).map(|url| url.trim_end_matches("/events").to_owned() + "/query")
}

fn build_nip98_authorization(
    signer: &nostr::Keys,
    url: &str,
    body: &[u8],
) -> Result<String, String> {
    let payload = sha256::Hash::hash(body).to_string();
    let nonce = uuid::Uuid::new_v4().to_string();
    let tags = [
        NostrTag::parse(["u", url]).map_err(|_| "Could not sign Buzz request".to_owned())?,
        NostrTag::parse(["method", "POST"])
            .map_err(|_| "Could not sign Buzz request".to_owned())?,
        NostrTag::parse(["payload", payload.as_str()])
            .map_err(|_| "Could not sign Buzz request".to_owned())?,
        NostrTag::parse(["nonce", nonce.as_str()])
            .map_err(|_| "Could not sign Buzz request".to_owned())?,
    ];
    let event = NostrEventBuilder::new(NostrKind::HttpAuth, "")
        .tags(tags)
        .sign_with_keys(signer)
        .map_err(|_| "Could not sign Buzz request".to_owned())?;
    let event_json = serde_json::to_vec(&event)
        .map_err(|_| "Could not serialize Buzz authorization".to_owned())?;
    Ok(format!(
        "Nostr {}",
        base64::engine::general_purpose::STANDARD.encode(event_json)
    ))
}

async fn query_buzz_events_http(
    relay: &str,
    signer: &nostr::Keys,
    filters: Value,
) -> Result<Vec<NostrEvent>, String> {
    let url = relay_http_query_url(relay)?;
    let body = serde_json::to_vec(&filters)
        .map_err(|_| "Could not serialize the Buzz query".to_owned())?;
    let authorization = build_nip98_authorization(signer, &url, &body)?;
    let response = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "Could not configure the Buzz relay client".to_owned())?
        .post(&url)
        .header(reqwest::header::AUTHORIZATION, authorization)
        .header(reqwest::header::CONTENT_TYPE, "application/json")
        .body(body)
        .send()
        .await
        .map_err(|_| "Buzz relay query failed".to_owned())?;
    if !response.status().is_success() {
        return Err(format!("Buzz relay returned HTTP {}", response.status()));
    }
    response
        .json::<Vec<NostrEvent>>()
        .await
        .map_err(|_| "Buzz relay returned an invalid event list".to_owned())
}

async fn publish_signed_buzz_event_http(
    relay: &str,
    signer: &nostr::Keys,
    event: &NostrEvent,
    auth_tag: Option<&SecretString>,
) -> Result<(), String> {
    validate_buzz_event_author(signer, event)?;
    let url = relay_http_events_url(relay)?;
    let body =
        serde_json::to_vec(event).map_err(|_| "Could not serialize the Buzz event".to_owned())?;
    let authorization = build_nip98_authorization(signer, &url, &body)?;
    let client = reqwest::Client::builder()
        .connect_timeout(Duration::from_secs(10))
        .timeout(Duration::from_secs(20))
        .build()
        .map_err(|_| "Could not configure the Buzz relay client".to_owned())?;
    let mut request = client
        .post(url)
        .header(reqwest::header::AUTHORIZATION, authorization)
        .header(reqwest::header::CONTENT_TYPE, "application/json");
    if let Some(auth_tag) = auth_tag {
        request = request.header("x-auth-tag", auth_tag.expose_secret());
    }
    let response = request
        .body(body)
        .send()
        .await
        .map_err(|_| "Could not reach the Buzz relay".to_owned())?;
    if !response.status().is_success() {
        return Err("Buzz relay rejected the event".to_owned());
    }
    let result = response
        .json::<BuzzEventSubmitResponse>()
        .await
        .map_err(|_| "Buzz relay returned an invalid event response".to_owned())?;
    if !result.accepted {
        return Err("Buzz relay did not accept the event".to_owned());
    }
    Ok(())
}

fn validate_buzz_event_author(signer: &nostr::Keys, event: &NostrEvent) -> Result<(), String> {
    if event.pubkey == signer.public_key() {
        Ok(())
    } else {
        Err("Buzz event author does not match its publishing identity".to_owned())
    }
}

#[derive(Clone)]
struct PreparedBuzzLaunch {
    relay: String,
    connection_id: String,
    owner_keys: nostr::Keys,
    agent_keys: nostr::Keys,
    agent_public_hex: String,
    agent_npub: String,
    agent_nsec: SecretString,
    auth_tag: SecretString,
    channels: Vec<String>,
    enrollment_events: Vec<NostrEvent>,
    removal_events: Vec<NostrEvent>,
}

fn prepare_buzz_launch(input: &AgentEditorInput) -> Result<PreparedBuzzLaunch, String> {
    validate_editor_input(input)?;
    let connection_id = input
        .connection_id
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
        .ok_or_else(|| "Choose a saved Buzz connection".to_owned())?;
    let repository = buzz_connection_repository()?;
    let document = repository.load().map_err(|error| error.to_string())?;
    let connection = document
        .connections
        .iter()
        .find(|connection| connection.id == connection_id)
        .ok_or_else(|| "Saved Buzz connection not found".to_owned())?;
    if connection.relay_url != input.relay.trim() {
        return Err("Selected Buzz connection does not match the requested relay".to_owned());
    }
    let owner = repository
        .owner_signer(connection_id)
        .map_err(|error| error.to_string())?;
    let agent = AgentIdentity::generate();
    let auth_tag = build_owner_attestation(&owner, &agent.public_key(), "")
        .map_err(|error| error.to_string())?;
    let mut channels = input
        .channels
        .iter()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .collect::<Vec<_>>();
    if channels.is_empty() && !input.community.trim().is_empty() {
        channels.push(input.community.trim().to_owned());
    }
    channels.sort();
    channels.dedup();
    if channels.is_empty() {
        return Err("Choose at least one Buzz channel".to_owned());
    }
    let mut enrollment_events = Vec::new();
    let mut removal_events = Vec::new();
    for channel in &channels {
        enrollment_events.push(
            build_bot_enrollment_event(&owner, channel, &agent.public_key())
                .map_err(|error| error.to_string())?,
        );
        removal_events.push(
            build_bot_removal_event(&owner, channel, &agent.public_key())
                .map_err(|error| error.to_string())?,
        );
    }
    Ok(PreparedBuzzLaunch {
        relay: connection.relay_url.clone(),
        connection_id: connection.id.clone(),
        owner_keys: owner.keys(),
        agent_keys: agent.keys(),
        agent_public_hex: agent.public_hex(),
        agent_npub: agent.npub().map_err(|error| error.to_string())?,
        agent_nsec: agent.private_nsec().map_err(|error| error.to_string())?,
        auth_tag,
        channels,
        enrollment_events,
        removal_events,
    })
}

fn create_buzz_deployment_blocking(
    input: &AgentEditorInput,
    prepared: &PreparedBuzzLaunch,
) -> Result<Deployment, String> {
    let runtime = parse_editor_runtime(&input.runtime)?;
    let client = managed_client()?;
    let requested_size = match parse_editor_size(input.size.as_deref())? {
        Some(size) => size,
        None => client
            .list_deployments_with_capacity()
            .map_err(|error| error.to_string())?
            .largest_available_size()
            .ok_or_else(|| "No HyperCLI agent slot is currently available".to_owned())?,
    };
    let parallelism = input.concurrency.unwrap_or(match requested_size {
        AgentSize::Small => 2,
        AgentSize::Medium => 5,
        AgentSize::Large => 10,
    });
    let mut request = CreateDeploymentRequest::new(runtime);
    request.name = Some(hypercli_sdk::canonical_deployment_name(
        input.name.trim(),
        &prepared.agent_public_hex,
    ));
    request.env = input.env.clone();
    if let Some(avatar_url) = input
        .avatar_url
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty())
    {
        request
            .env
            .insert("BUZZ_PROFILE_PICTURE".to_owned(), avatar_url.to_owned());
    }
    let hypercli_native_opt_in = request
        .env
        .get("HYPERCLI_RUNTIME_INFERENCE")
        .map(String::as_str)
        == Some("hypercli");
    let model = input
        .model
        .as_deref()
        .map(str::trim)
        .filter(|value| !value.is_empty());
    if native_runtime(runtime).is_some() && model.is_some() && !hypercli_native_opt_in {
        return Err(
            "Native Claude, Codex, and Kimi choose models from their own login/config; leave Model blank"
                .to_owned(),
        );
    }
    let mut buzz = BuzzLaunchConfig::new(
        prepared.agent_nsec.expose_secret().to_owned(),
        prepared.relay.clone(),
    );
    buzz.auth_tag = Some(prepared.auth_tag.expose_secret().to_owned());
    buzz.system_prompt = Some(input.instructions.trim().to_owned());
    buzz.model = (native_runtime(runtime).is_none() || hypercli_native_opt_in)
        .then(|| model.map(str::to_owned))
        .flatten();
    buzz.parallelism = parallelism;
    buzz.respond_to = Some(input.respond_to.trim().to_owned());
    buzz.respond_to_allowlist = input
        .allowlist
        .iter()
        .map(|value| value.trim().to_owned())
        .collect();
    buzz.display_name = Some(input.name.trim().to_owned());
    buzz.apply_to(&mut request, Some(input.name.trim()))
        .map_err(|error| error.to_string())?;
    if input.sync_all.unwrap_or(false) {
        request.sync_include = None;
        request.sync_exclude = None;
    }
    request.size = Some(requested_size);
    request.mark_buzz_deployment(Some(&prepared.agent_public_hex));
    for channel in &prepared.channels {
        request.tags.push(format!("buzz_channel={channel}"));
    }
    let deployment = client
        .create_deployment(&request)
        .map_err(|error| error.to_string())?;
    // CREATE provisions only. Keep the runtime stopped until its durable
    // avatar, Buzz profile, and local ownership record have been installed.
    wait_for_stopped(&client, deployment)
}

fn sync_created_avatar_env_blocking(
    deployment_id: &str,
    avatar_url: Option<String>,
) -> Result<Deployment, String> {
    let deployment_id = checked_agent_id(deployment_id)?;
    let client = managed_client()?;
    let deployment = client
        .get_deployment(&deployment_id)
        .map_err(|error| error.to_string())?;
    let mut launch_config = deployment.launch_config.as_map().clone();
    let mut env = launch_env(&deployment.launch_config)?;
    set_optional_env(&mut env, "BUZZ_PROFILE_PICTURE", avatar_url);
    insert_launch_env(&mut launch_config, env);
    client
        .update_deployment(
            &deployment_id,
            &UpdateDeploymentRequest {
                launch_config: Some(DeploymentLaunchConfig::from_map(launch_config)),
                ..Default::default()
            },
        )
        .map_err(|error| error.to_string())
}

fn cleanup_created_deployment_blocking(agent_id: String) -> Result<(), String> {
    let agent_id = checked_agent_id(&agent_id)?;
    let client = managed_client()?;
    let mut deployment = client
        .get_deployment(&agent_id)
        .map_err(|error| error.to_string())?;
    if normalized_state(&deployment.state) != "stopped" {
        deployment = client
            .stop_deployment(&agent_id)
            .map_err(|error| error.to_string())?;
        wait_for_stopped(&client, deployment)?;
    }
    let deleted = client
        .delete_deployment(&agent_id)
        .map_err(|error| error.to_string())?;
    if deleted.ok && deleted.id == agent_id {
        Ok(())
    } else {
        Err("Backend did not confirm cleanup of the new agent".to_owned())
    }
}

#[tauri::command]
async fn create_buzz_agent(
    uploads: tauri::State<'_, StagedAvatarUploads>,
    input: AgentEditorInput,
) -> Result<DesktopAgent, String> {
    let mut input = input;
    if input.community.trim().is_empty() && input.channels.is_empty() {
        return Err("Choose at least one Buzz channel".to_owned());
    }
    let prepare_input = input.clone();
    let prepared =
        tauri::async_runtime::spawn_blocking(move || prepare_buzz_launch(&prepare_input))
            .await
            .map_err(|error| error.to_string())??;
    if input.respond_to.trim() == "allowlist" {
        input.allowlist = resolve_buzz_allowlist(
            &prepared.relay,
            prepared.owner_keys.clone(),
            &prepared.channels,
            &input.allowlist,
        )
        .await?;
    } else {
        input.allowlist.clear();
    }
    let staged = take_staged_avatar(&uploads, input.avatar_upload_id.as_deref())?;
    let launch_input = input.clone();
    let deployment = match tauri::async_runtime::spawn_blocking({
        let prepared = prepared.clone();
        move || create_buzz_deployment_blocking(&launch_input, &prepared)
    })
    .await
    .map_err(|error| error.to_string())?
    {
        Ok(deployment) => deployment,
        Err(error) => {
            return Err(error);
        }
    };

    if staged.is_some() || input.avatar_remove {
        let avatar_id = deployment.id.clone();
        let avatar_result = tauri::async_runtime::spawn_blocking(move || {
            let mut input = input;
            apply_avatar_change_blocking(&avatar_id, &mut input, staged)?;
            sync_created_avatar_env_blocking(&avatar_id, input.avatar_url.clone())?;
            Ok::<_, String>(input)
        })
        .await
        .map_err(|error| error.to_string())?;
        match avatar_result {
            Ok(updated_input) => input = updated_input,
            Err(error) => {
                let cleanup_id = deployment.id.clone();
                let _ = tauri::async_runtime::spawn_blocking(move || {
                    cleanup_created_deployment_blocking(cleanup_id)
                })
                .await;
                return Err(error);
            }
        }
    } else {
        input.avatar_upload_id = None;
        input.avatar_remove = false;
    }

    let profile_identity =
        AgentIdentity::from_nsec(&prepared.agent_nsec).map_err(|error| error.to_string())?;
    let profile_event = build_agent_profile_event(
        &profile_identity,
        input.name.trim(),
        input.avatar_url.as_deref(),
        Some(input.instructions.trim()),
        &prepared.auth_tag,
    )
    .map_err(|error| error.to_string())?;
    let profile_result = publish_signed_buzz_event_http(
        &prepared.relay,
        &prepared.agent_keys,
        &profile_event,
        Some(&prepared.auth_tag),
    )
    .await;
    let publish_result = match profile_result {
        Ok(()) => {
            publish_buzz_events(
                &prepared.relay,
                prepared.owner_keys.clone(),
                &prepared.enrollment_events,
            )
            .await
        }
        Err(error) => Err(error),
    };
    if let Err(error) = publish_result {
        let cleanup_id = deployment.id.clone();
        let backend_cleanup = tauri::async_runtime::spawn_blocking(move || {
            cleanup_created_deployment_blocking(cleanup_id)
        })
        .await
        .map_err(|join_error| join_error.to_string())?;
        let relay_cleanup = publish_buzz_events(
            &prepared.relay,
            prepared.owner_keys.clone(),
            &prepared.removal_events,
        )
        .await;
        let mut failures = vec![error];
        if let Err(cleanup_error) = backend_cleanup {
            failures.push(format!("backend cleanup failed: {cleanup_error}"));
        }
        if let Err(cleanup_error) = relay_cleanup {
            failures.push(format!("Buzz cleanup failed: {cleanup_error}"));
        }
        return Err(failures.join("; "));
    }

    let metadata = ManagedBuzzAgentMetadata {
        agent_public_hex: prepared.agent_public_hex.clone(),
        agent_npub: prepared.agent_npub.clone(),
        connection_id: prepared.connection_id.clone(),
        channels: prepared
            .channels
            .iter()
            .cloned()
            .map(|id| ChannelReference {
                name: id.clone(),
                id,
            })
            .collect(),
        deployment_id: Some(deployment.id.clone()),
        runtime: input.runtime.clone(),
        tags: BTreeMap::from([("app".to_owned(), "buzz".to_owned())]),
    };
    let record_result = tauri::async_runtime::spawn_blocking(move || {
        buzz_connection_repository()?
            .record_agent(metadata)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?;
    if let Err(record_error) = record_result {
        let cleanup_id = deployment.id.clone();
        let cleanup = tauri::async_runtime::spawn_blocking(move || {
            cleanup_created_deployment_blocking(cleanup_id)
        })
        .await
        .map_err(|error| error.to_string())?;
        let relay_cleanup = publish_buzz_events(
            &prepared.relay,
            prepared.owner_keys.clone(),
            &prepared.removal_events,
        )
        .await;
        let mut failures = vec![format!(
            "Could not save local Buzz metadata: {record_error}"
        )];
        if let Err(error) = cleanup {
            failures.push(format!("backend cleanup failed: {error}"));
        }
        if let Err(error) = relay_cleanup {
            failures.push(format!("Buzz cleanup failed: {error}"));
        }
        return Err(failures.join("; "));
    }
    let started_id = deployment.id.clone();
    tauri::async_runtime::spawn_blocking(move || {
        managed_client()?
            .start_deployment(&started_id, &StartDeploymentRequest::default())
            .map(DesktopAgent::from)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

const SSH_STATUS_COMMAND: &str = r#"set -eu
for key in "$HOME/.ssh/id_ed25519.pub"; do
  if [ -s "$key" ]; then
    printf 'PUBLIC=%s\n' "$(cat "$key")"
    printf 'FINGERPRINT=%s\n' "$(ssh-keygen -lf "$key" | cut -d' ' -f2-)"
    exit 0
  fi
done
exit 0"#;

const SSH_GENERATE_COMMAND: &str = r#"set -eu
umask 077
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
if [ ! -s "$HOME/.ssh/id_ed25519" ]; then
  ssh-keygen -q -t ed25519 -N '' -C hypercli-buzz -f "$HOME/.ssh/id_ed25519"
fi
chmod 600 "$HOME/.ssh/id_ed25519"
chmod 644 "$HOME/.ssh/id_ed25519.pub"
printf 'PUBLIC=%s\n' "$(cat "$HOME/.ssh/id_ed25519.pub")"
printf 'FINGERPRINT=%s\n' "$(ssh-keygen -lf "$HOME/.ssh/id_ed25519.pub" | cut -d' ' -f2-)""#;

const SSH_IMPORT_PREPARE_COMMAND: &str = r#"set -eu
umask 077
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
rm -f "$HOME/.ssh/.id_ed25519.hypercli-import" "$HOME/.ssh/.id_ed25519.hypercli-import.pub""#;

const SSH_IMPORT_FINALIZE_COMMAND: &str = r#"set -eu
umask 077
mkdir -p "$HOME/.ssh"
chmod 700 "$HOME/.ssh"
incoming="$HOME/.ssh/.id_ed25519.hypercli-import"
incoming_pub="$incoming.pub"
trap 'rm -f "$incoming" "$incoming_pub"' EXIT
if [ -e "$HOME/.ssh/id_ed25519" ] || [ -e "$HOME/.ssh/id_ed25519.pub" ]; then
  printf 'An SSH identity is already installed\n' >&2
  exit 21
fi
chmod 600 "$incoming"
ssh-keygen -y -P '' -f "$incoming" > "$incoming_pub"
chmod 644 "$incoming_pub"
mv "$incoming" "$HOME/.ssh/id_ed25519"
mv "$incoming_pub" "$HOME/.ssh/id_ed25519.pub"
trap - EXIT
printf 'PUBLIC=%s\n' "$(cat "$HOME/.ssh/id_ed25519.pub")"
printf 'FINGERPRINT=%s\n' "$(ssh-keygen -lf "$HOME/.ssh/id_ed25519.pub" | cut -d' ' -f2-)""#;

fn parse_ssh_status(stdout: &str) -> DesktopSshKeyStatus {
    let public_key = stdout
        .lines()
        .find_map(|line| {
            line.strip_prefix("PUBLIC=")
                .map(str::trim)
                .map(str::to_owned)
        })
        .filter(|value| value.starts_with("ssh-"));
    let fingerprint = stdout
        .lines()
        .find_map(|line| {
            line.strip_prefix("FINGERPRINT=")
                .map(str::trim)
                .map(str::to_owned)
        })
        .filter(|value| !value.is_empty());
    DesktopSshKeyStatus {
        configured: public_key.is_some(),
        public_key,
        fingerprint,
    }
}

fn fixed_agent_exec(
    client: &HyperCliClient,
    agent_id: &str,
    command: &'static str,
) -> Result<DesktopSshKeyStatus, String> {
    let mut request = ExecDeploymentRequest::new(command);
    request.timeout = 30;
    let response = client
        .exec_deployment(agent_id, &request)
        .map_err(|error| error.to_string())?;
    if response.exit_code != 0 {
        return Err("SSH key operation failed inside the agent".to_owned());
    }
    Ok(parse_ssh_status(&response.stdout))
}

fn ssh_key_status_blocking(agent_id: String) -> Result<DesktopSshKeyStatus, String> {
    let agent_id = checked_agent_id(&agent_id)?;
    fixed_agent_exec(&managed_client()?, &agent_id, SSH_STATUS_COMMAND)
}

#[tauri::command]
async fn ssh_key_status(agent_id: String) -> Result<DesktopSshKeyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || ssh_key_status_blocking(agent_id))
        .await
        .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn generate_ssh_key(agent_id: String) -> Result<DesktopSshKeyStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent_id = checked_agent_id(&agent_id)?;
        fixed_agent_exec(&managed_client()?, &agent_id, SSH_GENERATE_COMMAND)
    })
    .await
    .map_err(|error| error.to_string())?
}

fn validate_private_ssh_key(path: &std::path::Path) -> Result<Vec<u8>, String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("SSH key imports cannot follow symbolic links".to_owned());
    }
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > 64 * 1024 {
        return Err("Choose a private SSH key smaller than 64 KiB".to_owned());
    }
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        if metadata.permissions().mode() & 0o077 != 0 {
            return Err(
                "Private SSH key permissions must not allow group or other access".to_owned(),
            );
        }
    }
    let mut content = fs::read(path).map_err(|error| error.to_string())?;
    let text = std::str::from_utf8(&content).map_err(|_| "SSH key must be UTF-8 PEM text")?;
    let valid_header = [
        "-----BEGIN OPENSSH PRIVATE KEY-----",
        "-----BEGIN RSA PRIVATE KEY-----",
        "-----BEGIN EC PRIVATE KEY-----",
    ]
    .iter()
    .any(|header| text.trim_start().starts_with(header));
    if !valid_header {
        return Err("The selected file is not a supported private SSH key".to_owned());
    }
    if !content.ends_with(b"\n") {
        content.push(b'\n');
    }
    Ok(content)
}

fn detect_avatar_content_type(content: &[u8]) -> Option<&'static str> {
    if content.starts_with(b"\x89PNG\r\n\x1a\n") {
        Some("image/png")
    } else if content.starts_with(b"\xff\xd8\xff") {
        Some("image/jpeg")
    } else if content.starts_with(b"GIF87a") || content.starts_with(b"GIF89a") {
        Some("image/gif")
    } else if content.len() >= 12 && &content[..4] == b"RIFF" && &content[8..12] == b"WEBP" {
        Some("image/webp")
    } else {
        None
    }
}

fn read_avatar_image(path: &std::path::Path) -> Result<(Vec<u8>, String), String> {
    let metadata = fs::symlink_metadata(path).map_err(|error| error.to_string())?;
    if metadata.file_type().is_symlink() {
        return Err("Agent images cannot follow symbolic links".to_owned());
    }
    if !metadata.is_file() || metadata.len() == 0 || metadata.len() > MAX_AVATAR_BYTES {
        return Err("Choose an image no larger than 2 MiB".to_owned());
    }
    let content = fs::read(path).map_err(|error| error.to_string())?;
    let content_type = detect_avatar_content_type(&content)
        .ok_or_else(|| "Choose a valid PNG, JPEG, GIF, or WebP image".to_owned())?;
    Ok((content, content_type.to_owned()))
}

#[tauri::command]
async fn pick_agent_avatar(
    app: tauri::AppHandle,
    uploads: tauri::State<'_, StagedAvatarUploads>,
) -> Result<Option<DesktopAvatarSelection>, String> {
    let Some(selected) = app
        .dialog()
        .file()
        .add_filter("Images", &["png", "jpg", "jpeg", "gif", "webp"])
        .blocking_pick_file()
    else {
        return Ok(None);
    };
    let path = selected
        .into_path()
        .map_err(|_| "The selected image is not a local file".to_owned())?;
    let file_name = path
        .file_name()
        .and_then(|name| name.to_str())
        .unwrap_or("Agent image")
        .to_owned();
    let (content, content_type) = read_avatar_image(&path)?;
    let upload_id = uuid::Uuid::new_v4().to_string();
    let preview_data_url = format!(
        "data:{content_type};base64,{}",
        base64::engine::general_purpose::STANDARD.encode(&content)
    );
    uploads
        .uploads
        .lock()
        .map_err(|_| "Agent image staging is unavailable".to_owned())?
        .insert(
            upload_id.clone(),
            StagedAvatar {
                content,
                content_type,
            },
        );
    Ok(Some(DesktopAvatarSelection {
        upload_id,
        preview_data_url,
        file_name,
    }))
}

#[tauri::command]
fn discard_agent_avatar(
    uploads: tauri::State<'_, StagedAvatarUploads>,
    upload_id: String,
) -> Result<(), String> {
    let upload_id = checked_upload_id(&upload_id)?;
    uploads
        .uploads
        .lock()
        .map_err(|_| "Agent image staging is unavailable".to_owned())?
        .remove(&upload_id);
    Ok(())
}

fn checked_upload_id(upload_id: &str) -> Result<String, String> {
    uuid::Uuid::parse_str(upload_id.trim())
        .map(|value| value.to_string())
        .map_err(|_| "Invalid agent image upload".to_owned())
}

fn take_staged_avatar(
    uploads: &StagedAvatarUploads,
    upload_id: Option<&str>,
) -> Result<Option<StagedAvatar>, String> {
    let Some(upload_id) = upload_id else {
        return Ok(None);
    };
    let upload_id = checked_upload_id(upload_id)?;
    uploads
        .uploads
        .lock()
        .map_err(|_| "Agent image staging is unavailable".to_owned())?
        .remove(&upload_id)
        .map(Some)
        .ok_or_else(|| "The selected agent image expired; choose it again".to_owned())
}

#[tauri::command]
async fn import_ssh_key(
    app: tauri::AppHandle,
    agent_id: String,
) -> Result<DesktopSshKeyStatus, String> {
    let ssh_directory = home_dir()?.join(".ssh");
    let mut picker = app.dialog().file().set_title("Attach an SSH private key");
    if ssh_directory.is_dir() {
        picker = picker.set_directory(ssh_directory);
    }
    let selected = picker
        .blocking_pick_file()
        .ok_or_else(|| "No SSH key selected".to_owned())?;
    let path = selected
        .into_path()
        .map_err(|_| "The selected key is not a local file".to_owned())?;
    tauri::async_runtime::spawn_blocking(move || {
        let agent_id = checked_agent_id(&agent_id)?;
        let content = validate_private_ssh_key(&path)?;
        let client = managed_client()?;
        let deployment = client
            .get_deployment(&agent_id)
            .map_err(|error| error.to_string())?;
        if normalized_state(&deployment.state) != "running" {
            return Err("Start the agent before importing an SSH key".to_owned());
        }
        fixed_agent_exec(&client, &agent_id, SSH_IMPORT_PREPARE_COMMAND)?;
        client
            .put_deployment_file(&agent_id, ".ssh/.id_ed25519.hypercli-import", &content)
            .map_err(|error| error.to_string())?;
        fixed_agent_exec(&client, &agent_id, SSH_IMPORT_FINALIZE_COMMAND)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn list_agents() -> Result<Vec<DesktopAgent>, String> {
    tauri::async_runtime::spawn_blocking(list_agents_blocking)
        .await
        .map_err(|error| error.to_string())?
}

fn start_agent_blocking(agent_id: String) -> Result<DesktopAgent, String> {
    let agent_id = checked_agent_id(&agent_id)?;
    let client = managed_client()?;
    let current = client
        .get_deployment(&agent_id)
        .map_err(|error| error.to_string())?;
    if !agent_actions(&current.state).start {
        return Err(format!(
            "Agent must be stopped before it can start (currently {})",
            normalized_state(&current.state)
        ));
    }
    client
        .start_deployment(&agent_id, &StartDeploymentRequest::default())
        .map(DesktopAgent::from)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn start_agent(agent_id: String) -> Result<DesktopAgent, String> {
    tauri::async_runtime::spawn_blocking(move || start_agent_blocking(agent_id))
        .await
        .map_err(|error| error.to_string())?
}

fn stop_agent_blocking(agent_id: String) -> Result<DesktopAgent, String> {
    let agent_id = checked_agent_id(&agent_id)?;
    let client = managed_client()?;
    let current = client
        .get_deployment(&agent_id)
        .map_err(|error| error.to_string())?;
    if !agent_actions(&current.state).stop {
        return Err(format!(
            "Agent cannot be stopped while it is {}",
            normalized_state(&current.state)
        ));
    }
    client
        .stop_deployment(&agent_id)
        .map(DesktopAgent::from)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn stop_agent(agent_id: String) -> Result<DesktopAgent, String> {
    tauri::async_runtime::spawn_blocking(move || stop_agent_blocking(agent_id))
        .await
        .map_err(|error| error.to_string())?
}

const RESTART_STOP_TIMEOUT: Duration = Duration::from_secs(60);

fn restart_agent_blocking(agent_id: String) -> Result<DesktopAgent, String> {
    let agent_id = checked_agent_id(&agent_id)?;
    let client = managed_client()?;
    let current = client
        .get_deployment(&agent_id)
        .map_err(|error| error.to_string())?;
    let state = normalized_state(&current.state);
    if state == "running" {
        client
            .stop_deployment(&agent_id)
            .map_err(|error| error.to_string())?;
        tauri::async_runtime::block_on(client.wait_deployment_state(
            &agent_id,
            &["stopped"],
            &[],
            RESTART_STOP_TIMEOUT,
        ))
        .map_err(|error| format!("Agent is still stopping: {error}"))?;
    } else if !agent_actions(&state).restart && state != "stopped" {
        return Err(format!("Agent cannot be restarted while it is {state}"));
    }

    client
        .start_deployment(&agent_id, &StartDeploymentRequest::default())
        .map(DesktopAgent::from)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn restart_agent(agent_id: String) -> Result<DesktopAgent, String> {
    tauri::async_runtime::spawn_blocking(move || restart_agent_blocking(agent_id))
        .await
        .map_err(|error| error.to_string())?
}

fn delete_agent_blocking(agent_id: String) -> Result<(), String> {
    let agent_id = checked_agent_id(&agent_id)?;
    let client = managed_client()?;
    let current = client
        .get_deployment(&agent_id)
        .map_err(|error| error.to_string())?;
    if !agent_actions(&current.state).delete {
        return Err(format!(
            "Only stopped agents can be deleted (currently {})",
            normalized_state(&current.state)
        ));
    }
    let deleted = client
        .delete_deployment(&agent_id)
        .map_err(|error| error.to_string())?;
    if !deleted.ok || deleted.id != agent_id {
        return Err("Backend did not confirm agent deletion".to_owned());
    }
    Ok(())
}

struct PreparedAgentRemoval {
    relay: String,
    signer: nostr::Keys,
    removal_events: Vec<NostrEvent>,
    rollback_events: Vec<NostrEvent>,
}

fn prepare_agent_removal_blocking(
    agent_id: String,
) -> Result<Option<PreparedAgentRemoval>, String> {
    let agent_id = checked_agent_id(&agent_id)?;
    let deployment = managed_client()?
        .get_deployment(&agent_id)
        .map_err(|error| error.to_string())?;
    if !agent_actions(&deployment.state).delete {
        return Err(format!(
            "Only stopped agents can be deleted (currently {})",
            normalized_state(&deployment.state)
        ));
    }
    let repository = buzz_connection_repository()?;
    let document = repository.load().map_err(|error| error.to_string())?;
    let Some(agent) = document
        .agents
        .iter()
        .find(|agent| agent.deployment_id.as_deref() == Some(agent_id.as_str()))
    else {
        return Ok(None);
    };
    let connection = document
        .connections
        .iter()
        .find(|connection| connection.id == agent.connection_id)
        .ok_or_else(|| "Saved Buzz connection not found".to_owned())?;
    let owner = repository
        .owner_signer(&connection.id)
        .map_err(|error| error.to_string())?;
    let agent_public_key = nostr::PublicKey::from_hex(&agent.agent_public_hex)
        .map_err(|_| "Stored Buzz agent public key is invalid".to_owned())?;
    let mut removal_events = Vec::new();
    let mut rollback_events = Vec::new();
    for channel in &agent.channels {
        removal_events.push(
            build_bot_removal_event(&owner, &channel.id, &agent_public_key)
                .map_err(|error| error.to_string())?,
        );
        rollback_events.push(
            build_bot_enrollment_event(&owner, &channel.id, &agent_public_key)
                .map_err(|error| error.to_string())?,
        );
    }
    Ok(Some(PreparedAgentRemoval {
        relay: connection.relay_url.clone(),
        signer: owner.keys(),
        removal_events,
        rollback_events,
    }))
}

#[tauri::command]
async fn delete_agent(agent_id: String) -> Result<(), String> {
    let prepare_id = agent_id.clone();
    let prepared =
        tauri::async_runtime::spawn_blocking(move || prepare_agent_removal_blocking(prepare_id))
            .await
            .map_err(|error| error.to_string())??;
    if let Some(prepared) = &prepared {
        if let Err(error) = publish_buzz_events(
            &prepared.relay,
            prepared.signer.clone(),
            &prepared.removal_events,
        )
        .await
        {
            let rollback = publish_buzz_events(
                &prepared.relay,
                prepared.signer.clone(),
                &prepared.rollback_events,
            )
            .await;
            return Err(match rollback {
                Ok(()) => format!("Could not remove the agent from Buzz: {error}"),
                Err(rollback_error) => format!(
                    "Could not remove the agent from Buzz: {error}; rollback also failed: {rollback_error}"
                ),
            });
        }
    }
    let delete_id = agent_id.clone();
    let deleted = tauri::async_runtime::spawn_blocking(move || delete_agent_blocking(delete_id))
        .await
        .map_err(|error| error.to_string())?;
    if let Err(error) = deleted {
        if let Some(prepared) = prepared {
            if let Err(rollback_error) =
                publish_buzz_events(&prepared.relay, prepared.signer, &prepared.rollback_events)
                    .await
            {
                return Err(format!(
                    "{error}; restoring Buzz membership also failed: {rollback_error}"
                ));
            }
        }
        return Err(error);
    }
    tauri::async_runtime::spawn_blocking(move || {
        buzz_connection_repository()?
            .forget_agent_by_deployment(&agent_id)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;
    Ok(())
}

/// Human-readable key annotation, e.g. "macOS (Dmitrys-Mac-mini)".
fn key_annotation() -> String {
    let os = match std::env::consts::OS {
        "macos" => "macOS",
        "windows" => "Windows",
        other => other,
    };
    let host = gethostname::gethostname().to_string_lossy().into_owned();
    format!("{os} ({host})")
}

/// Exchange a desktop-login session token for a durable, per-machine API
/// key and persist it. The session token is never stored.
fn mint_api_key_blocking(session_token: String) -> Result<String, String> {
    let name = key_annotation();
    // Honor the configured backend (HYPER_API_BASE et al.) so dev/feat logins
    // mint keys against the same environment validate_key checks.
    let api_base = discover_agents_api_base().map_err(|e| e.to_string())?;
    let client = HyperCliClient::new(ClientConfig {
        api_base,
        api_key: SecretString::from(session_token.trim().to_owned()),
        trace_file: None,
    })
    .map_err(|e| e.to_string())?;
    let mut request = CreateApiKeyRequest::new(name.clone());
    // Tags are scope grants in `family:baseline` grammar (deny-by-default
    // without them). Keep the grant list centralized and narrow: prompt
    // drafting is pinned to one model and SSH management uses files only.
    request.tags = DESKTOP_KEY_SCOPES
        .iter()
        .map(|scope| (*scope).to_owned())
        .collect();
    let key = client.create_api_key(&request).map_err(|e| e.to_string())?;
    let api_key = key
        .api_key
        .ok_or_else(|| "key created but response contained no key material".to_string())?;
    write_api_key(&home_dir()?, &api_key).map_err(|e| e.to_string())?;
    Ok(name)
}

#[tauri::command]
async fn mint_api_key(
    session_token: String,
    events: tauri::State<'_, DeploymentEventStream>,
) -> Result<String, String> {
    let result = tauri::async_runtime::spawn_blocking(move || mint_api_key_blocking(session_token))
        .await
        .map_err(|e| e.to_string())?;
    if result.is_ok() {
        events.restart();
    }
    result
}

/// Returns `true` when the running install supports Tauri's auto-updater.
///
/// On Linux, Tauri's updater only works for AppImage bundles. The AppImage
/// runtime sets the `APPIMAGE` environment variable when the binary is
/// executed from an AppImage; when it is absent (e.g. a `.deb` install) the
/// updater plugin would find an update but cannot swap the binary, producing
/// an "invalid binary format" error at install time. On macOS and Windows
/// every supported install format is auto-updatable.
#[tauri::command]
fn is_auto_update_supported() -> bool {
    #[cfg(target_os = "linux")]
    {
        std::env::var("APPIMAGE").is_ok()
    }
    #[cfg(not(target_os = "linux"))]
    {
        true
    }
}

/// Open the browser sign-in. The page redirects back to `hypercli://auth`
/// with the token in the URL fragment — the exact Backseat Driver pattern.
/// `HYPERCLI_DESKTOP_LOGIN_PAGE` overrides the page for dev/feat testing.
#[tauri::command]
fn open_plans(app: tauri::AppHandle) -> Result<(), String> {
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_url("https://agents.hypercli.com/plans", None::<String>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn start_login(app: tauri::AppHandle) -> Result<(), String> {
    let page = std::env::var("HYPERCLI_DESKTOP_LOGIN_PAGE")
        .unwrap_or_else(|_| DESKTOP_LOGIN_PAGE.to_owned());
    let url = format!("{page}?redirect_uri=hypercli%3A%2F%2Fauth");
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_url(url, None::<String>)
        .map_err(|e| e.to_string())
}

/// Emit the token to the window and bring the app back to the front after
/// the browser detour.
fn deliver_auth_token(app: &tauri::AppHandle, token: String) {
    if app.emit("auth-token", token).is_err() {
        eprintln!("hypercli-desktop: failed to deliver auth token to window");
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.set_focus();
    }
}

/// Minimal %XX decoding — tokens are URL-safe base64, so this is mostly a
/// no-op, but the page uses encodeURIComponent and we must round-trip it.
fn percent_decode(value: &str) -> String {
    let bytes = value.as_bytes();
    let mut out = Vec::with_capacity(bytes.len());
    let mut i = 0;
    while i < bytes.len() {
        if bytes[i] == b'%' && i + 2 < bytes.len() {
            if let Ok(byte) =
                u8::from_str_radix(std::str::from_utf8(&bytes[i + 1..i + 3]).unwrap_or(""), 16)
            {
                out.push(byte);
                i += 3;
                continue;
            }
        }
        out.push(bytes[i]);
        i += 1;
    }
    String::from_utf8_lossy(&out).into_owned()
}

/// Extract the session token from a `hypercli://auth#token=...` callback.
/// Rejects anything that is not our scheme + host, loudly.
fn token_from_callback(url: &str) -> Option<String> {
    let rest = match url.strip_prefix("hypercli://auth") {
        Some(rest) => rest,
        None => {
            eprintln!("hypercli-desktop: rejected deep link with unexpected target");
            return None;
        }
    };
    let fragment = rest.split_once('#')?.1;
    fragment.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        (key == "token" && !value.is_empty()).then(|| percent_decode(value))
    })
}

pub fn run() {
    // Single-instance must be the first registered plugin (Buzz pattern):
    // its callback receives the second instance's argv, which on Windows and
    // Linux carries the hypercli:// deep link.
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
            for arg in argv {
                if arg.starts_with("hypercli://") {
                    if let Some(token) = token_from_callback(&arg) {
                        deliver_auth_token(app, token);
                    }
                }
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_deep_link::init());

    // Register the updater (and the process plugin its relaunch flow needs)
    // only in configured release builds; omit both locally. build.rs emits
    // `hypercli_updater_enabled` when HYPERCLI_UPDATER_PUBLIC_KEY and
    // HYPERCLI_UPDATER_ENDPOINT were present at build time.
    #[cfg(hypercli_updater_enabled)]
    let builder = if cfg!(debug_assertions) {
        builder
    } else {
        builder
            .plugin(tauri_plugin_updater::Builder::new().build())
            .plugin(tauri_plugin_process::init())
    };

    let (deployment_event_restart, deployment_event_rx) = watch::channel(0_u64);
    builder
        .manage(DeploymentEventStream {
            restart: deployment_event_restart,
        })
        .manage(RuntimeLoginSessions::default())
        .manage(StagedAvatarUploads::default())
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(run_deployment_event_stream(
                handle.clone(),
                deployment_event_rx,
            ));
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    if let Some(token) = token_from_callback(url.as_str()) {
                        deliver_auth_token(&handle, token);
                    }
                }
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            provider_status,
            install_providers,
            uninstall_providers,
            save_api_key,
            logout,
            validate_key,
            draft_agent_prompt,
            list_buzz_connections,
            save_buzz_connection,
            remove_buzz_connection,
            list_buzz_channels,
            list_agents,
            get_agent_detail,
            runtime_auth_status,
            begin_runtime_login,
            poll_runtime_login,
            send_runtime_login_input,
            cancel_runtime_login,
            pick_agent_avatar,
            discard_agent_avatar,
            save_agent,
            create_buzz_agent,
            ssh_key_status,
            generate_ssh_key,
            import_ssh_key,
            start_agent,
            stop_agent,
            restart_agent,
            delete_agent,
            mint_api_key,
            start_login,
            open_plans,
            is_auto_update_supported
        ])
        .run(tauri::generate_context!())
        .expect("error while running HyperCLI desktop");
}

#[cfg(test)]
mod tests {
    use super::*;
    use nostr::ToBech32;

    #[test]
    fn nip98_authorization_pins_author_url_method_payload_and_nonce() {
        let signer = nostr::Keys::generate();
        let event = NostrEventBuilder::new(NostrKind::TextNote, "hello")
            .sign_with_keys(&signer)
            .unwrap();
        let body = serde_json::to_vec(&event).unwrap();
        let url = "https://dev.buzz.hypercli.com/events";
        let header = build_nip98_authorization(&signer, url, &body).unwrap();
        let encoded = header.strip_prefix("Nostr ").unwrap();
        let decoded = base64::engine::general_purpose::STANDARD
            .decode(encoded)
            .unwrap();
        let authorization: NostrEvent = serde_json::from_slice(&decoded).unwrap();
        assert_eq!(authorization.pubkey, signer.public_key());
        assert_eq!(authorization.kind, NostrKind::HttpAuth);
        let tags = authorization
            .tags
            .iter()
            .map(|tag| tag.as_slice())
            .collect::<Vec<_>>();
        assert!(tags.iter().any(|tag| {
            tag.first().map(String::as_str) == Some("u")
                && tag.get(1).map(String::as_str) == Some(url)
        }));
        assert!(tags.iter().any(|tag| {
            tag.first().map(String::as_str) == Some("method")
                && tag.get(1).map(String::as_str) == Some("POST")
        }));
        let payload = sha256::Hash::hash(&body).to_string();
        assert!(tags
            .iter()
            .any(|tag| tag.first().map(String::as_str) == Some("payload")
                && tag.get(1).map(String::as_str) == Some(payload.as_str())));
        let nonce = tags
            .iter()
            .find(|tag| tag.first().map(String::as_str) == Some("nonce"))
            .and_then(|tag| tag.get(1))
            .unwrap();
        uuid::Uuid::parse_str(nonce).unwrap();
    }

    #[test]
    fn buzz_http_endpoints_follow_the_relay_scheme() {
        assert_eq!(
            relay_http_events_url("wss://dev.buzz.hypercli.com/").unwrap(),
            "https://dev.buzz.hypercli.com/events"
        );
        assert_eq!(
            relay_http_query_url("wss://dev.buzz.hypercli.com/").unwrap(),
            "https://dev.buzz.hypercli.com/query"
        );
        assert_eq!(
            relay_http_query_url("ws://127.0.0.1:27659").unwrap(),
            "http://127.0.0.1:27659/query"
        );
    }

    #[test]
    fn buzz_http_publisher_rejects_author_mismatch_before_transport() {
        let signer = nostr::Keys::generate();
        let other = nostr::Keys::generate();
        let event = NostrEventBuilder::new(NostrKind::Metadata, "{}")
            .sign_with_keys(&other)
            .unwrap();
        assert!(validate_buzz_event_author(&signer, &event)
            .unwrap_err()
            .contains("author"));
    }

    fn signed_event(
        keys: &nostr::Keys,
        kind: nostr::Kind,
        content: &str,
        tags: Vec<nostr::Tag>,
    ) -> NostrEvent {
        nostr::EventBuilder::new(kind, content)
            .tags(tags)
            .sign_with_keys(keys)
            .unwrap()
    }

    #[test]
    fn token_extracted_from_valid_callback() {
        assert_eq!(
            token_from_callback("hypercli://auth#token=abc.def-123"),
            Some("abc.def-123".to_owned())
        );
    }

    #[test]
    fn callback_with_extra_params_still_yields_token() {
        assert_eq!(
            token_from_callback("hypercli://auth#state=x&token=t1"),
            Some("t1".to_owned())
        );
    }

    #[test]
    fn wrong_scheme_and_missing_or_empty_token_are_rejected() {
        assert_eq!(token_from_callback("https://evil.example/#token=x"), None);
        assert_eq!(token_from_callback("hypercli://auth"), None);
        assert_eq!(token_from_callback("hypercli://auth#token="), None);
        assert_eq!(token_from_callback("hypercli://auth#other=x"), None);
    }

    #[test]
    fn percent_encoded_tokens_round_trip() {
        assert_eq!(
            token_from_callback("hypercli://auth#token=a%3Db%2Fc"),
            Some("a=b/c".to_owned())
        );
        assert_eq!(percent_decode("plain-token_1.2"), "plain-token_1.2");
        assert_eq!(percent_decode("bad%zztail"), "bad%zztail");
    }

    #[test]
    fn avatar_type_detection_uses_content_not_extension() {
        assert_eq!(
            detect_avatar_content_type(b"\x89PNG\r\n\x1a\nrest"),
            Some("image/png")
        );
        assert_eq!(
            detect_avatar_content_type(b"\xff\xd8\xff\xe0rest"),
            Some("image/jpeg")
        );
        assert_eq!(detect_avatar_content_type(b"GIF89arest"), Some("image/gif"));
        assert_eq!(
            detect_avatar_content_type(b"RIFF\x00\x00\x00\x00WEBPrest"),
            Some("image/webp")
        );
        assert_eq!(detect_avatar_content_type(b"not an image"), None);
    }

    #[test]
    fn lifecycle_actions_are_fail_closed_and_match_backend_states() {
        assert_eq!(
            agent_actions("STOPPED"),
            AgentActions {
                start: true,
                stop: false,
                restart: false,
                delete: true,
            }
        );
        assert_eq!(
            agent_actions("running"),
            AgentActions {
                start: false,
                stop: true,
                restart: true,
                delete: false,
            }
        );
        for state in ["CREATING", "RESTORING", "STARTING"] {
            assert_eq!(
                agent_actions(state),
                AgentActions {
                    start: false,
                    stop: true,
                    restart: false,
                    delete: false,
                }
            );
        }
        assert_eq!(
            agent_actions("FAILED"),
            AgentActions {
                start: false,
                stop: false,
                restart: true,
                delete: false,
            }
        );
        assert_eq!(
            agent_actions("stopping"),
            AgentActions {
                start: false,
                stop: false,
                restart: false,
                delete: false,
            }
        );
        assert_eq!(agent_actions("future-state"), agent_actions("stopping"));
    }

    #[test]
    fn desktop_agent_recognizes_legacy_buzz_tag_without_launch_secrets() {
        let view = DesktopAgent::from(Deployment {
            id: "40c42593-7d02-48f9-a3ff-6c7d6461f140".to_owned(),
            name: "Maverick".to_owned(),
            handle: Some("buzz-public".to_owned()),
            avatar_url: None,
            runtime: Some(hypercli_sdk::ManagedRuntime::ClaudeCode),
            state: "RUNNING".to_owned(),
            cluster_id: None,
            hostname: Some("maverick.hypercli.app".to_owned()),
            tags: vec!["buzz_agent=public-key".to_owned()],
            requested_size: Some("large".to_owned()),
            archived_at: None,
            launch_epoch: 0,
            launch_config: Default::default(),
        });
        let serialized = serde_json::to_value(view).unwrap();

        assert_eq!(serialized["is_buzz"], true);
        assert_eq!(serialized["can_restart"], true);
        assert_eq!(serialized["runtime"], "claude-code");
    }

    #[test]
    fn desktop_agent_uses_buzz_display_name_instead_of_backend_slug() {
        let mut launch_config = BTreeMap::new();
        launch_config.insert(
            "env".to_owned(),
            serde_json::json!({"BUZZ_ACP_DISPLAY_NAME": "CI Buzz Agent"}),
        );
        let view = DesktopAgent::from(Deployment {
            id: "40c42593-7d02-48f9-a3ff-6c7d6461f140".to_owned(),
            name: "ci-buzz-agent-79be667e".to_owned(),
            handle: Some("buzz-public".to_owned()),
            avatar_url: None,
            runtime: Some(hypercli_sdk::ManagedRuntime::BuzzAgent),
            state: "RUNNING".to_owned(),
            cluster_id: None,
            hostname: None,
            tags: vec![
                "app=buzz".to_owned(),
                "buzz_agent=79be667ef9dcbbac".to_owned(),
            ],
            requested_size: Some("large".to_owned()),
            archived_at: None,
            launch_epoch: 0,
            launch_config: DeploymentLaunchConfig::from_map(launch_config),
        });

        assert_eq!(view.name, "CI Buzz Agent");
        assert_eq!(view.agent_public_key.as_deref(), Some("79be667ef9dcbbac"));
    }

    #[test]
    fn editor_sync_all_clears_policy_and_unchecked_restores_runtime_default() {
        let mut launch_config = BTreeMap::from([
            ("sync_include".to_owned(), serde_json::json!([".codex"])),
            ("sync_exclude".to_owned(), serde_json::json!(["tmp"])),
        ]);
        apply_editor_sync_policy(&mut launch_config, ManagedRuntime::Codex, true);
        assert!(launch_config["sync_include"].is_null());
        assert!(!launch_config.contains_key("sync_exclude"));
        assert!(launch_syncs_all(&DeploymentLaunchConfig::from_map(
            launch_config.clone()
        )));

        apply_editor_sync_policy(&mut launch_config, ManagedRuntime::Codex, false);
        assert_eq!(launch_config["sync_include"], serde_json::json!([".codex"]));
        assert!(!launch_config.contains_key("sync_exclude"));
        assert!(!launch_syncs_all(&DeploymentLaunchConfig::from_map(
            launch_config
        )));
    }

    #[test]
    fn editor_sync_policy_distinguishes_empty_lists_from_nulls() {
        let empty_include = DeploymentLaunchConfig::from_map(BTreeMap::from([(
            "sync_include".to_owned(),
            serde_json::json!([]),
        )]));
        assert!(!launch_syncs_all(&empty_include));

        let null_policies = DeploymentLaunchConfig::from_map(BTreeMap::from([(
            "sync_include".to_owned(),
            Value::Null,
        )]));
        assert!(launch_syncs_all(&null_policies));

        let mut null_include_with_exclude = BTreeMap::from([
            ("sync_include".to_owned(), Value::Null),
            ("sync_exclude".to_owned(), serde_json::json!(["tmp"])),
        ]);
        apply_editor_sync_policy(&mut null_include_with_exclude, ManagedRuntime::Codex, false);
        assert!(!null_include_with_exclude.contains_key("sync_include"));
        assert_eq!(
            null_include_with_exclude["sync_exclude"],
            serde_json::json!(["tmp"])
        );
    }

    #[test]
    fn tauri_agent_ids_must_be_canonical_uuids() {
        assert_eq!(
            checked_agent_id("40c42593-7d02-48f9-a3ff-6c7d6461f140").unwrap(),
            "40c42593-7d02-48f9-a3ff-6c7d6461f140"
        );
        assert_eq!(
            checked_agent_id("../../plans").unwrap_err(),
            "Invalid agent id"
        );
    }

    #[test]
    fn desktop_machine_key_scopes_cover_editor_without_unrestricted_models() {
        assert!(DESKTOP_KEY_SCOPES.contains(&"agents:*"));
        assert!(DESKTOP_KEY_SCOPES.contains(&"files:*"));
        assert!(DESKTOP_KEY_SCOPES.contains(&"models:kimi-k2.6"));
        assert!(DESKTOP_KEY_SCOPES.contains(&"user:self"));
        assert!(!DESKTOP_KEY_SCOPES.contains(&"models:*"));
    }

    #[test]
    fn prompt_drafting_errors_explain_the_actionable_failure() {
        assert!(prompt_drafting_status_error(403).contains("reauthorized"));
        assert!(prompt_drafting_status_error(404).contains("configured HyperCLI endpoint"));
        assert!(prompt_drafting_status_error(429).contains("rate limited"));
        assert!(prompt_drafting_status_error(503).contains("HTTP 503"));
    }

    #[test]
    fn free_form_environment_preserves_vendor_controls_but_blocks_platform_keys() {
        for allowed in [
            "ANTHROPIC_BASE_URL",
            "ANTHROPIC_AUTH_TOKEN",
            "OPENAI_API_KEY",
            "KIMI_CONFIG_FILE",
            "GITHUB_TOKEN",
            "HYPERCLI_RUNTIME_INFERENCE",
        ] {
            assert!(!is_protected_launch_env(allowed), "{allowed}");
        }
        for blocked in [
            "BUZZ_PRIVATE_KEY",
            "BUZZ_ACP_AGENT_COMMAND",
            "HYPER_AGENTS_API_KEY",
            "NOSTR_PRIVATE_KEY",
            "PATH",
            "LD_PRELOAD",
        ] {
            assert!(is_protected_launch_env(blocked), "{blocked}");
        }
        for secret in [
            "ANTHROPIC_AUTH_TOKEN",
            "OPENAI_API_KEY",
            "GITHUB_TOKEN",
            "MY_PASSWORD",
            "DATABASE_URL",
            "SENTRY_DSN",
            "SESSION_COOKIE",
        ] {
            assert!(is_secret_env_key(secret), "{secret}");
        }
        assert!(!is_secret_env_key("ANTHROPIC_BASE_URL"));
        assert!(!is_secret_env_key("HYPERCLI_RUNTIME_INFERENCE"));
        assert!(validate_additional_env(&BTreeMap::from([(
            "HYPERCLI_RUNTIME_INFERENCE".to_owned(),
            "hypercli".to_owned(),
        )]))
        .is_ok());
        assert!(validate_additional_env(&BTreeMap::from([(
            "HYPERCLI_RUNTIME_INFERENCE".to_owned(),
            "true".to_owned(),
        )]))
        .is_err());
    }

    #[test]
    fn ssh_status_parser_returns_only_public_material() {
        let status = parse_ssh_status(
            "PUBLIC=ssh-ed25519 AAAAC3Nza test@example\nFINGERPRINT=256 SHA256:abc test@example (ED25519)\n",
        );
        assert!(status.configured);
        assert_eq!(
            status.public_key.as_deref(),
            Some("ssh-ed25519 AAAAC3Nza test@example")
        );
        assert!(status
            .fingerprint
            .as_deref()
            .unwrap()
            .contains("SHA256:abc"));
        assert!(!parse_ssh_status("private-key-material\n").configured);
    }

    #[test]
    fn allowlist_resolves_npub_hex_and_member_profile_aliases_to_hex() {
        let relay = nostr::Keys::generate();
        let damian = nostr::Keys::generate();
        let membership = signed_event(
            &relay,
            nostr::Kind::Custom(39002),
            "",
            vec![
                nostr::Tag::parse(["d", "8c62df2d-1eb2-4145-a324-fbbce34c51ab"]).unwrap(),
                nostr::Tag::parse(["p", &damian.public_key().to_hex(), "", "member"]).unwrap(),
            ],
        );
        let profile = signed_event(
            &damian,
            nostr::Kind::Metadata,
            r#"{"name":"damian","display_name":"Damian","nip05":"damian@example.com"}"#,
            Vec::new(),
        );
        let npub = damian.public_key().to_bech32().unwrap();
        let channel = "8c62df2d-1eb2-4145-a324-fbbce34c51ab".to_owned();
        let resolved = resolve_allowlist_entries(
            &[npub, "Damian".to_owned(), damian.public_key().to_hex()],
            std::slice::from_ref(&channel),
            &[membership],
            &[profile],
        )
        .unwrap();
        assert_eq!(resolved, vec![damian.public_key().to_hex()]);
    }

    #[test]
    fn allowlist_nickname_resolution_fails_closed_when_missing_or_ambiguous() {
        let relay = nostr::Keys::generate();
        let first = nostr::Keys::generate();
        let second = nostr::Keys::generate();
        let membership = signed_event(
            &relay,
            nostr::Kind::Custom(39002),
            "",
            vec![
                nostr::Tag::parse(["d", "8c62df2d-1eb2-4145-a324-fbbce34c51ab"]).unwrap(),
                nostr::Tag::parse(["p", &first.public_key().to_hex(), "", "member"]).unwrap(),
                nostr::Tag::parse(["p", &second.public_key().to_hex(), "", "member"]).unwrap(),
            ],
        );
        let profile_content = r#"{"display_name":"Sam"}"#;
        let profiles = vec![
            signed_event(&first, nostr::Kind::Metadata, profile_content, Vec::new()),
            signed_event(&second, nostr::Kind::Metadata, profile_content, Vec::new()),
        ];
        let ambiguous = resolve_allowlist_entries(
            &["sam".to_owned()],
            &["8c62df2d-1eb2-4145-a324-fbbce34c51ab".to_owned()],
            std::slice::from_ref(&membership),
            &profiles,
        )
        .unwrap_err();
        assert!(ambiguous.contains("More than one member"));
        let missing = resolve_allowlist_entries(
            &["nobody".to_owned()],
            &["8c62df2d-1eb2-4145-a324-fbbce34c51ab".to_owned()],
            &[membership],
            &profiles,
        )
        .unwrap_err();
        assert!(missing.contains("No member named"));
    }

    #[test]
    fn allowlist_rejects_partial_rosters_and_non_contract_key_spellings() {
        let relay = nostr::Keys::generate();
        let member = nostr::Keys::generate();
        let first_channel = "8c62df2d-1eb2-4145-a324-fbbce34c51ab".to_owned();
        let second_channel = "c914b6b6-449f-424a-8863-3a797c54dfb9".to_owned();
        let membership = signed_event(
            &relay,
            nostr::Kind::Custom(39002),
            "",
            vec![
                nostr::Tag::parse(["d", first_channel.as_str()]).unwrap(),
                nostr::Tag::parse(["p", &member.public_key().to_hex(), "", "member"]).unwrap(),
            ],
        );
        let partial = resolve_allowlist_entries(
            &["Member".to_owned()],
            &[first_channel, second_channel],
            &[membership],
            &[],
        )
        .unwrap_err();
        assert!(partial.contains("current member roster"));

        let npub = member.public_key().to_bech32().unwrap();
        assert!(explicit_allowlist_public_key(&npub).unwrap().is_some());
        assert!(explicit_allowlist_public_key(&format!("nostr:{npub}"))
            .unwrap()
            .is_none());
        assert!(explicit_allowlist_public_key(&"z".repeat(64)).is_err());
    }
}
