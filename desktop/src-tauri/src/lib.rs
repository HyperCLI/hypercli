use hypercli_sdk::{
    discover_agents_api_base, discover_client_config, remove_config_api_keys,
    save_api_key as persist_api_key, AgentSize, BuzzLaunchConfig, ClientConfig,
    CreateDeploymentRequest, Deployment, DeploymentProfileImageResponse, HermesLaunchConfig,
    HyperCliClient, HyperCliError, ManagedRuntime, OpenClawLaunchConfig, StartDeploymentRequest,
};
use secrecy::{ExposeSecret, SecretString};
use serde::Serialize;
use tauri::{AppHandle, Emitter};

#[derive(Clone, Serialize)]
struct AuthStatus {
    signed_in: bool,
    api_base: String,
}

#[derive(Clone, Debug, Serialize)]
struct AgentSummary {
    id: String,
    name: String,
    handle: Option<String>,
    avatar_url: Option<String>,
    runtime: Option<String>,
    state: String,
    hostname: Option<String>,
    launch_epoch: u64,
    has_desktop: bool,
    size: Option<String>,
}

#[derive(Clone, Serialize)]
struct AgentFileBytes {
    bytes: Vec<u8>,
}

impl From<Deployment> for AgentSummary {
    fn from(d: Deployment) -> Self {
        let runtime = d
            .runtime
            .and_then(|r| serde_json::to_value(r).ok())
            .and_then(|v| v.as_str().map(str::to_owned));
        let has_desktop = deployment_has_desktop(&d);
        Self {
            id: d.id,
            name: d.name,
            handle: d.handle,
            avatar_url: d.avatar_url,
            runtime,
            state: d.state,
            hostname: d.hostname,
            launch_epoch: d.launch_epoch,
            has_desktop,
            size: d
                .requested_size
                .and_then(|s| serde_json::to_value(s).ok())
                .and_then(|v| v.as_str().map(str::to_owned)),
        }
    }
}

fn truthy_env(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn falsey_env(value: &str) -> bool {
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "0" | "false" | "no" | "off"
    )
}

fn deployment_has_desktop(deployment: &Deployment) -> bool {
    let launch = deployment.launch_config.as_map();
    if let Some(value) = launch
        .get("env")
        .and_then(|env| env.get("HYPER_DESKTOP_ENABLED"))
        .and_then(serde_json::Value::as_str)
    {
        if falsey_env(value) {
            return false;
        }
        if truthy_env(value) {
            return true;
        }
    }
    launch
        .get("routes")
        .and_then(serde_json::Value::as_object)
        .is_some_and(|routes| {
            routes
                .get("desktop")
                .and_then(serde_json::Value::as_object)
                .is_some()
                || routes.values().any(|route| {
                    route
                        .get("prefix")
                        .and_then(serde_json::Value::as_str)
                        .is_some_and(|prefix| prefix == "desktop")
                })
        })
}

fn auth_status_inner() -> AuthStatus {
    let api_base = discover_agents_api_base()
        .map(|u| u.to_string())
        .unwrap_or_default();
    let signed_in = discover_client_config().is_ok();
    AuthStatus {
        signed_in,
        api_base,
    }
}

fn client() -> Result<HyperCliClient, String> {
    let config = discover_client_config().map_err(|e| e.to_string())?;
    HyperCliClient::new(config).map_err(friendly)
}

/// Maps backend failures to product-facing copy. Raw transport/parse errors
/// pass through so they stay debuggable.
fn friendly(error: HyperCliError) -> String {
    match error.status().map(|s| s.as_u16()) {
        Some(401) | Some(403) => "Your sign-in isn't working — sign in again.".to_owned(),
        Some(404) => "That agent is gone — it may have been deleted.".to_owned(),
        Some(409) => "Not ready for that yet — give it a moment and try again.".to_owned(),
        Some(429) => "The backend is rate limiting right now — wait a few seconds.".to_owned(),
        Some(status) if status >= 500 => {
            "HyperCLI is having trouble right now — try again shortly.".to_owned()
        }
        _ => error.to_string(),
    }
}

