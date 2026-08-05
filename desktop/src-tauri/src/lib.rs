use std::fs;
use std::path::PathBuf;
use std::time::{Duration, Instant};

use hypercli_sdk::{
    discover_agents_api_base, discover_client_config, remove_config_api_keys,
    save_api_key as write_api_key, ClientConfig, ConfigError, CreateApiKeyRequest, Deployment,
    HyperCliClient, StartDeploymentRequest,
};
use secrecy::SecretString;
use serde::Serialize;
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

/// Runtime identities Buzz discovers as separate `Run on` choices. Keep in
/// sync with `buzz-backend-provider/README.md`.
const RUNTIMES: [&str; 6] = ["buzz-agent", "opencode", "codex", "claude", "goose", "kimi"];
const PROVIDER_BIN: &str = "buzz-backend-hypercli";

/// Web login page. Its allowlist accepts the `hypercli://auth` scheme
/// callback (site/apps/claw/src/app/desktop-login/page.tsx) — the exact
/// Backseat Driver pattern: token in the URL fragment, no server round-trip.
const DESKTOP_LOGIN_PAGE: &str = "https://agents.hypercli.com/desktop-login";

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
    runtime: Option<String>,
    state: String,
    tags: Vec<String>,
    hostname: Option<String>,
    requested_size: Option<String>,
    last_error: Option<String>,
    is_buzz: bool,
    can_start: bool,
    can_stop: bool,
    can_restart: bool,
    can_delete: bool,
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
        "pending" | "restoring" | "syncing" | "starting" => AgentActions {
            start: false,
            stop: true,
            restart: false,
            delete: false,
        },
        "restore_failed" | "sync_failed" | "failed" | "crashed" | "error" => AgentActions {
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

impl From<Deployment> for DesktopAgent {
    fn from(deployment: Deployment) -> Self {
        let actions = agent_actions(&deployment.state);
        let is_buzz = deployment.is_buzz_managed();
        Self {
            id: deployment.id,
            name: deployment.name,
            handle: deployment.handle,
            runtime: deployment
                .runtime
                .and_then(|runtime| serde_json::to_value(runtime).ok())
                .and_then(|value| value.as_str().map(str::to_owned)),
            state: normalized_state(&deployment.state),
            tags: deployment.tags,
            hostname: deployment.hostname,
            requested_size: deployment.requested_size,
            last_error: deployment.last_error,
            is_buzz,
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
fn save_api_key(api_key: String) -> Result<(), String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("API key is empty".into());
    }
    write_api_key(&home_dir()?, api_key).map_err(|e| e.to_string())
}

/// Returns true when a key is still discoverable afterwards — i.e. the
/// environment exports one that logout cannot (and should not) remove.
#[tauri::command]
fn logout() -> Result<bool, String> {
    remove_config_api_keys(&home_dir()?).map_err(|e| e.to_string())?;
    let (still_has_key, _) = credential_state();
    Ok(still_has_key)
}

/// Check the configured key against the API and report whether it carries
/// the `agents:*` capability the Buzz provider needs.
fn validate_key_blocking() -> Result<KeyValidation, String> {
    let config = discover_client_config().map_err(|e| e.to_string())?;
    let client = HyperCliClient::new(config).map_err(|e| e.to_string())?;
    match client.auth_me() {
        Ok(me) => Ok(KeyValidation {
            valid: true,
            email: me.email,
            key_name: me.key_name,
            has_agents_capability: me.capabilities.iter().any(|c| c == "agents:*"),
            // The HyperClaw plan lives in the entitlements summary, NOT in
            // auth_me.has_active_subscription (that flag is the Orchestra
            // product subscription). Scoped keys without the `user` family
            // get 403 here — report unknown, never a false "no plan".
            has_active_plan: client
                .entitlements_summary()
                .ok()
                .map(|summary| summary.has_active_plan()),
            detail: None,
        }),
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
const RESTART_POLL_INTERVAL: Duration = Duration::from_secs(1);

fn restart_agent_blocking(agent_id: String) -> Result<DesktopAgent, String> {
    let agent_id = checked_agent_id(&agent_id)?;
    let client = managed_client()?;
    let mut current = client
        .get_deployment(&agent_id)
        .map_err(|error| error.to_string())?;
    let state = normalized_state(&current.state);
    if state == "running" {
        current = client
            .stop_deployment(&agent_id)
            .map_err(|error| error.to_string())?;
        let deadline = Instant::now() + RESTART_STOP_TIMEOUT;
        while normalized_state(&current.state) != "stopped" {
            if Instant::now() >= deadline {
                return Err(
                    "Agent is still stopping. Try restart again after it reaches stopped."
                        .to_owned(),
                );
            }
            std::thread::sleep(RESTART_POLL_INTERVAL);
            current = client
                .get_deployment(&agent_id)
                .map_err(|error| error.to_string())?;
        }
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

#[tauri::command]
async fn delete_agent(agent_id: String) -> Result<(), String> {
    tauri::async_runtime::spawn_blocking(move || delete_agent_blocking(agent_id))
        .await
        .map_err(|error| error.to_string())?
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
    // without them). The provider needs `agents:*`; `user:self` lets the
    // app read the entitlements summary for the plan hint.
    request.tags = vec!["agents:*".to_owned(), "user:self".to_owned()];
    let key = client.create_api_key(&request).map_err(|e| e.to_string())?;
    let api_key = key
        .api_key
        .ok_or_else(|| "key created but response contained no key material".to_string())?;
    write_api_key(&home_dir()?, &api_key).map_err(|e| e.to_string())?;
    Ok(name)
}

#[tauri::command]
async fn mint_api_key(session_token: String) -> Result<String, String> {
    tauri::async_runtime::spawn_blocking(move || mint_api_key_blocking(session_token))
        .await
        .map_err(|e| e.to_string())?
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

    builder
        .setup(|app| {
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
        .invoke_handler(tauri::generate_handler![
            provider_status,
            install_providers,
            uninstall_providers,
            save_api_key,
            logout,
            validate_key,
            list_agents,
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
        for state in ["FAILED", "RESTORE_FAILED", "SYNC_FAILED"] {
            assert_eq!(
                agent_actions(state),
                AgentActions {
                    start: false,
                    stop: false,
                    restart: true,
                    delete: false,
                }
            );
        }
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
            runtime: Some(hypercli_sdk::ManagedRuntime::ClaudeCode),
            state: "RUNNING".to_owned(),
            pod_id: Some("pod-secret-not-rendered".to_owned()),
            hostname: Some("maverick.hypercli.app".to_owned()),
            tags: vec!["buzz_agent=public-key".to_owned()],
            requested_size: Some("large".to_owned()),
            last_error: None,
        });
        let serialized = serde_json::to_value(view).unwrap();

        assert_eq!(serialized["is_buzz"], true);
        assert_eq!(serialized["can_restart"], true);
        assert_eq!(serialized["runtime"], "claude-code");
        assert!(serialized.get("pod_id").is_none());
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
}
