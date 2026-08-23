mod buzz_connections;
mod buzz_launch;

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use hypercli_sdk::{
    discover_agents_api_base, discover_client_config, remove_config_api_keys,
    save_api_key as write_api_key, AgentSize, ClientConfig, ConfigError, CreateApiKeyRequest,
    CreateDeploymentRequest, Deployment, HyperCliClient, ManagedRuntime, StartDeploymentRequest,
};
use secrecy::{ExposeSecret, SecretString};
use serde::{Deserialize, Serialize};
use serde_json::Value;
use tauri::menu::{Menu, MenuItem, PredefinedMenuItem};
use tauri::tray::{MouseButton, MouseButtonState, TrayIconBuilder, TrayIconEvent};
use tauri::{Emitter, Manager, Position, Rect};
use tauri_plugin_deep_link::DeepLinkExt;
use tokio::sync::{mpsc, watch};

/// Capabilities held by a Desktop-minted machine key. Agent management is
/// the primary surface; the single model grant powers the prompt-drafting
/// helper without turning the Desktop credential into an unrestricted
/// inference key.
const DESKTOP_KEY_SCOPES: [&str; 3] = ["agents:*", "models:*", "user:self"];

/// Web login page. Its allowlist accepts the `hypercli://auth` scheme
/// callback (site/apps/claw/src/app/desktop-login/page.tsx) — the exact
/// Backseat Driver pattern: token in the URL fragment, no server round-trip.
const DESKTOP_LOGIN_PAGE: &str = "https://agents.hypercli.com/desktop-login";
const DASHBOARD_URL: &str = "https://agents.hypercli.com/dashboard/agents";
/// Origin the OpenClaw control UI is served from; starting an agent without
/// it leaves the website chat unable to reach the gateway (site flow:
/// `requestAgentStart` sets the same env before start).
const DASHBOARD_ORIGIN: &str = "https://agents.hypercli.com";
const CONTROL_UI_ALLOWED_ORIGIN_ENV: &str = "OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN";

const TRAY_ID: &str = "hypercli-tray";
const SHOW_ITEM_ID: &str = "show";
const NEW_AGENT_ITEM_ID: &str = "new-agent";
const QUIT_ITEM_ID: &str = "quit";

#[derive(Serialize, Clone)]
pub struct KeyValidation {
    valid: bool,
    email: Option<String>,
    key_name: Option<String>,
    has_agents_capability: bool,
    /// None = plan status unknowable (key lacks the `user` scope family) —
    /// the UI must not show a purchase hint in that case.
    has_active_plan: Option<bool>,
    detail: Option<String>,
}

/// Secret-free deployment summary rendered by the launcher list.
#[derive(Serialize, Clone)]
pub struct LauncherAgent {
    id: String,
    name: String,
    avatar_url: Option<String>,
    runtime: Option<String>,
    state: String,
    is_buzz: bool,
    can_start: bool,
    can_stop: bool,
    /// Archived agents stay listed but render grayed out and inert.
    archived: bool,
    /// Paid claim in vCPU cores from the deployment record. Informational
    /// only — never a load-bar denominator.
    cpu: Option<f64>,
    /// Paid claim in GiB from the deployment record. Informational only —
    /// never a load-bar denominator.
    memory: Option<f64>,
    /// The pod's CPU burst ceiling in vCPU cores; the sole denominator for
    /// the CPU load bar. Rows without it render no CPU bar.
    cpu_limit: Option<f64>,
    /// The pod's memory burst ceiling in GiB; the sole denominator for the
    /// memory load bar. Rows without it render no memory bar.
    memory_limit: Option<f64>,
}

struct AgentActions {
    start: bool,
    stop: bool,
}

fn normalized_state(state: &str) -> String {
    state.trim().to_ascii_lowercase()
}

fn agent_actions(state: &str) -> AgentActions {
    match normalized_state(state).as_str() {
        "stopped" => AgentActions {
            start: true,
            stop: false,
        },
        "running" | "creating" | "restoring" | "starting" => AgentActions {
            start: false,
            stop: true,
        },
        _ => AgentActions {
            start: false,
            stop: false,
        },
    }
}

