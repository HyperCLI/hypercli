use hypercli_sdk::{
    discover_agents_api_base, discover_client_config, issue_api_key_from_jwt,
    remove_config_api_keys, save_api_key as persist_api_key, ClientConfig, HyperCliClient,
    IssueApiKeyFromJwtOptions,
};
use secrecy::{ExposeSecret, SecretString};
use serde::Serialize;
use tauri::{Emitter, Manager};
use tauri_plugin_deep_link::DeepLinkExt;

/// Capabilities held by a desktop-minted machine key: agent management, scoped
/// file-token minting, the model and voice grants for prompt drafting/read-aloud,
/// and `user:self` for account/plan reads. Never an unrestricted key.
const DESKTOP_KEY_SCOPES: [&str; 5] = ["agents:*", "files:*", "models:*", "voice:*", "user:self"];

/// Web login page. Its allowlist accepts the `hypercli://auth` scheme
/// callback (site/apps/claw/src/app/desktop-login/page.tsx): the session token
/// travels in the URL fragment, never in a server round-trip.
/// `HYPERCLI_DESKTOP_LOGIN_PAGE` overrides the page for dev/feat testing.
const DESKTOP_LOGIN_PAGE: &str = "https://agents.hypercli.com/desktop-login";

#[derive(Clone, Serialize)]
struct AuthStatus {
    signed_in: bool,
    api_base: String,
}

#[derive(Clone, Serialize)]
struct AcpCredentials {
    api_base: String,
    token: String,
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
        let client = HyperCliClient::new(config).map_err(|e| e.to_string())?;
        client.list_deployments().map_err(|e| e.to_string())?;
        let home = dirs::home_dir().ok_or("no home directory".to_owned())?;
        persist_api_key(&home, &key).map_err(|e| e.to_string())?;
        Ok(auth_status_inner())
    })
    .await
    .map_err(|e| e.to_string())?
}

/// Open the browser sign-in. The page redirects back to `hypercli://auth`
/// with the session token in the URL fragment, which `on_open_url` (and, on
/// Windows/Linux, the single-instance argv hand-off) delivers as an
/// `auth-token` event to the webview.
#[tauri::command]
fn start_login(app: tauri::AppHandle) -> Result<(), String> {
    let page = std::env::var("HYPERCLI_DESKTOP_LOGIN_PAGE")
        .unwrap_or_else(|_| DESKTOP_LOGIN_PAGE.to_owned());
    let url = format!("{page}?redirect_uri=hypercli%3A%2F%2Fauth");
    tauri_plugin_opener::OpenerExt::opener(&app)
        .open_url(url, None::<String>)
        .map_err(|e| e.to_string())
}

/// Exchange a browser session token for a durable, scoped machine API key and
/// persist it. The session token is never stored. `issue_api_key_from_jwt`
/// resolves the backend through the same env/config discovery
/// (`discover_agents_api_base`) as `acp_credentials`, so a dev/feat API base
/// is honored here too.
#[tauri::command]
async fn mint_api_key(session_token: String) -> Result<AuthStatus, String> {
    tauri::async_runtime::spawn_blocking(move || {
        let mut options = IssueApiKeyFromJwtOptions::new(
            DESKTOP_KEY_SCOPES
                .iter()
                .map(|scope| (*scope).to_owned())
                .collect(),
        );
        options.name = "HyperCLI desktop".to_owned();
        let issued = issue_api_key_from_jwt(&session_token, options).map_err(|e| e.to_string())?;
        let api_key = issued
            .api_key
            .ok_or_else(|| "key issued but the response carried no key material".to_owned())?;
        let home = dirs::home_dir().ok_or("no home directory".to_owned())?;
        persist_api_key(&home, &api_key).map_err(|e| e.to_string())?;
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

/// Hands the webview the discovered credential so every backend HTTP/WS call
/// goes through ts-sdk directly. No REST passthrough lives in Rust.
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

/// Minimal %XX decoding — the page encodes with encodeURIComponent and the
/// token must round-trip byte-for-byte.
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

/// Emit the browser session token to the webview and refocus the app after
/// the browser detour. The webview's SignIn screen redeems it via
/// `mint_api_key`.
fn deliver_auth_token(app: &tauri::AppHandle, token: String) {
    if app.emit("auth-token", token).is_err() {
        eprintln!("hypercli-desktop: failed to deliver auth token to window");
    }
    if let Some(window) = app.get_webview_window("main") {
        let _ = window.unminimize();
        let _ = window.show();
        let _ = window.set_focus();
    }
}

#[cfg_attr(mobile, tauri::mobile_entry_point)]
pub fn run() {
    // Single-instance must be the first registered plugin: its callback
    // receives the second instance's argv, which on Windows and Linux carries
    // the hypercli:// deep link.
    let builder = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, argv, _cwd| {
            for arg in argv {
                if arg.starts_with("hypercli://") {
                    if let Some(token) = token_from_callback(&arg) {
                        deliver_auth_token(app, token);
                    }
                }
            }
            if let Some(window) = app.get_webview_window("main") {
                let _ = window.unminimize();
                let _ = window.set_focus();
            }
        }))
        .plugin(tauri_plugin_deep_link::init())
        .plugin(tauri_plugin_notification::init())
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
            auth_status,
            save_api_key,
            logout,
            acp_credentials,
            is_auto_update_supported,
            start_login,
            mint_api_key,
        ])
        .run(tauri::generate_context!())
        .expect("error while running hypercli desktop-ng");
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
    fn token_from_callback_rejects_foreign_or_tokenless_urls() {
        assert!(token_from_callback("https://auth#token=abc").is_none());
        assert!(token_from_callback("hypercli://other#token=abc").is_none());
        assert!(token_from_callback("hypercli://auth").is_none());
        assert!(token_from_callback("hypercli://auth#token=").is_none());
    }
}