fn gateway_token() -> String {
    format!(
        "{}{}",
        uuid::Uuid::new_v4().simple(),
        uuid::Uuid::new_v4().simple()
    )
}

fn agent_system_prompt(name: &str, runtime: &str) -> String {
    format!(
        "You are a HyperCLI hosted agent running in HyperCLI Desktop.\nAgent name: {name}.\nRuntime: {runtime}.\nYou have a persistent cloud workspace at /home/node.\nWhen asked who you are, answer as this HyperCLI agent, not only as the underlying runtime CLI."
    )
}

fn parse_agent_size(size: &str) -> Result<AgentSize, String> {
    serde_json::from_str::<AgentSize>(&format!("\"{size}\""))
        .map_err(|e| format!("unknown size {size}: {e}"))
}

fn default_agent_size(config: &ClientConfig) -> Result<AgentSize, String> {
    let url = format!(
        "{}/plans/current",
        config.api_base.as_str().trim_end_matches('/')
    );
    let response = reqwest::blocking::Client::new()
        .get(url)
        .bearer_auth(config.api_key.expose_secret())
        .send()
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return parse_agent_size("small");
    }
    let plan = response
        .json::<serde_json::Value>()
        .map_err(|e| e.to_string())?;
    if let Some(inventory) = plan.get("slot_inventory").and_then(|v| v.as_object()) {
        for size in ["large", "medium", "small"] {
            let available = inventory
                .get(size)
                .and_then(|row| row.get("available"))
                .and_then(|value| value.as_i64())
                .unwrap_or(0);
            if available > 0 {
                return parse_agent_size(size);
            }
        }
    }
    if let Some(size) = plan.get("max_agent_size").and_then(|value| value.as_str()) {
        if ["large", "medium", "small"].contains(&size) {
            return parse_agent_size(size);
        }
    }
    parse_agent_size("small")
}

#[tauri::command]
fn auth_status() -> AuthStatus {
    auth_status_inner()
}