impl From<Deployment> for LauncherAgent {
    fn from(deployment: Deployment) -> Self {
        let actions = agent_actions(&deployment.state);
        let is_buzz = deployment.is_buzz_managed();
        // Buzz agents carry their display name in launch env, not the
        // canonical (pubkey-suffixed) deployment name.
        let display_name = if is_buzz {
            crate::buzz_display_name(&deployment).unwrap_or_else(|| deployment.name.clone())
        } else {
            deployment.name.clone()
        };
        let launch_avatar = if is_buzz {
            launch_env_value(&deployment, "BUZZ_PROFILE_PICTURE")
        } else {
            None
        };
        let state = normalized_state(&deployment.state);
        // The archive contract sets `archived_at` on ARCHIVED agents; accept
        // the bare state too so older backends still gray the row out.
        let archived = deployment.archived_at.is_some() || state == "archived";
        Self {
            id: deployment.id,
            name: display_name,
            avatar_url: deployment.avatar_url.or(launch_avatar),
            runtime: deployment
                .runtime
                .and_then(|runtime| serde_json::to_value(runtime).ok())
                .and_then(|value| value.as_str().map(str::to_owned)),
            state,
            is_buzz,
            can_start: actions.start,
            can_stop: actions.stop,
            archived,
            cpu: None,
            memory: None,
            cpu_limit: None,
            memory_limit: None,
        }
    }
}

impl LauncherAgent {
    fn with_resources(mut self, resources: Option<&DeploymentResources>) -> Self {
        if let Some(resources) = resources {
            self.cpu = resources.cpu;
            self.memory = resources.memory;
            self.cpu_limit = resources.cpu_limit;
            self.memory_limit = resources.memory_limit;
        }
        self
    }
}

/// Pods burst above the paid claim to a higher limit, and the limit is the
/// sole live-usage denominator. The typed SDK `Deployment` drops all of
/// these resource fields, so they are fetched as raw JSON — keeping the SDK
/// stock.
#[derive(Clone, Default, Deserialize)]
#[serde(default)]
struct DeploymentResources {
    cpu: Option<f64>,
    memory: Option<f64>,
    cpu_limit: Option<f64>,
    memory_limit: Option<f64>,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct DeploymentResourceEntry {
    id: String,
    #[serde(flatten)]
    resources: DeploymentResources,
}

#[derive(Default, Deserialize)]
#[serde(default)]
struct DeploymentResourceEnvelope {
    items: Vec<DeploymentResourceEntry>,
}

/// Reads the deployments list as raw JSON to recover the resource fields
/// the typed SDK `Deployment` drops. Failure is non-fatal: an empty map
/// leaves the rows rendering text-only metrics.
fn fetch_deployment_resources(config: &ClientConfig) -> HashMap<String, DeploymentResources> {
    let url = format!(
        "{}/deployments",
        config.api_base.as_str().trim_end_matches('/')
    );
    let result = reqwest::blocking::Client::new()
        .get(&url)
        .bearer_auth(config.api_key.expose_secret())
        .send()
        .and_then(|response| response.error_for_status())
        .and_then(|response| response.json::<DeploymentResourceEnvelope>());
    match result {
        Ok(envelope) => envelope
            .items
            .into_iter()
            .map(|entry| (entry.id, entry.resources))
            .collect(),
        Err(error) => {
            eprintln!("hypercli-menubar: deployment resource fetch failed: {error}");
            HashMap::new()
        }
    }
}

fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "cannot resolve home directory".to_string())
}

fn launch_env(
    config: &hypercli_sdk::DeploymentLaunchConfig,
) -> Option<std::collections::BTreeMap<String, String>> {
    let object = config.as_map().get("env")?.as_object()?;
    object
        .iter()
        .map(|(key, value)| Some((key.clone(), value.as_str()?.to_owned())))
        .collect()
}

