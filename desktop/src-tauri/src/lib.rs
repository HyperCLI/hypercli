use std::fs;
use std::path::PathBuf;

use hypercli_sdk::{
    discover_client_config, normalize_agents_api_base, remove_config_api_keys,
    save_api_key as write_api_key, ClientConfig, ConfigError, CreateApiKeyRequest,
    HyperCliClient, DEFAULT_AGENTS_API_BASE,
};
use secrecy::SecretString;
use serde::Serialize;
use tauri::Emitter;
use tauri_plugin_deep_link::DeepLinkExt;

/// Runtime identities Buzz discovers as separate `Run on` choices. Keep in
/// sync with `buzz-backend-provider/README.md`.
const RUNTIMES: [&str; 6] = ["buzz-agent", "opencode", "codex", "claude", "goose", "kimi"];
const PROVIDER_BIN: &str = "buzz-backend-hypercli";

/// Web login page that redirects back with a session token in the fragment.
/// `hypercli://auth` must be present in the page's redirect allowlist
/// (site/apps/claw/src/app/desktop-login/page.tsx).
const DESKTOP_LOGIN_URL: &str =
    "https://agents.hypercli.com/desktop-login?redirect_uri=hypercli%3A%2F%2Fauth";

#[derive(Serialize)]
pub struct ProviderStatus {
    installed: Vec<String>,
    missing: Vec<String>,
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
    detail: Option<String>,
}

fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "cannot resolve home directory".to_string())
}

/// Buzz scans this directory explicitly on every platform.
fn bin_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".local").join("bin"))
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
    let (installed, missing) = provider_names()
        .into_iter()
        .partition(|name| dir.join(name).exists());
    let (has_api_key, config_error) = credential_state();
    Ok(ProviderStatus {
        installed,
        missing,
        has_api_key,
        config_error,
        bin_dir: dir.display().to_string(),
        bin_dir_exists: dir.is_dir(),
    })
}

/// Install the provider under every runtime name Buzz looks for.
/// Symlinks on macOS/Linux (one real file, one Gatekeeper identity);
/// copies on Windows (symlinks there need admin or Developer Mode).
#[tauri::command]
fn install_providers() -> Result<ProviderStatus, String> {
    let source = sidecar_path()?;
    let dir = bin_dir()?;
    fs::create_dir_all(&dir).map_err(|e| e.to_string())?;
    for name in provider_names() {
        let target = dir.join(&name);
        if target.exists() || target.is_symlink() {
            fs::remove_file(&target).map_err(|e| e.to_string())?;
        }
        #[cfg(unix)]
        std::os::unix::fs::symlink(&source, &target).map_err(|e| e.to_string())?;
        #[cfg(windows)]
        fs::copy(&source, &target).map_err(|e| e.to_string())?;
    }
    provider_status()
}

/// Remove every provider name from the bin dir. Only touches our names.
#[tauri::command]
fn uninstall_providers() -> Result<ProviderStatus, String> {
    let dir = bin_dir()?;
    for name in provider_names() {
        let target = dir.join(&name);
        if target.exists() || target.is_symlink() {
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

#[tauri::command]
fn logout() -> Result<(), String> {
    remove_config_api_keys(&home_dir()?).map_err(|e| e.to_string())
}

/// Check the configured key against the API and report whether it carries
/// the `agents:*` capability the Buzz provider needs. Blocking SDK call —
/// `(async)` runs it off the main thread.
#[tauri::command(async)]
fn validate_key() -> Result<KeyValidation, String> {
    let config = discover_client_config().map_err(|e| e.to_string())?;
    let client = HyperCliClient::new(config).map_err(|e| e.to_string())?;
    match client.auth_me() {
        Ok(me) => Ok(KeyValidation {
            valid: true,
            email: me.email,
            key_name: me.key_name,
            has_agents_capability: me.capabilities.iter().any(|c| c == "agents:*"),
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
                detail: Some(detail),
            })
        }
    }
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
#[tauri::command(async)]
fn mint_api_key(session_token: String) -> Result<String, String> {
    let name = key_annotation();
    let api_base =
        normalize_agents_api_base(DEFAULT_AGENTS_API_BASE).map_err(|e| e.to_string())?;
    let client = HyperCliClient::new(ClientConfig {
        api_base,
        api_key: SecretString::from(session_token.trim().to_owned()),
        trace_file: None,
    })
    .map_err(|e| e.to_string())?;
    let mut request = CreateApiKeyRequest::new(name.clone());
    request.tags = vec!["desktop".to_owned()];
    let key = client.create_api_key(&request).map_err(|e| e.to_string())?;
    let api_key = key
        .api_key
        .ok_or_else(|| "key created but response contained no key material".to_string())?;
    write_api_key(&home_dir()?, &api_key).map_err(|e| e.to_string())?;
    Ok(name)
}

#[tauri::command]
fn start_login(app: tauri::AppHandle) -> Result<(), String> {
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_url(DESKTOP_LOGIN_URL, None::<String>)
        .map_err(|e| e.to_string())
}

/// Extract the session token from a `hypercli://auth#token=...` callback.
fn token_from_callback(url: &str) -> Option<String> {
    let fragment = url.split_once('#')?.1;
    fragment.split('&').find_map(|pair| {
        let (key, value) = pair.split_once('=')?;
        (key == "token").then(|| value.to_owned())
    })
}

pub fn run() {
    tauri::Builder::default()
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_deep_link::init())
        .setup(|app| {
            let handle = app.handle().clone();
            app.deep_link().on_open_url(move |event| {
                for url in event.urls() {
                    if let Some(token) = token_from_callback(url.as_str()) {
                        let _ = handle.emit("auth-token", token);
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
            mint_api_key,
            start_login
        ])
        .run(tauri::generate_context!())
        .expect("error while running HyperCLI desktop");
}