#[tauri::command]
async fn save_api_key(key: String) -> Result<AuthStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let key = key.trim().to_owned();
        if key.is_empty() {
            return Err("API key is empty".to_owned());
        }
        let api_base = discover_agents_api_base().map_err(|e| e.to_string())?;
        let config = ClientConfig {
            api_base,
            api_key: SecretString::from(key.clone()),
            trace_file: None,
            timeout: None,
        };
        let client = HyperCliClient::new(config).map_err(friendly)?;
        client.list_deployments().map_err(friendly)?;
        let home = dirs::home_dir().ok_or("no home directory".to_owned())?;
        persist_api_key(&home, &key).map_err(|e| e.to_string())?;
        Ok(auth_status_inner())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn logout() -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(|| {
        let home = dirs::home_dir().ok_or("no home directory".to_owned())?;
        remove_config_api_keys(&home).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn list_agents() -> Result<Vec<AgentSummary>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = client()?;
        let mut agents: Vec<AgentSummary> = client
            .list_deployments()
            .map_err(friendly)?
            .into_iter()
            .map(AgentSummary::from)
            .collect();
        agents.sort_by_key(|agent| agent.name.to_lowercase());
        Ok(agents)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn start_agent(id: String) -> Result<AgentSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = client()?;
        let current = client.get_deployment(&id).map_err(friendly)?;
        let launch = client.stored_launch_config(&id, None).map_err(friendly)?;
        let mut request = StartDeploymentRequest::new(launch);
        let runtime = current
            .runtime
            .as_ref()
            .and_then(|r| serde_json::to_value(r).ok())
            .and_then(|v| v.as_str().map(str::to_owned))
            .unwrap_or_default();
        if runtime == "openclaw" || runtime == "openclaw-pro" {
            if request
                .launch_config
                .secrets
                .get("OPENCLAW_GATEWAY_TOKEN")
                .is_none_or(|v| v.trim().is_empty())
            {
                let token = gateway_token();
                client
                    .set_deployment_secret(&id, "OPENCLAW_GATEWAY_TOKEN", &token)
                    .map_err(friendly)?;
                request
                    .launch_config
                    .secrets
                    .insert("OPENCLAW_GATEWAY_TOKEN".to_owned(), token);
            }
            let desktop = runtime == "openclaw-pro"
                || request
                    .launch_config
                    .env
                    .get("HYPER_DESKTOP_ENABLED")
                    .is_some_and(|v| v == "1" || v.eq_ignore_ascii_case("true"));
            if desktop {
                OpenClawLaunchConfig::desktop().apply_to_start(&mut request);
            } else {
                OpenClawLaunchConfig::new().apply_to_start(&mut request);
            }
            request.launch_config.env.insert(
                "OPENCLAW_CONTROL_UI_ALLOWED_ORIGIN".to_owned(),
                "http://localhost:1420".to_owned(),
            );
        }
        client
            .start_deployment(&id, &request)
            .map(AgentSummary::from)
            .map_err(friendly)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn stop_agent(id: String) -> Result<AgentSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = client()?;
        client
            .stop_deployment(&id)
            .map(AgentSummary::from)
            .map_err(friendly)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn create_agent(
    name: String,
    runtime: String,
    size: Option<String>,
    image: Option<String>,
    buzz_private_key_nsec: Option<String>,
    buzz_relay_url: Option<String>,
) -> Result<AgentSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let runtime: ManagedRuntime = serde_json::from_str(&format!("\"{runtime}\""))
            .map_err(|e| format!("unknown runtime {runtime}: {e}"))?;
        let config = discover_client_config().map_err(|e| e.to_string())?;
        let parsed_size = match size {
            Some(size) => Some(parse_agent_size(&size)?),
            None => Some(default_agent_size(&config)?),
        };
        let image = image
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let buzz_private_key_nsec = buzz_private_key_nsec
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let buzz_relay_url = buzz_relay_url
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
            .unwrap_or_else(|| "wss://relay.buzz.hypercli.com".to_owned());
        let mut request = if runtime == ManagedRuntime::Openclaw {
            let mut request =
                CreateDeploymentRequest::openclaw(Some(name.clone()), parsed_size, false);
            request
                .secrets
                .insert("OPENCLAW_GATEWAY_TOKEN".to_owned(), gateway_token());
            request
        } else if runtime == ManagedRuntime::OpenclawPro {
            let mut request =
                CreateDeploymentRequest::openclaw(Some(name.clone()), parsed_size, true);
            request
                .secrets
                .insert("OPENCLAW_GATEWAY_TOKEN".to_owned(), gateway_token());
            request
        } else {
            let mut request = CreateDeploymentRequest::new(runtime);
            request.name = Some(name.clone());
            request.size = parsed_size;
            if runtime == ManagedRuntime::HermesAgent {
                HermesLaunchConfig::generated().apply_to_create(&mut request);
            }
            request
        };
        if let Some(image) = image {
            request.image = Some(image);
        }
        if matches!(
            runtime,
            ManagedRuntime::BuzzAgent
                | ManagedRuntime::Opencode
                | ManagedRuntime::Codex
                | ManagedRuntime::ClaudeCode
                | ManagedRuntime::Goose
                | ManagedRuntime::KimiCode
        ) {
            request
                .env
                .entry("HYPER_ACP_PERMISSION_MODE".to_owned())
                .or_insert_with(|| "default".to_owned());
        }
        if runtime == ManagedRuntime::BuzzAgent {
            let private_key = buzz_private_key_nsec
                .ok_or_else(|| "Buzz Agent requires an nsec private key.".to_owned())?;
            let mut buzz = BuzzLaunchConfig::new(private_key, buzz_relay_url);
            buzz.display_name = Some(name.clone());
            buzz.session_title = Some(name.clone());
            buzz.system_prompt = Some(agent_system_prompt(&name, "buzz-agent"));
            buzz.apply_to(&mut request, Some(&name))
                .map_err(|e| e.to_string())?;
        }
        let client = HyperCliClient::new(config).map_err(friendly)?;
        client
            .create_deployment(&request)
            .map(AgentSummary::from)
            .map_err(friendly)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn archive_agent(id: String) -> Result<AgentSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = client()?;
        client
            .archive_deployment(&id)
            .map(AgentSummary::from)
            .map_err(friendly)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn restore_agent(id: String) -> Result<AgentSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = client()?;
        client
            .restore_deployment(&id)
            .map(AgentSummary::from)
            .map_err(friendly)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_agent(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = client()?;
        client.delete_deployment(&id).map_err(friendly)?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn set_agent_desktop_enabled(id: String, enabled: bool) -> Result<AgentSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = client()?;
        client
            .set_deployment_env(
                &id,
                "HYPER_DESKTOP_ENABLED",
                if enabled { "1" } else { "0" },
            )
            .map_err(friendly)?;
        if enabled {
            let route = hypercli_sdk::SetDeploymentRouteRequest {
                port: 3000,
                auth: true,
                prefix: Some("desktop".to_owned()),
            };
            client
                .set_deployment_route(&id, "desktop", &route)
                .map_err(friendly)?;
        } else {
            client
                .remove_deployment_route(&id, "desktop")
                .map_err(friendly)?;
        }
        client
            .get_deployment(&id)
            .map(AgentSummary::from)
            .map_err(friendly)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn upload_agent_avatar(
    id: String,
    content: Vec<u8>,
    content_type: String,
) -> Result<DeploymentProfileImageResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        if content.is_empty() {
            return Err("Avatar image is missing".to_owned());
        }
        let content_type = if content_type.trim().is_empty() {
            "image/png".to_owned()
        } else {
            content_type
        };
        let client = client()?;
        client
            .upload_deployment_profile_image(&id, &content, &content_type)
            .map_err(friendly)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn delete_agent_avatar(id: String) -> Result<DeploymentProfileImageResponse, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let client = client()?;
        client
            .delete_deployment_profile_image(&id)
            .map_err(friendly)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Clone, Serialize)]
struct PlanSummary {
    name: String,
    agents: u32,
    renews_at: Option<String>,
}

#[tauri::command]
async fn plan_summary() -> Result<PlanSummary, String> {
    tauri::async_runtime::spawn_blocking(|| {
        let client = client()?;
        let plan = client.current_plan().map_err(friendly)?;
        let name = if plan.name.is_empty() {
            plan.id.clone()
        } else {
            plan.name
        };
        let renews_at = plan
            .agent_slots
            .iter()
            .filter_map(|slot| slot.expires_at.clone())
            .min();
        Ok(PlanSummary {
            name,
            agents: plan.agents,
            renews_at,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Clone, Serialize, serde::Deserialize)]
struct UsageMetrics {
    total_tokens: u64,
    prompt_tokens: u64,
    completion_tokens: u64,
    requests: u64,
}

#[derive(Clone, Serialize, serde::Deserialize)]
struct UsageDay {
    date: String,
    total_tokens: u64,
    prompt_tokens: u64,
    completion_tokens: u64,
    requests: u64,
}

#[derive(Clone, Serialize, serde::Deserialize)]
struct UsageKeyEntry {
    key_hash: String,
    name: String,
    total_tokens: u64,
    prompt_tokens: u64,
    completion_tokens: u64,
    requests: u64,
}

#[derive(Clone, Serialize, serde::Deserialize)]
struct UsageAgentEntry {
    agent_id: String,
    name: String,
    #[serde(default)]
    managed: bool,
    avatar_url: Option<String>,
    total_tokens: u64,
    prompt_tokens: u64,
    completion_tokens: u64,
    requests: u64,
}

#[derive(Clone, Serialize)]
struct UsageSummary {
    days: u32,
    history: Option<Vec<UsageDay>>,
    keys: Option<Vec<UsageKeyEntry>>,
    agents: Option<Vec<UsageAgentEntry>>,
    unattributed: Option<UsageMetrics>,
}

#[derive(serde::Deserialize)]
struct UsageHistoryResponse {
    #[serde(default)]
    history: Vec<UsageDay>,
}

#[derive(serde::Deserialize)]
struct UsageKeysResponse {
    #[serde(default)]
    keys: Vec<UsageKeyEntry>,
}

#[derive(serde::Deserialize)]
struct UsageAgentsResponse {
    #[serde(default)]
    agents: Vec<UsageAgentEntry>,
    #[serde(default)]
    unattributed: Option<UsageMetrics>,
}

fn usage_get<T: serde::de::DeserializeOwned>(path: &str) -> Result<T, String> {
    let config = discover_client_config().map_err(|e| e.to_string())?;
    let url = format!(
        "{}/{}",
        config.api_base.as_str().trim_end_matches('/'),
        path
    );
    let response = reqwest::blocking::Client::new()
        .get(url)
        .bearer_auth(config.api_key.expose_secret())
        .send()
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(if body.trim().is_empty() {
            format!(
                "{} {}",
                status.as_u16(),
                status.canonical_reason().unwrap_or("error")
            )
        } else {
            format!(
                "{} {}: {}",
                status.as_u16(),
                status.canonical_reason().unwrap_or("error"),
                body.trim()
            )
        });
    }
    response.json::<T>().map_err(|e| e.to_string())
}

#[tauri::command]
async fn usage_summary(days: Option<u32>) -> Result<UsageSummary, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let days = days.unwrap_or(7).clamp(1, 90);
        discover_client_config().map_err(|e| e.to_string())?;
        let history = usage_get::<UsageHistoryResponse>(&format!("usage/history?days={days}"));
        let keys = usage_get::<UsageKeysResponse>(&format!("usage/keys?days={days}"));
        let agents = usage_get::<UsageAgentsResponse>(&format!("usage/agents?days={days}"));
        let (agent_rows, unattributed) = match agents {
            Ok(response) => (Some(response.agents), response.unattributed),
            Err(_) => (None, None),
        };
        Ok(UsageSummary {
            days,
            history: history.ok().map(|response| response.history),
            keys: keys.ok().map(|response| response.keys),
            agents: agent_rows,
            unattributed,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Clone, Serialize, serde::Deserialize)]
struct Routine {
    id: String,
    user_id: Option<String>,
    agent_id: Option<String>,
    name: Option<String>,
    cron: Option<String>,
    prompt: String,
    enabled: bool,
    run_at: Option<String>,
    next_run_at: Option<String>,
    created_at: Option<String>,
    updated_at: Option<String>,
}

#[derive(serde::Deserialize)]
#[serde(untagged)]
enum RoutineListResponse {
    List(Vec<Routine>),
    Wrapped { routines: Vec<Routine> },
}

/// Routines live at the agents API host root (`/routines`), while
/// `api_base` points at `…/agents`; strip that suffix to reach the root.
fn routines_http(
    method: reqwest::Method,
    path: &str,
    body: Option<serde_json::Value>,
) -> Result<String, String> {
    let config = discover_client_config().map_err(|e| e.to_string())?;
    let base = config.api_base.as_str().trim_end_matches('/');
    let root = base.strip_suffix("/agents").unwrap_or(base);
    let url = format!("{root}/{path}");
    let mut request = reqwest::blocking::Client::new()
        .request(method, url)
        .bearer_auth(config.api_key.expose_secret());
    if let Some(body) = body {
        request = request.json(&body);
    }
    let response = request.send().map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        let status = response.status();
        let body = response.text().unwrap_or_default();
        return Err(if body.trim().is_empty() {
            format!(
                "{} {}",
                status.as_u16(),
                status.canonical_reason().unwrap_or("error")
            )
        } else {
            format!(
                "{} {}: {}",
                status.as_u16(),
                status.canonical_reason().unwrap_or("error"),
                body.trim()
            )
        });
    }
    response.text().map_err(|e| e.to_string())
}

fn nullable_string(value: String) -> serde_json::Value {
    if value.trim().is_empty() {
        serde_json::Value::Null
    } else {
        serde_json::Value::String(value)
    }
}

#[tauri::command]
async fn routines_list(agent_id: Option<String>) -> Result<Vec<Routine>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let path = match agent_id.as_deref().map(str::trim).filter(|v| !v.is_empty()) {
            Some(id) => format!("routines?agent_id={id}"),
            None => "routines".to_owned(),
        };
        let body = routines_http(reqwest::Method::GET, &path, None)?;
        match serde_json::from_str::<RoutineListResponse>(&body).map_err(|e| e.to_string())? {
            RoutineListResponse::List(routines) | RoutineListResponse::Wrapped { routines } => {
                Ok(routines)
            }
        }
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn routines_create(
    agent_id: String,
    cron: Option<String>,
    run_at: Option<String>,
    name: Option<String>,
    prompt: String,
    enabled: Option<bool>,
) -> Result<Routine, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let cron = cron
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        let run_at = run_at
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty());
        if cron.is_none() && run_at.is_none() {
            return Err("Missing schedule (cron or run_at)".to_owned());
        }
        if prompt.trim().is_empty() {
            return Err("Missing prompt".to_owned());
        }
        let mut body = serde_json::Map::new();
        body.insert("agent_id".to_owned(), serde_json::Value::String(agent_id));
        body.insert("prompt".to_owned(), serde_json::Value::String(prompt));
        body.insert(
            "enabled".to_owned(),
            serde_json::Value::Bool(enabled.unwrap_or(true)),
        );
        if let Some(cron) = cron {
            body.insert("cron".to_owned(), serde_json::Value::String(cron));
        }
        if let Some(run_at) = run_at {
            body.insert("run_at".to_owned(), serde_json::Value::String(run_at));
        }
        if let Some(name) = name
            .map(|value| value.trim().to_owned())
            .filter(|value| !value.is_empty())
        {
            body.insert("name".to_owned(), serde_json::Value::String(name));
        }
        let body = routines_http(
            reqwest::Method::POST,
            "routines",
            Some(serde_json::Value::Object(body)),
        )?;
        serde_json::from_str::<Routine>(&body).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn routines_update(
    id: String,
    cron: Option<String>,
    run_at: Option<String>,
    name: Option<String>,
    prompt: Option<String>,
    enabled: Option<bool>,
) -> Result<Routine, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut patch = serde_json::Map::new();
        if let Some(cron) = cron {
            patch.insert("cron".to_owned(), nullable_string(cron));
        }
        if let Some(run_at) = run_at {
            patch.insert("run_at".to_owned(), nullable_string(run_at));
        }
        if let Some(name) = name {
            patch.insert("name".to_owned(), nullable_string(name));
        }
        if let Some(prompt) = prompt {
            patch.insert("prompt".to_owned(), serde_json::Value::String(prompt));
        }
        if let Some(enabled) = enabled {
            patch.insert("enabled".to_owned(), serde_json::Value::Bool(enabled));
        }
        if patch.is_empty() {
            return Err("Nothing to update".to_owned());
        }
        let body = routines_http(
            reqwest::Method::PATCH,
            &format!("routines/{id}"),
            Some(serde_json::Value::Object(patch)),
        )?;
        serde_json::from_str::<Routine>(&body).map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn routines_delete(id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        routines_http(reqwest::Method::DELETE, &format!("routines/{id}"), None)?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Clone, Serialize)]