fn launch_env_value(deployment: &Deployment, key: &str) -> Option<String> {
    launch_env(&deployment.launch_config)?
        .get(key)
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

/// Buzz agents carry their operator-chosen display name in launch env; the
/// deployment name is the canonical pubkey-suffixed identity.
fn buzz_display_name(deployment: &Deployment) -> Option<String> {
    launch_env_value(deployment, "BUZZ_ACP_DISPLAY_NAME")
}

fn managed_client() -> Result<HyperCliClient, String> {
    let config = discover_client_config().map_err(|error| error.to_string())?;
    HyperCliClient::new(config).map_err(|error| error.to_string())
}

fn checked_agent_id(agent_id: &str) -> Result<String, String> {
    uuid::Uuid::parse_str(agent_id.trim())
        .map(|value| value.to_string())
        .map_err(|_| "Invalid agent id".to_owned())
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

/// The SDK's HTTP client is blocking; it must not be created or dropped on
/// the async runtime (tokio panics), so the work runs on a blocking thread.
#[tauri::command]
async fn mint_api_key(
    session_token: String,
    watcher: tauri::State<'_, AgentWatcher>,
) -> Result<String, String> {
    let result = tauri::async_runtime::spawn_blocking(move || mint_api_key_blocking(session_token))
        .await
        .map_err(|e| e.to_string())?;
    if result.is_ok() {
        watcher.restart();
    }
    result
}

#[tauri::command]
fn save_api_key(api_key: String, watcher: tauri::State<'_, AgentWatcher>) -> Result<(), String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("API key is empty".into());
    }
    write_api_key(&home_dir()?, api_key).map_err(|e| e.to_string())?;
    watcher.restart();
    Ok(())
}

/// Returns true when a key is still discoverable afterwards — i.e. the
/// environment exports one that logout cannot (and should not) remove.
#[tauri::command]
fn logout(watcher: tauri::State<'_, AgentWatcher>) -> Result<bool, String> {
    remove_config_api_keys(&home_dir()?).map_err(|e| e.to_string())?;
    watcher.restart();
    let still_has_key = !matches!(
        discover_client_config(),
        Err(ConfigError::MissingCredential)
    );
    Ok(still_has_key)
}

fn validate_key_blocking() -> Result<KeyValidation, String> {
    let config = match discover_client_config() {
        Ok(config) => config,
        Err(ConfigError::MissingCredential) => {
            return Ok(KeyValidation {
                valid: false,
                email: None,
                key_name: None,
                has_agents_capability: false,
                has_active_plan: None,
                detail: None,
            })
        }
        Err(error) => return Err(error.to_string()),
    };
    let client = HyperCliClient::new(config).map_err(|e| e.to_string())?;
    match client.auth_me() {
        Ok(me) => {
            let has_scope = |scope: &str| me.capabilities.iter().any(|value| value == scope);
            Ok(KeyValidation {
                valid: true,
                email: me.email,
                key_name: me.key_name,
                has_agents_capability: has_scope("agents:*"),
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
                has_active_plan: None,
                detail: Some(detail),
            })
        }
    }
}

#[tauri::command]
async fn validate_key() -> Result<KeyValidation, String> {
    tauri::async_runtime::spawn_blocking(validate_key_blocking)
        .await
        .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_agents() -> Result<Vec<LauncherAgent>, String> {
    tauri::async_runtime::spawn_blocking(fetch_launcher_agents)
        .await
        .map_err(|error| error.to_string())?
}

/// Start an OpenClaw agent after locking its control UI to the dashboard
/// origin. Other runtimes start directly.
fn start_with_control_ui(client: &HyperCliClient, agent_id: &str) -> Result<LauncherAgent, String> {
    let current = client
        .get_deployment(agent_id)
        .map_err(|error| error.to_string())?;
    if matches!(
        current.runtime,
        Some(ManagedRuntime::Openclaw | ManagedRuntime::OpenclawPro)
    ) {
        client
            .set_deployment_env(agent_id, CONTROL_UI_ALLOWED_ORIGIN_ENV, DASHBOARD_ORIGIN)
            .map_err(|error| error.to_string())?;
    }
    let launch_config = client
        .stored_launch_config(agent_id, None)
        .map_err(|error| error.to_string())?;
    client
        .start_deployment(agent_id, &StartDeploymentRequest::new(launch_config))
        .map(LauncherAgent::from)
        .map_err(|error| error.to_string())
}

#[tauri::command]
async fn start_agent(agent_id: String) -> Result<LauncherAgent, String> {
    tauri::async_runtime::spawn_blocking(move || {
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
        start_with_control_ui(&client, &agent_id)
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn stop_agent(agent_id: String) -> Result<LauncherAgent, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent_id = checked_agent_id(&agent_id)?;
        managed_client()?
            .stop_deployment(&agent_id)
            .map(LauncherAgent::from)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn archive_agent(agent_id: String) -> Result<LauncherAgent, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent_id = checked_agent_id(&agent_id)?;
        managed_client()?
            .archive_deployment(&agent_id)
            .map(LauncherAgent::from)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn delete_agent(agent_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent_id = checked_agent_id(&agent_id)?;
        managed_client()?
            .delete_deployment(&agent_id)
            .map(|_| ())
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[tauri::command]
async fn set_agent_avatar(
    agent_id: String,
    data: Vec<u8>,
    content_type: String,
) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let agent_id = checked_agent_id(&agent_id)?;
        if data.is_empty() || data.len() > 5 * 1024 * 1024 {
            return Err("Profile picture must be an image under 5 MB".to_owned());
        }
        let content_type = match content_type.as_str() {
            "image/png" | "image/jpeg" | "image/webp" | "image/gif" => content_type,
            _ => return Err("Profile picture must be a PNG, JPEG, WebP, or GIF image".to_owned()),
        };
        let response = managed_client()?
            .upload_deployment_profile_image(&agent_id, &data, &content_type)
            .map_err(|error| error.to_string())?;
        response
            .avatar_url
            .ok_or_else(|| "Profile picture upload returned no URL".to_owned())
    })
    .await
    .map_err(|error| error.to_string())?
}

#[derive(Deserialize)]
pub struct CreateAgentInput {
    name: Option<String>,
    size: Option<String>,
    desktop: bool,
}

fn checked_agent_size(size: Option<String>) -> Result<Option<AgentSize>, String> {
    match size.as_deref().map(str::trim) {
        None | Some("") => Ok(None),
        Some("small") => Ok(Some(AgentSize::Small)),
        Some("medium") => Ok(Some(AgentSize::Medium)),
        Some("large") => Ok(Some(AgentSize::Large)),
        Some(other) => Err(format!("Invalid size: {other}")),
    }
}

/// Create a hosted OpenClaw agent, then start it once the deployment has
/// settled to `stopped` — the same create → start flow as the website
/// launcher. The start happens on a background task so the UI returns as
/// soon as the deployment exists; the event stream reports the transition.
#[tauri::command]
async fn create_agent(
    app: tauri::AppHandle,
    input: CreateAgentInput,
) -> Result<LauncherAgent, String> {
    let created = tauri::async_runtime::spawn_blocking(move || {
        let name = input
            .name
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        if let Some(name) = &name {
            if name.len() > 64 {
                return Err("Agent name is too long (max 64 characters)".to_owned());
            }
        }
        let size = checked_agent_size(input.size)?;
        let request = CreateDeploymentRequest::openclaw(name, size, input.desktop);
        managed_client()?
            .create_deployment(&request)
            .map(LauncherAgent::from)
            .map_err(|error| error.to_string())
    })
    .await
    .map_err(|error| error.to_string())??;

    let agent_id = created.id.clone();
    tauri::async_runtime::spawn(async move {
        let started = tauri::async_runtime::spawn_blocking(move || {
            let client = managed_client()?;
            tauri::async_runtime::block_on(client.wait_deployment_state(
                &agent_id,
                &["stopped"],
                &[],
                Duration::from_secs(120),
            ))
            .map_err(|error| error.to_string())?;
            start_with_control_ui(&client, &agent_id)
        })
        .await;
        if let Err(error) = started.map_err(|e| e.to_string()).and_then(|result| result) {
            eprintln!("hypercli-menubar: auto-start after create failed: {error}");
        }
        let _ = app.emit("deployments-invalidated", ());
    });

    Ok(created)
}

#[tauri::command]
async fn agent_metrics(agent_id: String) -> Result<Value, String> {
    let agent_id = checked_agent_id(&agent_id)?;
    managed_client()?
        .deployment_metrics(&agent_id)
        .await
        .map_err(|error| error.to_string())
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

fn prompt_drafting_status_error(status: u16) -> String {
    match status {
        400 => "The inference gateway rejected this draft request (HTTP 400). Try a shorter description or sign in again.".to_owned(),
        401 | 403 => {
            "This Desktop key needs to be reauthorized for prompt drafting — sign out and back in".to_owned()
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

/// Draft a system prompt from a short description via the inference gateway,
/// pinned to the single model the Desktop key scope grants.
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
                    "content": "You write system prompts for remote coding agents. From the user's description, write one practical system prompt for the agent. Keep the agent a coding agent, but adopt the role, personality, and priorities the user describes. Return only the prompt, 90-160 words, plain text. Cover role, priorities, operating style, safety boundaries, and how to report results. Do not mention this request or add markdown fences."
                },
                {"role": "user", "content": format!("Agent description: {keywords}")}
            ]
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

#[derive(Deserialize)]
struct ModelsResponse {
    data: Vec<ModelsResponseEntry>,
}

#[derive(Deserialize)]
struct ModelsResponseEntry {
    id: String,
}

/// Best-effort model catalog from the inference gateway. Soft-fails to an
/// empty list — the caller's key may not carry the models:* scope, and the
/// model field stays free-text in that case.
#[tauri::command]
async fn list_models() -> Result<Vec<String>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = discover_client_config().map_err(|error| error.to_string())?;
        let mut url = config.api_base.clone();
        url.set_path("/v1/models");
        url.set_query(None);
        url.set_fragment(None);
        let response = reqwest::blocking::Client::builder()
            .timeout(Duration::from_secs(15))
            .build()
            .map_err(|error| error.to_string())?
            .get(url)
            .bearer_auth(config.api_key.expose_secret())
            .send()
            .map_err(|error| error.to_string())?;
        if !response.status().is_success() {
            return Ok(Vec::new());
        }
        let catalog: ModelsResponse = response
            .json()
            .map_err(|_| "Model catalog returned an invalid response".to_owned())?;
        Ok(catalog.data.into_iter().map(|entry| entry.id).collect())
    })
    .await
    .map_err(|error| error.to_string())?
}

/// Open the browser sign-in. The page redirects back to `hypercli://auth`
/// with the token in the URL fragment — the exact Backseat Driver pattern.
/// `HYPERCLI_DESKTOP_LOGIN_PAGE` overrides the page for dev/feat testing.
#[tauri::command]
fn start_login(app: tauri::AppHandle) -> Result<(), String> {
    let page = std::env::var("HYPERCLI_DESKTOP_LOGIN_PAGE")
        .unwrap_or_else(|_| DESKTOP_LOGIN_PAGE.to_owned());
    let url = format!("{page}?redirect_uri=hypercli%3A%2F%2Fauth");
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_url(url, None::<String>)
        .map_err(|e| e.to_string())
}

#[tauri::command]
fn open_agent_chat(app: tauri::AppHandle, agent_id: String) -> Result<(), String> {
    let agent_id = checked_agent_id(&agent_id)?;
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_url(
            format!("{DASHBOARD_URL}?agentId={agent_id}"),
            None::<String>,
        )
        .map_err(|e| e.to_string())?;
    hide_popup(&app);
    Ok(())
}

#[tauri::command]
fn open_dashboard(app: tauri::AppHandle) -> Result<(), String> {
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_url(DASHBOARD_URL, None::<String>)
        .map_err(|e| e.to_string())?;
    hide_popup(&app);
    Ok(())
}

/// Open (or focus) the single auxiliary panel window. It shares the frontend
/// bundle; the app routes on the window label, and the interior view is
/// switched via the `panel-navigate` event — never a second window.
/// Standard window chrome; we own the interior only.
fn show_panel_window(app: &tauri::AppHandle, view: &str) {
    if let Some(window) = app.get_webview_window("panel") {
        let _ = window.show();
        let _ = window.set_focus();
        let _ = app.emit("panel-navigate", view.to_owned());
        hide_popup(app);
        return;
    }
    let url = format!("index.html?view={view}");
    let window = tauri::WebviewWindowBuilder::new(app, "panel", tauri::WebviewUrl::App(url.into()))
        .title("")
        .inner_size(400.0, 540.0)
        .min_inner_size(400.0, 480.0)
        .max_inner_size(400.0, 760.0)
        .visible(false)
        .center()
        .build();
    match window {
        Ok(window) => {
            let _ = window.show();
            let _ = window.set_focus();
        }
        Err(error) => eprintln!("hypercli-menubar: could not open panel window: {error}"),
    }
    hide_popup(app);
}

#[tauri::command]
fn open_create_window(app: tauri::AppHandle) -> Result<(), String> {
    show_panel_window(&app, "new");
    Ok(())
}

#[tauri::command]
fn open_settings_window(app: tauri::AppHandle) -> Result<(), String> {
    show_panel_window(&app, "connections");
    Ok(())
}

#[tauri::command]
fn open_main_window(app: tauri::AppHandle) -> Result<(), String> {
    show_popup(&app, None);
    Ok(())
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
            eprintln!("hypercli-menubar: rejected deep link with unexpected target");
            return None;
        }
    };
    let fragment = rest.split_once('#')?.1;
    fragment.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        (key == "token" && !value.is_empty()).then(|| percent_decode(value))
    })
}

