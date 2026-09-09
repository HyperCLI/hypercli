use hypercli_sdk::{
    discover_agents_api_base, discover_client_config, remove_config_api_keys,
    save_api_key as persist_api_key, ClientConfig, HyperCliClient,
};
use secrecy::{ExposeSecret, SecretString};
use serde::Serialize;

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
        .invoke_handler(tauri::generate_handler![
            auth_status,
            save_api_key,
            logout,
            acp_credentials,
            is_auto_update_supported,
        ])
        .run(tauri::generate_context!())
        .expect("error while running hypercli desktop-ng");
}