struct AcpCredentials {
    api_base: String,
    token: String,
}

#[derive(Clone, Serialize, serde::Deserialize)]
struct AgentLogsToken {
    agent_id: Option<String>,
    #[serde(alias = "jwt")]
    token: String,
    expires_at: Option<String>,
    ws_url: Option<String>,
    #[serde(default)]
    api_base: String,
}

#[tauri::command]
async fn agent_logs_token(id: String) -> Result<AgentLogsToken, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = discover_client_config().map_err(|e| e.to_string())?;
        let url = format!(
            "{}/deployments/{}/logs/token",
            config.api_base.as_str().trim_end_matches('/'),
            id
        );
        let response = reqwest::blocking::Client::new()
            .post(url)
            .bearer_auth(config.api_key.expose_secret())
            .send()
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().unwrap_or_default();
            return Err(if body.trim().is_empty() {
                format!(
                    "{} {}",
                    status.as_u16(),
                    status.canonical_reason().unwrap_or("error")
                )
            } else {
                format!(
                    "{} {}: {}",
                    status.as_u16(),
                    status.canonical_reason().unwrap_or("error"),
                    body.trim()
                )
            });
        }
        let mut token = response
            .json::<AgentLogsToken>()
            .map_err(|e| e.to_string())?;
        token.api_base = config.api_base.to_string();
        Ok(token)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Clone, Serialize, serde::Deserialize)]