/// Emit the token to the window and show the popup again after the browser
/// detour.
fn deliver_auth_token(app: &tauri::AppHandle, token: String) {
    if app.emit("auth-token", token).is_err() {
        eprintln!("hypercli-menubar: failed to deliver auth token to window");
    }
    show_popup(app, None);
}

fn hide_popup(app: &tauri::AppHandle) {
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.hide();
    }
}

/// Show the popup under the tray icon. `anchor` is the tray icon's screen
/// rect when the click event supplies one; otherwise we fall back to the
/// last position / primary monitor top-right.
fn show_popup(app: &tauri::AppHandle, anchor: Option<Rect>) {
    let Some(window) = app.get_webview_window("main") else {
        return;
    };
    if let Some(anchor) = anchor {
        let scale = window.scale_factor().unwrap_or(1.0);
        let anchor_pos: tauri::LogicalPosition<f64> = anchor.position.to_logical(scale);
        let anchor_size: tauri::LogicalSize<f64> = anchor.size.to_logical(scale);
        let width = window
            .outer_size()
            .map(|size| size.to_logical::<f64>(scale).width)
            .unwrap_or(340.0);
        let x = anchor_pos.x + anchor_size.width / 2.0 - width / 2.0;
        let y = anchor_pos.y + anchor_size.height + 6.0;
        let _ = window.set_position(Position::Logical(tauri::LogicalPosition { x, y }));
    }
    let _ = window.show();
    let _ = window.set_focus();
    let _ = app.emit("popup-shown", ());
}

