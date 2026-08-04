use std::fs;
use std::path::PathBuf;

use serde::Serialize;
use tauri::Emitter;
use tauri_plugin_deep_link::DeepLinkExt;

/// Runtime identities Buzz discovers as separate `Run on` choices. Keep in
/// sync with `buzz-backend-provider/README.md`.
const RUNTIMES: [&str; 5] = ["opencode", "codex", "claude", "goose", "kimi"];
const PROVIDER_BIN: &str = "buzz-backend-hypercli";

/// Web login page that redirects back with a session token in the fragment.
/// `hypercli://auth` must be present in the page's redirect allowlist
/// (site/apps/claw/src/app/desktop-login/page.tsx).
const DESKTOP_LOGIN_URL: &str =
    "https://agents.hypercli.com/desktop-login?redirect_uri=hypercli%3A%2F%2Fauth";

/// Backend that mints API keys from a logged-in session token.
const AGENTS_API_BASE: &str = "https://api.hypercli.com/agents";

#[derive(Serialize)]
pub struct ProviderStatus {
    installed: Vec<String>,
    missing: Vec<String>,
    has_api_key: bool,
    bin_dir: String,
    bin_dir_exists: bool,
}

fn home_dir() -> Result<PathBuf, String> {
    dirs::home_dir().ok_or_else(|| "cannot resolve home directory".to_string())
}

/// Buzz scans this directory explicitly on every platform.
fn bin_dir() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".local").join("bin"))
}

fn config_path() -> Result<PathBuf, String> {
    Ok(home_dir()?.join(".hypercli").join("config"))
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

fn config_has_key() -> bool {
    let Ok(path) = config_path() else {
        return false;
    };
    let Ok(content) = fs::read_to_string(path) else {
        return false;
    };
    content.lines().any(|line| {
        let line = line.trim();
        ["HYPER_AGENTS_API_KEY=", "HYPER_API_KEY=", "HYPERCLI_API_KEY="]
            .iter()
            .any(|prefix| line.starts_with(prefix) && line.len() > prefix.len())
    })
}

#[tauri::command]
fn provider_status() -> Result<ProviderStatus, String> {
    let dir = bin_dir()?;
    let (installed, missing) = provider_names()
        .into_iter()
        .partition(|name| dir.join(name).exists());
    Ok(ProviderStatus {
        installed,
        missing,
        has_api_key: config_has_key(),
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

/// Upsert one KEY=VALUE line in ~/.hypercli/config, preserving the rest.
fn write_config_key(key: &str, value: &str) -> Result<(), String> {
    let path = config_path()?;
    if let Some(parent) = path.parent() {
        fs::create_dir_all(parent).map_err(|e| e.to_string())?;
    }
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let mut lines: Vec<String> = existing
        .lines()
        .filter(|line| !line.trim_start().starts_with(&format!("{key}=")))
        .map(ToOwned::to_owned)
        .collect();
    lines.push(format!("{key}={value}"));
    let mut content = lines.join("\n");
    content.push('\n');
    fs::write(&path, content).map_err(|e| e.to_string())?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|e| e.to_string())?;
    }
    Ok(())
}

#[tauri::command]
fn save_api_key(api_key: String) -> Result<(), String> {
    let api_key = api_key.trim();
    if api_key.is_empty() {
        return Err("API key is empty".into());
    }
    write_config_key("HYPER_API_KEY", api_key)
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
#[tauri::command]
async fn mint_api_key(session_token: String) -> Result<String, String> {
    let name = key_annotation();
    let client = reqwest::Client::new();
    let response = client
        .post(format!("{AGENTS_API_BASE}/keys"))
        .bearer_auth(session_token.trim())
        .json(&serde_json::json!({ "name": name, "tags": ["desktop"] }))
        .send()
        .await
        .map_err(|e| e.to_string())?;
    if !response.status().is_success() {
        return Err(format!("key mint failed: HTTP {}", response.status()));
    }
    let body: serde_json::Value = response.json().await.map_err(|e| e.to_string())?;
    let api_key = body
        .get("api_key")
        .and_then(|v| v.as_str())
        .ok_or_else(|| "response missing api_key".to_string())?
        .to_owned();
    write_config_key("HYPER_API_KEY", &api_key)?;
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
            save_api_key,
            mint_api_key,
            start_login
        ])
        .run(tauri::generate_context!())
        .expect("error while running HyperCLI desktop");
}