struct AgentShellToken {
    #[serde(alias = "jwt")]
    token: String,
    ws_url: String,
    #[serde(default)]
    shell: String,
}

#[tauri::command]
async fn agent_shell_token(id: String, shell: Option<String>) -> Result<AgentShellToken, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = discover_client_config().map_err(|e| e.to_string())?;
        let url = format!(
            "{}/deployments/{}/shell/token",
            config.api_base.as_str().trim_end_matches('/'),
            id
        );
        let response = reqwest::blocking::Client::new()
            .post(url)
            .bearer_auth(config.api_key.expose_secret())
            .json(&serde_json::json!({
                "shell": shell.as_deref().unwrap_or("/bin/bash")
            }))
            .send()
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().unwrap_or_default();
            return Err(if body.trim().is_empty() {
                format!(
                    "{} {}",
                    status.as_u16(),
                    status.canonical_reason().unwrap_or("error")
                )
            } else {
                format!(
                    "{} {}: {}",
                    status.as_u16(),
                    status.canonical_reason().unwrap_or("error"),
                    body.trim()
                )
            });
        }
        response
            .json::<AgentShellToken>()
            .map_err(|e| e.to_string())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[derive(Clone, Serialize)]
struct AgentDesktopUrl {
    url: String,
    expires_at: Option<String>,
}

