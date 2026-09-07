use hypercli_sdk::{
    discover_agents_api_base, discover_client_config, remove_config_api_keys,
    save_api_key as persist_api_key, AgentSize, BuzzLaunchConfig, ClientConfig,
    CreateDeploymentRequest, Deployment, HermesLaunchConfig, HyperCliClient, HyperCliError,
    ManagedRuntime, OpenClawLaunchConfig, StartDeploymentRequest,
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
    size: Option<String>,
}

impl From<Deployment> for AgentSummary {
    fn from(d: Deployment) -> Self {
        let runtime = d
            .runtime
            .and_then(|r| serde_json::to_value(r).ok())
            .and_then(|v| v.as_str().map(str::to_owned));
        Self {
            id: d.id,
            name: d.name,
            handle: d.handle,
            avatar_url: d.avatar_url,
            runtime,
            state: d.state,
            hostname: d.hostname,
            launch_epoch: d.launch_epoch,
            size: d
                .requested_size
                .and_then(|s| serde_json::to_value(s).ok())
                .and_then(|v| v.as_str().map(str::to_owned)),
        }
    }
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
                    .get("OPENCLAW_DESKTOP_ENABLED")
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

#[derive(Clone, Serialize)]
struct AcpCredentials {
    api_base: String,
    token: String,
}

#[derive(Clone, Serialize, serde::Deserialize)]
struct AgentLogsToken {
    agent_id: Option<String>,
    jwt: String,
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

#[tauri::command]
async fn agent_files(_id: String, _path: String) -> Result<Vec<serde_json::Value>, String> {
    Err("Files are not wired in the packaged app yet.".to_owned())
}

#[derive(Clone, Serialize)]
struct AgentExecResult {
    exit_code: i32,
    stdout: String,
    stderr: String,
}

#[tauri::command]
async fn agent_exec(
    _id: String,
    _command: String,
    _timeout: Option<u64>,
) -> Result<AgentExecResult, String> {
    Err("Shell is not wired in the packaged app yet.".to_owned())
}

#[tauri::command]
fn acp_credentials() -> Result<AcpCredentials, String> {
    let config = discover_client_config().map_err(|e| e.to_string())?;
    Ok(AcpCredentials {
        api_base: config.api_base.to_string(),
        token: config.api_key.expose_secret().to_owned(),
    })
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
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
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
            acp_credentials,
            agent_logs_token,
            agent_files,
            agent_exec,
            plan_summary,
        ])
        .run(tauri::generate_context!())
        .expect("error while running hypercli desktop-ng");
}