fn toggle_popup(app: &tauri::AppHandle, anchor: Option<Rect>) {
    let visible = app
        .get_webview_window("main")
        .map(|window| window.is_visible().unwrap_or(false))
        .unwrap_or(false);
    if visible {
        hide_popup(app);
    } else {
        show_popup(app, anchor);
    }
}

fn init_tray(app: &tauri::App) -> tauri::Result<()> {
    let show = MenuItem::with_id(app, SHOW_ITEM_ID, "Show HyperCLI", true, None::<&str>)?;
    let new_agent = MenuItem::with_id(app, NEW_AGENT_ITEM_ID, "New Agent…", true, None::<&str>)?;
    let separator = PredefinedMenuItem::separator(app)?;
    let quit = MenuItem::with_id(app, QUIT_ITEM_ID, "Quit HyperCLI", true, None::<&str>)?;
    let menu = Menu::with_items(app, &[&show, &new_agent, &separator, &quit])?;

    let mut builder = TrayIconBuilder::with_id(TRAY_ID)
        .menu(&menu)
        .show_menu_on_left_click(false)
        .tooltip("HyperCLI")
        .on_menu_event(|app, event| match event.id.as_ref() {
            SHOW_ITEM_ID => show_popup(app, None),
            NEW_AGENT_ITEM_ID => show_panel_window(app, "new"),
            QUIT_ITEM_ID => app.exit(0),
            _ => {}
        })
        .on_tray_icon_event(|tray, event| {
            if let TrayIconEvent::Click {
                button: MouseButton::Left,
                button_state: MouseButtonState::Up,
                rect,
                ..
            } = event
            {
                toggle_popup(tray.app_handle(), Some(rect));
            }
        });
    if let Ok(icon) = tauri::image::Image::from_bytes(include_bytes!("../icons/tray-icon@2x.png")) {
        builder = builder.icon(icon).icon_as_template(true);
    }
    builder.build(app)?;
    Ok(())
}

