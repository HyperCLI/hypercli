use std::fs;
use std::path::PathBuf;

use hypercli_sdk::{
    discover_client_config, normalize_agents_api_base, remove_config_api_keys,
    save_api_key as write_api_key, ClientConfig, ConfigError, CreateApiKeyRequest, HyperCliClient,
    DEFAULT_AGENTS_API_BASE,
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
    has_active_subscription: bool,
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
            has_active_subscription: me.has_active_subscription,
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
                has_active_subscription: false,
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
    let api_base = normalize_agents_api_base(DEFAULT_AGENTS_API_BASE).map_err(|e| e.to_string())?;
    let client = HyperCliClient::new(ClientConfig {
        api_base,
        api_key: SecretString::from(session_token.trim().to_owned()),
        trace_file: None,
    })
    .map_err(|e| e.to_string())?;
    let mut request = CreateApiKeyRequest::new(name.clone());
    // Tags are scope grants in `family:baseline` grammar (deny-by-default
    // without them); the provider needs exactly `agents:*`.
    request.tags = vec!["agents:*".to_owned()];
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
}