#[tauri::command]
async fn agent_desktop_url(id: String) -> Result<AgentDesktopUrl, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let config = discover_client_config().map_err(|e| e.to_string())?;
        let http = reqwest::blocking::Client::new();
        let token_url = format!(
            "{}/deployments/{}/token",
            config.api_base.as_str().trim_end_matches('/'),
            id
        );
        let response = http
            .get(token_url)
            .bearer_auth(config.api_key.expose_secret())
            .send()
            .map_err(|e| e.to_string())?;
        if !response.status().is_success() {
            let status = response.status();
            let body = response.text().unwrap_or_default();
            return Err(if body.trim().is_empty() {
                format!(
                    "{} {}",
                    status.as_u16(),
                    status.canonical_reason().unwrap_or("error")
                )
            } else {
                format!(
                    "{} {}: {}",
                    status.as_u16(),
                    status.canonical_reason().unwrap_or("error"),
                    body.trim()
                )
            });
        }
        let token: serde_json::Value = response.json().map_err(|e| e.to_string())?;
        let jwt = token
            .get("jwt")
            .or_else(|| token.get("token"))
            .and_then(serde_json::Value::as_str)
            .map(str::trim)
            .filter(|value| !value.is_empty())
            .ok_or_else(|| "Desktop token is missing".to_owned())?;
        let expires_at = token
            .get("expires_at")
            .and_then(serde_json::Value::as_str)
            .map(str::to_owned);

        let deployment = client()?.get_deployment(&id).map_err(friendly)?;
        if deployment.state != "RUNNING" {
            return Err("Start the agent to open its desktop".to_owned());
        }
        let hostname = deployment
            .hostname
            .clone()
            .ok_or_else(|| "Agent hostname is unavailable".to_owned())?;
        let launch = deployment.launch_config.as_map();
        let routes = launch.get("routes").and_then(serde_json::Value::as_object);
        let prefix = routes.and_then(|routes| {
            if routes
                .get("desktop")
                .and_then(serde_json::Value::as_object)
                .is_some()
            {
                return Some("desktop".to_owned());
            }
            routes.values().find_map(|route| {
                route
                    .get("prefix")
                    .and_then(serde_json::Value::as_str)
                    .filter(|prefix| *prefix == "desktop")
                    .map(str::to_owned)
            })
        });
        let prefix = match prefix {
            Some(prefix) => prefix,
            None => return Err("Desktop route is not enabled for this agent".to_owned()),
        };
        let base = if prefix.is_empty() {
            format!("https://{hostname}")
        } else {
            format!("https://{prefix}-{hostname}")
        };
        let mut auth = url::Url::parse(&format!("{base}/_jwt_auth")).map_err(|e| e.to_string())?;
        auth.query_pairs_mut()
            .append_pair("jwt", jwt)
            .append_pair("redirect", "vnc.html?autoconnect=true&resize=scale");
        Ok(AgentDesktopUrl {
            url: auth.to_string(),
            expires_at,
        })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn agent_files(
    id: String,
    path: String,
) -> Result<Vec<hypercli_sdk::AgentFileEntry>, String> {
    tauri::async_runtime::spawn_blocking(move || {
        client()?
            .list_deployment_files(&id, &path)
            .map_err(friendly)
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn agent_file_read(id: String, path: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = client()?
            .read_deployment_file_bytes(&id, &path, 500_000)
            .map_err(friendly)?;
        Ok(String::from_utf8_lossy(&bytes).into_owned())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn agent_file_read_bytes(id: String, path: String) -> Result<AgentFileBytes, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let bytes = client()?
            .read_deployment_file_bytes(&id, &path, 20_000_000)
            .map_err(friendly)?;
        Ok(AgentFileBytes { bytes })
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
async fn agent_file_write(id: String, path: String, bytes: Vec<u8>) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || {
        client()?
            .put_deployment_file(&id, &path, &bytes)
            .map_err(friendly)?;
        Ok(())
    })
    .await
    .map_err(|e| e.to_string())?
}

#[tauri::command]
fn acp_credentials() -> Result<AcpCredentials, String> {
    let config = discover_client_config().map_err(|e| e.to_string())?;
    Ok(AcpCredentials {
        api_base: config.api_base.to_string(),
        token: config.api_key.expose_secret().to_owned(),
    })
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

/// Watches deployment transitions and nudges the webview to refetch the
/// roster. The outer loop re-discovers credentials each reconnect, so sign-in
/// and sign-out are picked up without restarting the task.
async fn run_agent_watcher(app: AppHandle) {
    let (tx, mut rx) = tokio::sync::mpsc::unbounded_channel::<()>();
    tauri::async_runtime::spawn(async move {
        loop {
            match discover_client_config() {
                Ok(config) => match HyperCliClient::new(config) {
                    Ok(client) => {
                        let tx = tx.clone();
                        let _ = client
                            .subscribe_deployments(move |_event| {
                                let _ = tx.send(());
                            })
                            .await;
                    }
                    Err(_) => tokio::time::sleep(std::time::Duration::from_secs(2)).await,
                },
                Err(_) => tokio::time::sleep(std::time::Duration::from_secs(2)).await,
            }
        }
    });
    loop {
        if rx.recv().await.is_none() {
            return;
        }
        loop {
            match tokio::time::timeout(std::time::Duration::from_millis(500), rx.recv()).await {
                Ok(Some(())) => continue,
                Ok(None) => return,
                Err(_) => break,
            }
        }
        let _ = app.emit("agents-updated", ());
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _argv, _cwd| {
            use tauri::Manager;
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_opener::init());

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

    builder
        .setup(|app| {
            let handle = app.handle().clone();
            tauri::async_runtime::spawn(run_agent_watcher(handle));
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            auth_status,
            save_api_key,
            logout,
            list_agents,
            start_agent,
            stop_agent,
            create_agent,
            archive_agent,
            restore_agent,
            delete_agent,
            set_agent_desktop_enabled,
            upload_agent_avatar,
            delete_agent_avatar,
            acp_credentials,
            agent_logs_token,
            agent_shell_token,
            agent_desktop_url,
            is_auto_update_supported,
            agent_files,
            agent_file_read,
            agent_file_read_bytes,
            agent_file_write,
            plan_summary,
            usage_summary,
            routines_list,
            routines_create,
            routines_update,
            routines_delete,
        ])
        .run(tauri::generate_context!())
        .expect("error while running hypercli desktop-ng");
}