/// Agent id → (display name, last known state, avatar URL). `None` until the
/// first roster fetch primes the baseline — transitions are only notified
/// against a primed baseline, never on initial load.
type AgentStateBaseline = Arc<Mutex<Option<HashMap<String, (String, String, Option<String>)>>>>;

/// Watches the deployment event stream (/ws) and turns state transitions
/// into native notifications plus an `agents-updated` event carrying the
/// fresh roster, so the popup re-renders without waiting for its poll.
pub struct AgentWatcher {
    restart: watch::Sender<u64>,
    states: AgentStateBaseline,
}

impl AgentWatcher {
    /// Restart the stream (new/removed credential) and drop the baseline so
    /// a different account's roster never diffs against the previous one.
    fn restart(&self) {
        if let Ok(mut states) = self.states.lock() {
            *states = None;
        }
        self.restart.send_modify(|generation| *generation += 1);
    }
}

/// Map an image content type to the file extension the notification backends
/// decode by. Anything that is not an image degrades to a plain notification.
fn avatar_extension(content_type: Option<&str>) -> Option<&'static str> {
    match content_type.map(|value| value.split(';').next().unwrap_or("").trim()) {
        Some("image/png") => Some("png"),
        Some("image/jpeg") => Some("jpg"),
        Some("image/webp") => Some("webp"),
        Some("image/gif") => Some("gif"),
        _ => None,
    }
}

/// Cache an agent's avatar under the app cache dir, keyed by agent id and URL
/// content so a re-upload lands on a fresh path (backends cache by path) and
/// stale variants get pruned. Returns the path for `Notification::image_path`.
fn cache_agent_avatar(cache_dir: &Path, agent_id: &str, url: &str) -> Option<PathBuf> {
    let url = url.trim();
    if url.is_empty() {
        return None;
    }

    let mut request = reqwest::blocking::Client::new().get(url);
    if let Ok(config) = discover_client_config() {
        request = request.bearer_auth(config.api_key.expose_secret());
    }
    let response = request
        .send()
        .and_then(|response| response.error_for_status())
        .ok()?;
    let content_type = response
        .headers()
        .get(reqwest::header::CONTENT_TYPE)
        .and_then(|value| value.to_str().ok())
        .map(str::to_owned);
    let bytes = response.bytes().ok()?;
    if bytes.is_empty() || bytes.len() > 10 * 1024 * 1024 {
        return None;
    }
    let extension = avatar_extension(content_type.as_deref())?;

    let dir = cache_dir.join("avatars");
    std::fs::create_dir_all(&dir).ok()?;

    let fingerprint: u64 = {
        use std::hash::{Hash, Hasher};
        let mut hasher = std::collections::hash_map::DefaultHasher::new();
        url.hash(&mut hasher);
        hasher.finish()
    };
    let file_name = format!("{agent_id}-{fingerprint:x}.{extension}");
    for entry in std::fs::read_dir(&dir).into_iter().flatten().flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if name.starts_with(&format!("{agent_id}-")) && name != file_name {
            let _ = std::fs::remove_file(entry.path());
        }
    }
    let path = dir.join(file_name);
    if !path.exists() {
        std::fs::write(&path, &bytes).ok()?;
    }
    Some(path)
}

/// Push a lifecycle transition to the OS notification center with the agent
/// avatar as the image (macOS attachment / XDG image on Linux). Goes through
/// notify-rust directly: the Tauri plugin wraps it but hides `image_path`.
fn notify_lifecycle(name: &str, from: &str, to: &str, avatar: Option<&std::path::Path>) {
    let body = match to {
        "running" if from != "running" => Some(format!("{name} is online")),
        "failed" => Some(format!("{name} failed")),
        "stopped" if from == "running" => Some(format!("{name} stopped")),
        _ => None,
    };
    let Some(body) = body else { return };

    let mut notification = notify_rust::Notification::new();
    notification.summary("HyperCLI").body(&body);
    if let Some(avatar) = avatar {
        notification.image_path(&avatar.to_string_lossy());
    }
    if let Err(error) = notification.show() {
        eprintln!("hypercli-menubar: notification failed: {error}");
    }
}

fn fetch_launcher_agents() -> Result<Vec<LauncherAgent>, String> {
    let config = discover_client_config().map_err(|error| error.to_string())?;
    let resources = fetch_deployment_resources(&config);
    let capacity = HyperCliClient::new(config)
        .map_err(|error| error.to_string())?
        .list_deployments_with_capacity()
        .map_err(|error| error.to_string())?;
    Ok(capacity
        .items
        .into_iter()
        .map(|deployment| {
            let resources = resources.get(&deployment.id);
            LauncherAgent::from(deployment).with_resources(resources)
        })
        .collect())
}

async fn run_agent_watcher(
    app: tauri::AppHandle,
    states: AgentStateBaseline,
    mut restart: watch::Receiver<u64>,
) {
    let (invalidate_tx, mut invalidate_rx) = mpsc::channel::<()>(8);
    let avatar_cache_dir = app.path().app_cache_dir().unwrap_or_else(|_| {
        dirs::cache_dir()
            .unwrap_or_else(std::env::temp_dir)
            .join("hypercli-menubar")
    });
    // Debounced refetch task: coalesce bursts of stream events into one
    // roster refetch, diff, notify, and push the roster to the popup.
    let refetch_app = app.clone();
    tauri::async_runtime::spawn(async move {
        while invalidate_rx.recv().await.is_some() {
            while invalidate_rx.try_recv().is_ok() {}
            tokio::time::sleep(Duration::from_millis(500)).await;
            let agents = match tauri::async_runtime::spawn_blocking(fetch_launcher_agents).await {
                Ok(Ok(agents)) => agents,
                _ => continue,
            };
            let transitions: Vec<(String, String, String, String, Option<String>)> = {
                let mut known = states.lock().unwrap_or_else(|error| error.into_inner());
                let mut transitions = Vec::new();
                if let Some(known) = known.as_mut() {
                    for agent in &agents {
                        if let Some((name, previous, _)) = known.get(&agent.id) {
                            if *previous != agent.state {
                                transitions.push((
                                    agent.id.clone(),
                                    name.clone(),
                                    previous.clone(),
                                    agent.state.clone(),
                                    agent.avatar_url.clone(),
                                ));
                            }
                        }
                    }
                    *known = agents
                        .iter()
                        .map(|agent| {
                            (
                                agent.id.clone(),
                                (
                                    agent.name.clone(),
                                    agent.state.clone(),
                                    agent.avatar_url.clone(),
                                ),
                            )
                        })
                        .collect();
                } else {
                    *known = Some(
                        agents
                            .iter()
                            .map(|agent| {
                                (
                                    agent.id.clone(),
                                    (
                                        agent.name.clone(),
                                        agent.state.clone(),
                                        agent.avatar_url.clone(),
                                    ),
                                )
                            })
                            .collect(),
                    );
                }
                transitions
            };
            for (agent_id, name, previous, state, avatar_url) in transitions {
                // Avatar downloads stay off the async executor; the
                // notification falls back to plain text when they fail.
                let avatar_path = match avatar_url.filter(|url| !url.trim().is_empty()) {
                    Some(url) => {
                        let cache_dir = avatar_cache_dir.clone();
                        tauri::async_runtime::spawn_blocking(move || {
                            cache_agent_avatar(&cache_dir, &agent_id, &url)
                        })
                        .await
                        .ok()
                        .flatten()
                    }
                    None => None,
                };
                notify_lifecycle(&name, &previous, &state, avatar_path.as_deref());
            }
            let _ = refetch_app.emit("agents-updated", agents);
        }
    });

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
            let tx = invalidate_tx.clone();
            tokio::select! {
                result = event_client.subscribe_deployments(move |_| {
                    let _ = tx.try_send(());
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

pub fn run() {
    // Single-instance must be the first registered plugin (Buzz pattern):
    // its callback receives the second instance's argv, which on Windows and
    // Linux carries the hypercli:// deep link.
    tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            for arg in argv {
                if arg.starts_with("hypercli://") {
                    if let Some(token) = token_from_callback(&arg) {
                        deliver_auth_token(app, token);
                    }
                }
            }
        }))
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
        .setup(|app| {
            // Menubar-only on macOS: no Dock icon, no Cmd-Tab entry.
            #[cfg(target_os = "macos")]
            app.set_activation_policy(tauri::ActivationPolicy::Accessory);

            init_tray(app)?;

            let (watcher_restart, watcher_rx) = watch::channel(0_u64);
            let watcher_states = Arc::new(Mutex::new(None));
            app.manage(AgentWatcher {
                restart: watcher_restart,
                states: Arc::clone(&watcher_states),
            });
            let watcher_handle = app.handle().clone();
            tauri::async_runtime::spawn(run_agent_watcher(
                watcher_handle,
                watcher_states,
                watcher_rx,
            ));

            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    if let Some(token) = token_from_callback(url.as_str()) {
                        deliver_auth_token(&handle, token);
                    }
                }
            });

            Ok(())
        })
        .on_window_event(|window, event| {
            // Click-away dismissal, like a native macOS menu popover. Only
            // the popup; secondary windows (onboarding) manage themselves.
            if window.label() == "main" {
                if let tauri::WindowEvent::Focused(false) = event {
                    let _ = window.hide();
                }
            }
        })
        .invoke_handler(tauri::generate_handler![
            start_login,
            mint_api_key,
            save_api_key,
            logout,
            validate_key,
            list_agents,
            create_agent,
            buzz_launch::create_buzz_agent,
            buzz_launch::list_buzz_connections,
            buzz_launch::save_buzz_connection,
            buzz_launch::remove_buzz_connection,
            buzz_launch::list_buzz_channels,
            start_agent,
            stop_agent,
            archive_agent,
            delete_agent,
            set_agent_avatar,
            agent_metrics,
            draft_agent_prompt,
            list_models,
            open_agent_chat,
            open_dashboard,
            open_create_window,
            open_settings_window,
            open_main_window,
        ])
        .run(tauri::generate_context!())
        .expect("error while running hypercli menubar app");
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn token_from_callback_reads_fragment_token() {
        let token = token_from_callback("hypercli://auth#token=abc123").unwrap();
        assert_eq!(token, "abc123");
    }

    #[test]
    fn token_from_callback_percent_decodes() {
        let token = token_from_callback("hypercli://auth#token=a%2Fb%3D").unwrap();
        assert_eq!(token, "a/b=");
    }

    #[test]
    fn token_from_callback_rejects_wrong_scheme() {
        assert!(token_from_callback("https://auth#token=abc").is_none());
        assert!(token_from_callback("hypercli://other#token=abc").is_none());
        assert!(token_from_callback("hypercli://auth").is_none());
        assert!(token_from_callback("hypercli://auth#token=").is_none());
    }

    #[test]
    fn agent_actions_match_state() {
        assert!(agent_actions("STOPPED").start);
        assert!(!agent_actions("running").start);
        assert!(agent_actions("running").stop);
        assert!(agent_actions("creating").stop);
        assert!(!agent_actions("failed").start);
        assert!(!agent_actions("failed").stop);
        assert!(!agent_actions("archived").start);
        assert!(!agent_actions("archived").stop);
    }

    #[test]
    fn launcher_agent_marks_archived() {
        let deployment = Deployment {
            archived_at: Some("2026-08-01T00:00:00Z".to_owned()),
            ..Default::default()
        };
        let agent = LauncherAgent::from(deployment);
        assert!(agent.archived);
        assert!(!agent.can_start);
        assert!(!agent.can_stop);

        let deployment = Deployment {
            state: "archived".to_owned(),
            ..Default::default()
        };
        assert!(LauncherAgent::from(deployment).archived);
    }

    #[test]
    fn avatar_extension_maps_image_types() {
        assert_eq!(avatar_extension(Some("image/png")), Some("png"));
        assert_eq!(avatar_extension(Some("image/jpeg")), Some("jpg"));
        assert_eq!(
            avatar_extension(Some("image/jpeg; charset=binary")),
            Some("jpg")
        );
        assert_eq!(avatar_extension(Some("image/webp")), Some("webp"));
        assert_eq!(avatar_extension(Some("image/gif")), Some("gif"));
    }

    #[test]
    fn avatar_extension_rejects_non_images() {
        assert_eq!(avatar_extension(Some("text/html")), None);
        assert_eq!(avatar_extension(None), None);
        assert_eq!(avatar_extension(Some("application/octet-stream")), None);
    }
}
