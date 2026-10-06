use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use secrecy::SecretString;
use thiserror::Error;
use url::Url;

pub const DEFAULT_API_BASE: &str = "https://api.hypercli.com";
pub const DEFAULT_AGENTS_API_BASE: &str = "https://api.hypercli.com/agents";
const MAX_CREDENTIAL_FILE_BYTES: u64 = 64 * 1024;

/// Key names accepted for the API credential, in precedence order.
pub const API_KEY_CONFIG_KEYS: [&str; 2] = ["HYPER_API_KEY", "HYPER_AGENTS_API_KEY"];
const REMOVED_API_KEY_CONFIG_KEYS: [&str; 1] = ["HYPERCLI_API_KEY"];

pub struct ClientConfig {
    pub api_base: Url,
    pub api_key: SecretString,
    pub trace_file: Option<PathBuf>,
    /// Per-request HTTP timeout. `None` uses the client default
    /// ([`crate::DEFAULT_REQUEST_TIMEOUT`]). This is the single source of
    /// truth for the default; [`crate::HyperCliClient::new_with_timeout`]
    /// remains an explicit per-client override.
    pub timeout: Option<Duration>,
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error(
        "no HyperCLI credential found; set HYPER_API_KEY, run `hyper configure`, \
         set HYPER_AGENTS_API_KEY, or run `hyper agent login`"
    )]
    MissingCredential,
    #[error("invalid HyperCLI agents API URL")]
    InvalidApiBase,
    #[error("could not read HyperCLI credential file")]
    CredentialFile,
    #[error("HyperCLI credential file is too large")]
    CredentialFileTooLarge,
    #[error("HyperCLI agent credential file is not valid JSON")]
    InvalidAgentCredentialFile,
    #[error("could not write HyperCLI config file")]
    ConfigWrite,
}

/// Upsert KEY=VALUE lines in `<home>/.hypercli/config` (created 0600 on Unix),
/// preserving unrelated lines.
pub fn write_config_values(
    home: &Path,
    values: &BTreeMap<String, String>,
) -> Result<(), ConfigError> {
    write_config_values_in_data_dir(&home.join(".hypercli"), values)
}

/// Upsert KEY=VALUE lines in `<data_dir>/config` (created 0600 on Unix),
/// preserving unrelated lines.
pub fn write_config_values_in_data_dir(
    data_dir: &Path,
    values: &BTreeMap<String, String>,
) -> Result<(), ConfigError> {
    fs::create_dir_all(data_dir).map_err(|_| ConfigError::ConfigWrite)?;
    let path = data_dir.join("config");
    let existing = fs::read_to_string(&path).unwrap_or_default();
    let mut lines: Vec<String> = existing
        .lines()
        .filter(|line| match line.trim().split_once('=') {
            Some((key, _)) => !values.contains_key(key.trim()),
            None => true,
        })
        .map(ToOwned::to_owned)
        .collect();
    for (key, value) in values {
        lines.push(format!("{key}={value}"));
    }
    let mut content = lines.join("\n");
    content.push('\n');
    fs::write(&path, content).map_err(|_| ConfigError::ConfigWrite)?;
    #[cfg(unix)]
    {
        use std::os::unix::fs::PermissionsExt;
        fs::set_permissions(&path, fs::Permissions::from_mode(0o600))
            .map_err(|_| ConfigError::ConfigWrite)?;
    }
    Ok(())
}

/// Persist an API key as `HYPER_API_KEY` in `<home>/.hypercli/config`.
pub fn save_api_key(home: &Path, api_key: &str) -> Result<(), ConfigError> {
    save_api_key_in_data_dir(&home.join(".hypercli"), api_key)
}

/// Persist an API key as `HYPER_API_KEY` in `<data_dir>/config`.
pub fn save_api_key_in_data_dir(data_dir: &Path, api_key: &str) -> Result<(), ConfigError> {
    let mut values = BTreeMap::new();
    values.insert("HYPER_API_KEY".to_owned(), api_key.trim().to_owned());
    write_config_values_in_data_dir(data_dir, &values)
}

/// Remove every API-key entry from `<home>/.hypercli/config`, preserving
/// other lines, and delete the legacy `agent-key.json` credential so a
/// logout is complete.
pub fn remove_config_api_keys(home: &Path) -> Result<(), ConfigError> {
    remove_config_api_keys_in_data_dir(&home.join(".hypercli"))
}

/// Remove the `KEY=...` lines for `keys` from `<data_dir>/config`, preserving
/// every other line. A missing file is not an error.
fn remove_config_lines_in_data_dir(data_dir: &Path, keys: &[&str]) -> Result<(), ConfigError> {
    let path = data_dir.join("config");
    if let Ok(existing) = fs::read_to_string(&path) {
        let remaining: Vec<&str> = existing
            .lines()
            .filter(|line| match line.trim().split_once('=') {
                Some((key, _)) => !keys.contains(&key.trim()),
                None => true,
            })
            .collect();
        let mut content = remaining.join("\n");
        if !content.is_empty() {
            content.push('\n');
        }
        fs::write(&path, content).map_err(|_| ConfigError::ConfigWrite)?;
    }
    Ok(())
}

/// Remove every API-key entry from `<data_dir>/config`, preserving
/// other lines, and delete the legacy `agent-key.json` credential so a
/// logout is complete.
pub fn remove_config_api_keys_in_data_dir(data_dir: &Path) -> Result<(), ConfigError> {
    let keys: Vec<&str> = API_KEY_CONFIG_KEYS
        .iter()
        .chain(REMOVED_API_KEY_CONFIG_KEYS.iter())
        .copied()
        .collect();
    remove_config_lines_in_data_dir(data_dir, &keys)?;
    let _ = fs::remove_file(data_dir.join("agent-key.json"));
    Ok(())
}

/// Persist a backend-base override as `HYPER_API_BASE` in `<data_dir>/config`
/// — the same key [`discover_api_base`] reads, so a desktop-settings change
/// is visible to the CLI and every other client sharing the file. An empty
/// value removes the line instead, returning discovery to the env-then-default
/// rule.
pub fn save_api_base_in_data_dir(data_dir: &Path, api_base: &str) -> Result<(), ConfigError> {
    let api_base = api_base.trim();
    if api_base.is_empty() {
        return remove_config_lines_in_data_dir(data_dir, &["HYPER_API_BASE"]);
    }
    let mut values = BTreeMap::new();
    values.insert("HYPER_API_BASE".to_owned(), api_base.to_owned());
    write_config_values_in_data_dir(data_dir, &values)
}

pub fn discover_client_config() -> Result<ClientConfig, ConfigError> {
    let env: BTreeMap<String, String> = std::env::vars().collect();
    discover_client_config_from(&env, dirs::home_dir().as_deref())
}

/// Deterministic credential discovery seam used by the provider and tests.
///
/// Precedence: HYPER_API_KEY env, config from HYPER_HOME or
/// `<home>/.hypercli`, HYPER_AGENTS_API_KEY env, then the legacy
/// `agent-key.json`.
pub fn discover_client_config_from(
    env: &BTreeMap<String, String>,
    home: Option<&Path>,
) -> Result<ClientConfig, ConfigError> {
    let config_dir = config_dir_from_home(env, home);
    discover_client_config_from_config_dir(env, config_dir.as_deref())
}

/// Deterministic credential discovery using a HyperCLI data directory directly.
pub fn discover_client_config_from_config_dir(
    env: &BTreeMap<String, String>,
    config_dir: Option<&Path>,
) -> Result<ClientConfig, ConfigError> {
    let config_dir = config_dir_from_data_dir(env, config_dir);
    let file_config = match config_dir.as_deref() {
        Some(dir) => load_kv_file(&dir.join("config"))?,
        None => BTreeMap::new(),
    };

    let configured_key = first_nonempty([
        env.get("HYPER_API_KEY"),
        file_config.get("HYPER_API_KEY"),
        env.get("HYPER_AGENTS_API_KEY"),
    ])
    .map(ToOwned::to_owned);
    let api_key = match configured_key {
        Some(key) => key,
        None => match config_dir.as_deref() {
            Some(dir) => load_legacy_agent_key(&dir.join("agent-key.json"))?
                .ok_or(ConfigError::MissingCredential)?,
            None => return Err(ConfigError::MissingCredential),
        },
    };

    let trace_file = first_nonempty([
        env.get("HYPER_HTTP_TRACE_FILE"),
        file_config.get("HYPER_HTTP_TRACE_FILE"),
    ])
    .map(PathBuf::from);

    Ok(ClientConfig {
        api_base: discover_api_base(env, &file_config)?,
        api_key: SecretString::from(api_key),
        trace_file,
        timeout: None,
    })
}

/// Resolve the agents API base URL from env and HyperCLI data-dir config
/// without requiring a credential — for flows that authenticate with a
/// short-lived token (e.g. the desktop app's key mint) but must still honor
/// the caller's configured backend.
pub fn discover_agents_api_base() -> Result<Url, ConfigError> {
    let env: BTreeMap<String, String> = std::env::vars().collect();
    discover_agents_api_base_from(&env, dirs::home_dir().as_deref())
}

/// Path-parameterized variant of [`discover_agents_api_base`] — the same
/// env-then-file precedence. HYPER_HOME in `env` overrides `home`; callers
/// that must keep sandboxed storage should remove HYPER_HOME from `env` first.
pub fn discover_agents_api_base_from(
    env: &BTreeMap<String, String>,
    home: Option<&Path>,
) -> Result<Url, ConfigError> {
    let config_dir = config_dir_from_home(env, home);
    discover_agents_api_base_from_config_dir(env, config_dir.as_deref())
}

/// Resolve the agents API base URL using a HyperCLI data directory directly.
pub fn discover_agents_api_base_from_config_dir(
    env: &BTreeMap<String, String>,
    config_dir: Option<&Path>,
) -> Result<Url, ConfigError> {
    let config_dir = config_dir_from_data_dir(env, config_dir);
    let file_config = match config_dir.as_deref() {
        Some(dir) => load_kv_file(&dir.join("config"))?,
        None => BTreeMap::new(),
    };
    discover_api_base(env, &file_config)
}

fn config_dir_from_home(env: &BTreeMap<String, String>, home: Option<&Path>) -> Option<PathBuf> {
    first_nonempty([env.get("HYPER_HOME")])
        .map(PathBuf::from)
        .or_else(|| home.map(|home| home.join(".hypercli")))
}

fn config_dir_from_data_dir(
    env: &BTreeMap<String, String>,
    data_dir: Option<&Path>,
) -> Option<PathBuf> {
    first_nonempty([env.get("HYPER_HOME")])
        .map(PathBuf::from)
        .or_else(|| data_dir.map(Path::to_path_buf))
}

fn discover_api_base(
    env: &BTreeMap<String, String>,
    file_config: &BTreeMap<String, String>,
) -> Result<Url, ConfigError> {
    // Agents configuration wins over derivation from the product base.
    if let Some(base) = first_nonempty([
        env.get("HYPER_AGENTS_API_BASE"),
        file_config.get("HYPER_AGENTS_API_BASE"),
    ]) {
        return normalize_explicit_agents_api_base(base);
    }
    let configured_base =
        first_nonempty([env.get("HYPER_API_BASE"), file_config.get("HYPER_API_BASE")])
            .unwrap_or(DEFAULT_AGENTS_API_BASE);
    normalize_agents_api_base(configured_base)
}

/// Env-then-config-file lookup for feature-specific base-URL overrides,
/// mirroring the py/ts `get_config_value` precedence.
pub fn discover_config_value(key: &str) -> Option<String> {
    if let Ok(value) = std::env::var(key) {
        let value = value.trim();
        if !value.is_empty() {
            return Some(value.to_owned());
        }
    }
    let env: BTreeMap<String, String> = std::env::vars().collect();
    let config_dir = config_dir_from_home(&env, dirs::home_dir().as_deref())?;
    load_kv_file(&config_dir.join("config"))
        .ok()?
        .get(key)
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
}

pub const DEFAULT_AGENTS_WS_URL: &str = "wss://api.agents.hypercli.com/ws";
const DEV_AGENTS_WS_URL: &str = "wss://api.agents.dev.hypercli.com/ws";
pub const DEFAULT_AGENTS_ADMIN_API_BASE: &str = "https://api.agents.hypercli.com";
const DEV_AGENTS_ADMIN_API_BASE: &str = "https://api.agents.dev.hypercli.com";

/// Lowercased host with the scheme-default port dropped and non-default
/// ports kept; IPv6 literals are bracket-wrapped. Matches the py-sdk
/// `_normalized_netloc` (config.py), the ts-sdk `URL.host`/`.origin`
/// serialization, and the rust `url::Url` semantics (`port()` already
/// suppresses the default port for http/https/ws/wss).
fn normalized_netloc(url: &Url) -> String {
    let host = url.host_str().unwrap_or_default().to_ascii_lowercase();
    let host = if host.contains(':') && !host.starts_with('[') {
        format!("[{host}]")
    } else {
        host
    };
    match url.port() {
        Some(port) => format!("{host}:{port}"),
        None => host,
    }
}

/// Normalize an agents WebSocket URL: http(s) schemes map to ws(s), and a
/// missing `/ws` path suffix is appended. Mirrors the Python SDK's
/// `_normalize_agents_ws_url` (agents.py) and ts-sdk `normalizeAgentsWsUrl`.
pub fn normalize_agents_ws_url(raw: &str) -> Result<Url, ConfigError> {
    let input = raw.trim();
    if input.is_empty() {
        return Err(ConfigError::InvalidApiBase);
    }
    let mut url = Url::parse(input).map_err(|_| ConfigError::InvalidApiBase)?;
    match url.scheme() {
        "https" => url
            .set_scheme("wss")
            .map_err(|_| ConfigError::InvalidApiBase)?,
        "http" => url
            .set_scheme("ws")
            .map_err(|_| ConfigError::InvalidApiBase)?,
        "wss" | "ws" => {}
        _ => return Err(ConfigError::InvalidApiBase),
    }
    let path = url.path().trim_end_matches('/');
    let path = if path.ends_with("/ws") {
        path.to_owned()
    } else {
        format!("{path}/ws")
    };
    url.set_path(&path);
    url.set_query(None);
    url.set_fragment(None);
    Ok(url)
}

/// Default agents WebSocket URL for an agents API base: alias hosts map to
/// the fixed agents WS hosts; anything else is scheme-swapped and `/ws`
/// suffixed. Mirrors py `_default_agents_ws_url` / ts `defaultAgentsWsUrl`.
fn default_agents_ws_url(api_base: &Url) -> Result<Url, ConfigError> {
    let netloc = normalized_netloc(api_base);
    if api_base.path() == "/agents"
        && matches!(netloc.as_str(), "api.hypercli.com" | "api.hyperclaw.app")
    {
        return Url::parse(DEFAULT_AGENTS_WS_URL).map_err(|_| ConfigError::InvalidApiBase);
    }
    if api_base.path() == "/agents"
        && matches!(
            netloc.as_str(),
            "api.dev.hypercli.com" | "api.dev.hyperclaw.app" | "dev-api.hyperclaw.app"
        )
    {
        return Url::parse(DEV_AGENTS_WS_URL).map_err(|_| ConfigError::InvalidApiBase);
    }
    let mut tunnel = api_base.clone();
    let path = api_base.path().trim_end_matches('/');
    tunnel.set_path(path.strip_suffix("/agents").unwrap_or(path));
    normalize_agents_ws_url(tunnel.as_str())
}

/// Default hyper-acp bridge WebSocket URL for an agents API base: alias hosts
/// map to the fixed prod/dev bridge hosts; anything else keeps its origin with
/// a trailing `/agents` path suffix stripped. Mirrors ts-sdk
/// `defaultHyperAcpWsUrl` and the Buzz provider's
/// `hyper_acp_ws_url_from_api_base` — one shared host table.
pub fn default_hyper_acp_ws_url(api_base: &str) -> Result<String, ConfigError> {
    let api_base = normalize_explicit_agents_api_base(api_base)?;
    let netloc = normalized_netloc(&api_base);
    if api_base.path() == "/agents"
        && matches!(netloc.as_str(), "api.hypercli.com" | "api.hyperclaw.app")
    {
        return Ok(crate::types::DEFAULT_HYPER_ACP_WS_URL.to_owned());
    }
    if api_base.path() == "/agents"
        && matches!(
            netloc.as_str(),
            "api.dev.hypercli.com" | "api.dev.hyperclaw.app" | "dev-api.hyperclaw.app"
        )
    {
        return Ok(crate::types::DEV_HYPER_ACP_WS_URL.to_owned());
    }
    let mut custom = api_base.clone();
    let path = api_base.path().trim_end_matches('/');
    let path = path.strip_suffix("/agents").unwrap_or(path);
    custom.set_path(path);
    Ok(normalize_agents_ws_url(custom.as_str())?.to_string())
}

/// Resolve the agents WebSocket URL from env and HyperCLI data-dir config
/// (derive-only; there is no `AGENTS_WS_URL` override), mirroring
/// [`discover_agents_api_base`].
pub fn discover_agents_ws_url() -> Result<Url, ConfigError> {
    let env: BTreeMap<String, String> = std::env::vars().collect();
    discover_agents_ws_url_from(&env, dirs::home_dir().as_deref())
}

/// Path-parameterized variant of [`discover_agents_ws_url`].
pub fn discover_agents_ws_url_from(
    env: &BTreeMap<String, String>,
    home: Option<&Path>,
) -> Result<Url, ConfigError> {
    let config_dir = config_dir_from_home(env, home);
    discover_agents_ws_url_from_config_dir(env, config_dir.as_deref())
}

/// Resolve the agents WebSocket URL using a HyperCLI data directory directly.
pub fn discover_agents_ws_url_from_config_dir(
    env: &BTreeMap<String, String>,
    config_dir: Option<&Path>,
) -> Result<Url, ConfigError> {
    let api_base = discover_agents_api_base_from_config_dir(env, config_dir)?;
    default_agents_ws_url(&api_base)
}

fn first_nonempty<'a>(values: impl IntoIterator<Item = Option<&'a String>>) -> Option<&'a str> {
    values
        .into_iter()
        .flatten()
        .map(String::as_str)
        .find(|value| !value.trim().is_empty())
        .map(str::trim)
}

fn load_kv_file(path: &Path) -> Result<BTreeMap<String, String>, ConfigError> {
    if !path.exists() {
        return Ok(BTreeMap::new());
    }
    let metadata = fs::metadata(path).map_err(|_| ConfigError::CredentialFile)?;
    if metadata.len() > MAX_CREDENTIAL_FILE_BYTES {
        return Err(ConfigError::CredentialFileTooLarge);
    }
    let body = fs::read_to_string(path).map_err(|_| ConfigError::CredentialFile)?;
    Ok(body
        .lines()
        .map(str::trim)
        .filter(|line| !line.is_empty() && !line.starts_with('#'))
        .map(|line| line.strip_prefix("export ").map_or(line, str::trim))
        .filter_map(|line| line.split_once('='))
        .map(|(key, value)| (key.trim().to_owned(), unquote(value.trim()).to_owned()))
        .collect())
}

/// Strip one pair of matching surrounding quotes, mirroring the ts-cli
/// config-file parser (`export`-style values round-trip unchanged).
fn unquote(value: &str) -> &str {
    let quoted =
        |quote: &str| value.starts_with(quote) && value.ends_with(quote) && value.len() > 1;
    if quoted("\"") || quoted("'") {
        &value[1..value.len() - 1]
    } else {
        value
    }
}

fn load_legacy_agent_key(path: &PathBuf) -> Result<Option<String>, ConfigError> {
    if !path.exists() {
        return Ok(None);
    }
    let metadata = fs::metadata(path).map_err(|_| ConfigError::CredentialFile)?;
    if metadata.len() > MAX_CREDENTIAL_FILE_BYTES {
        return Err(ConfigError::CredentialFileTooLarge);
    }
    let body = fs::read_to_string(path).map_err(|_| ConfigError::CredentialFile)?;
    let value: serde_json::Value =
        serde_json::from_str(&body).map_err(|_| ConfigError::InvalidAgentCredentialFile)?;
    Ok(value
        .get("key")
        .and_then(serde_json::Value::as_str)
        .map(str::trim)
        .filter(|key| !key.is_empty())
        .map(ToOwned::to_owned))
}

/// Normalize a configured agents API base URL.
///
/// Mirrors the Python SDK's `_normalize_agents_api_base` (sdk/hypercli/
/// agents.py), including its ordering: empty input yields the default base;
/// a path ending in `/agents` is kept as-is even on alias hosts; a path
/// ending in `/api` is rewritten (with special cases for the agents alias
/// hosts); bare alias hosts map to the prod/dev defaults; anything else gets
/// `/agents` appended.
///
/// Deliberate differences from Python, because we return a typed `Url`:
/// - the scheme must end up http/https and a host must be present;
/// - query strings and fragments are always stripped (Python's fallback
///   branch technically keeps the query — we do not replicate that quirk);
/// - scheme-less fallback input carries the implied `https://` prefix in the
///   returned URL (Python echoes it back scheme-less).
pub fn normalize_agents_api_base(raw: &str) -> Result<Url, ConfigError> {
    normalize_agents_base(raw, false)
}

/// Normalize an explicit control-plane selection without changing its origin.
pub fn normalize_explicit_agents_api_base(raw: &str) -> Result<Url, ConfigError> {
    normalize_agents_base(raw, true)
}

fn normalize_agents_base(raw: &str, preserve_origin: bool) -> Result<Url, ConfigError> {
    const DEV_AGENTS_API_BASE: &str = "https://api.dev.hypercli.com/agents";
    let default_base =
        || Url::parse(DEFAULT_AGENTS_API_BASE).map_err(|_| ConfigError::InvalidApiBase);
    let dev_base = || Url::parse(DEV_AGENTS_API_BASE).map_err(|_| ConfigError::InvalidApiBase);

    let input = raw.trim();
    if input.is_empty() {
        return default_base();
    }
    let with_scheme = if input.contains("://") {
        input.to_owned()
    } else {
        format!("https://{input}")
    };
    let mut parsed = Url::parse(&with_scheme).map_err(|_| ConfigError::InvalidApiBase)?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(ConfigError::InvalidApiBase);
    }

    // Python compares the lowercased netloc, i.e. the host plus any explicit
    // non-default port, so a custom port never matches an alias host.
    let netloc = normalized_netloc(&parsed);

    let path = parsed.path().trim_end_matches('/').to_owned();
    if preserve_origin {
        let path = if path.ends_with("/agents") {
            path
        } else {
            format!("{}/agents", path.strip_suffix("/api").unwrap_or(&path))
        };
        parsed.set_path(&path);
        parsed.set_query(None);
        parsed.set_fragment(None);
        return Ok(parsed);
    }
    let normalized_path = if path.ends_with("/agents") {
        path
    } else if let Some(stem) = path.strip_suffix("/api") {
        match netloc.as_str() {
            "api.agents.hypercli.com" => return default_base(),
            "api.agents.dev.hypercli.com" => return dev_base(),
            _ => format!("{stem}/agents"),
        }
    } else if matches!(
        netloc.as_str(),
        "api.agents.hypercli.com" | "api.hypercli.com" | "api.hyperclaw.app"
    ) {
        return default_base();
    } else if matches!(
        netloc.as_str(),
        "api.agents.dev.hypercli.com"
            | "api.dev.hypercli.com"
            | "api.dev.hyperclaw.app"
            | "dev-api.hyperclaw.app"
    ) {
        return dev_base();
    } else {
        format!("{path}/agents")
    };
    parsed.set_path(&normalized_path);
    parsed.set_query(None);
    parsed.set_fragment(None);
    Ok(parsed)
}

/// Resolve the agents WebSocket URL from an explicit product API base:
/// normalize the base, then apply the alias-host map / scheme swap /
/// `/ws` suffix. Mirrors py `get_agents_ws_url_from_product_base` and ts
/// `defaultAgentsWsUrl`.
pub fn agents_ws_url_from_product_base(product_base: &str) -> Result<Url, ConfigError> {
    let api_base = normalize_agents_api_base(product_base)?;
    default_agents_ws_url(&api_base)
}

/// Derive the agents admin API base (service-key surface) from a product
/// API base. Mirrors py `get_agents_admin_api_base_url_from_product_base`
/// and ts `agentsAdminApiBaseFromProductBase`: the public prod/dev alias
/// hosts map to the private admin hosts (compared against the normalized
/// netloc, so default ports and host case never matter); anything else
/// keeps its origin with one trailing `/agents/admin`, `/agents`, `/admin`,
/// or `/api` path suffix stripped.
///
/// Returns a plain `String` (not a typed `Url`) because the byte-match
/// contract with py/ts requires origin-only outputs without the trailing
/// slash `Url` serialization always emits.
pub fn agents_admin_base_url_from_product_base(product_base: &str) -> Result<String, ConfigError> {
    let input = product_base.trim();
    if input.is_empty() {
        return Ok(DEFAULT_AGENTS_ADMIN_API_BASE.to_owned());
    }
    let with_scheme = if input.contains("://") {
        input.to_owned()
    } else {
        format!("https://{input}")
    };
    let parsed = Url::parse(&with_scheme).map_err(|_| ConfigError::InvalidApiBase)?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(ConfigError::InvalidApiBase);
    }
    let netloc = normalized_netloc(&parsed);
    if matches!(
        netloc.as_str(),
        "api.agents.hypercli.com" | "api.hypercli.com" | "api.hyperclaw.app"
    ) {
        return Ok(DEFAULT_AGENTS_ADMIN_API_BASE.to_owned());
    }
    if matches!(
        netloc.as_str(),
        "api.agents.dev.hypercli.com"
            | "api.dev.hypercli.com"
            | "api.dev.hyperclaw.app"
            | "dev-api.hyperclaw.app"
    ) {
        return Ok(DEV_AGENTS_ADMIN_API_BASE.to_owned());
    }
    let path = parsed.path().trim_end_matches('/');
    let kept = ["/agents/admin", "/agents", "/admin", "/api"]
        .iter()
        .find_map(|suffix| path.strip_suffix(suffix))
        .unwrap_or(path);
    Ok(format!("{}://{}{}", parsed.scheme(), netloc, kept)
        .trim_end_matches('/')
        .to_owned())
}

#[cfg(test)]
mod tests {
    use super::*;
    use secrecy::ExposeSecret;

    #[test]
    fn config_file_strips_quotes_export_prefix_and_ignores_comments_and_blanks() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join(".hypercli");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("config"),
            "# comment line\n\n   \nexport HYPER_API_KEY=\"exported-key\"\nUNUSED='quoted'\n",
        )
        .unwrap();

        let config = discover_client_config_from(&BTreeMap::new(), Some(temp.path())).unwrap();
        assert_eq!(config.api_key.expose_secret(), "exported-key");
    }

    #[test]
    fn config_file_keeps_single_quoted_values_verbatim() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join(".hypercli");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("config"), "HYPER_API_KEY='single-quoted'\n").unwrap();

        let config = discover_client_config_from(&BTreeMap::new(), Some(temp.path())).unwrap();
        assert_eq!(config.api_key.expose_secret(), "single-quoted");
    }

    #[test]
    fn config_file_only_strips_matching_quote_pairs() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join(".hypercli");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("config"), "HYPER_API_KEY=\"mismatched'\n").unwrap();

        let config = discover_client_config_from(&BTreeMap::new(), Some(temp.path())).unwrap();
        assert_eq!(config.api_key.expose_secret(), "\"mismatched'");
    }

    #[test]
    fn config_file_preserves_equals_inside_value() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join(".hypercli");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("config"), "HYPER_API_KEY=key=with=equals\n").unwrap();

        let config = discover_client_config_from(&BTreeMap::new(), Some(temp.path())).unwrap();
        assert_eq!(config.api_key.expose_secret(), "key=with=equals");
    }

    #[test]
    fn product_env_precedes_files_and_legacy_key() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join(".hypercli");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("config"),
            "HYPER_API_KEY=file-key\nAGENTS_API_BASE_URL=http://file.test\n",
        )
        .unwrap();
        fs::write(dir.join("agent-key.json"), r#"{"key":"legacy-key"}"#).unwrap();
        let env = BTreeMap::from([
            ("HYPER_API_KEY".to_owned(), "env-key".to_owned()),
            (
                "AGENTS_API_BASE_URL".to_owned(),
                "http://env.test/base".to_owned(),
            ),
        ]);

        let config = discover_client_config_from(&env, Some(temp.path())).unwrap();
        assert_eq!(config.api_key.expose_secret(), "env-key");
        // Strict derive-only: legacy agents overrides are ignored entirely.
        assert_eq!(config.api_base.as_str(), DEFAULT_AGENTS_API_BASE);
        assert_eq!(config.trace_file, None);
    }

    #[test]
    fn hyper_acp_ws_url_derives_tier_from_configured_base() {
        // Host-table parity with ts-sdk `defaultHyperAcpWsUrl` and the
        // provider's `hyper_acp_ws_url_from_api_base`.
        for base in [
            "https://api.hypercli.com/agents",
            "https://api.agents.hypercli.com",
            "https://api.hyperclaw.app",
        ] {
            assert_eq!(
                default_hyper_acp_ws_url(base).unwrap(),
                crate::types::DEFAULT_HYPER_ACP_WS_URL
            );
        }
        for base in [
            "https://api.dev.hypercli.com/agents",
            "https://api.agents.dev.hypercli.com",
            "https://api.dev.hyperclaw.app",
            "https://dev-api.hyperclaw.app",
        ] {
            assert_eq!(
                default_hyper_acp_ws_url(base).unwrap(),
                crate::types::DEV_HYPER_ACP_WS_URL
            );
        }
        // Custom hosts keep the origin, drop a trailing /agents, gain /ws.
        assert_eq!(
            default_hyper_acp_ws_url("https://agents.example.test/agents").unwrap(),
            "wss://agents.example.test/ws"
        );
        assert_eq!(
            default_hyper_acp_ws_url("http://127.0.0.1:8443/agents").unwrap(),
            "ws://127.0.0.1:8443/ws"
        );
        assert_eq!(
            default_hyper_acp_ws_url("https://agents.example.test").unwrap(),
            "wss://agents.example.test/ws"
        );
    }

    #[test]
    fn api_base_derives_from_product_base_env_then_file() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join(".hypercli");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("config"),
            "HYPER_API_KEY=file-key\nHYPER_API_BASE=http://file.test/base\n",
        )
        .unwrap();

        let config = discover_client_config_from(&BTreeMap::new(), Some(temp.path())).unwrap();
        assert_eq!(config.api_base.as_str(), "http://file.test/base/agents");

        let env = BTreeMap::from([(
            "HYPER_API_BASE".to_owned(),
            "https://api.dev.hypercli.com".to_owned(),
        )]);
        let config = discover_client_config_from(&env, Some(temp.path())).unwrap();
        assert_eq!(
            config.api_base.as_str(),
            "https://api.dev.hypercli.com/agents"
        );
    }

    #[test]
    fn agents_base_precedes_product_derivation_and_drives_ws() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path();
        fs::write(
            dir.join("config"),
            "HYPER_API_KEY=file-key\nHYPER_AGENTS_API_BASE=https://api.dev.hypercli.com/agents///\n",
        ).unwrap();
        let mut env = BTreeMap::from([(
            "HYPER_API_BASE".to_owned(),
            "https://inference.example/prefix".to_owned(),
        )]);
        assert_eq!(
            discover_agents_api_base_from_config_dir(&env, Some(dir))
                .unwrap()
                .as_str(),
            "https://api.dev.hypercli.com/agents",
        );
        assert_eq!(
            discover_agents_ws_url_from_config_dir(&env, Some(dir))
                .unwrap()
                .as_str(),
            "wss://api.agents.dev.hypercli.com/ws",
        );
        env.insert(
            "HYPER_AGENTS_API_BASE".to_owned(),
            "http://control.example/tenant/api///".to_owned(),
        );
        assert_eq!(
            discover_agents_api_base_from_config_dir(&env, Some(dir))
                .unwrap()
                .as_str(),
            "http://control.example/tenant/agents",
        );
        assert_eq!(
            discover_agents_ws_url_from_config_dir(&env, Some(dir))
                .unwrap()
                .as_str(),
            "ws://control.example/tenant/ws",
        );
    }

    #[test]
    fn legacy_agent_key_is_last_resort() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join(".hypercli");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("agent-key.json"), r#"{"key":"legacy-key"}"#).unwrap();

        let config = discover_client_config_from(&BTreeMap::new(), Some(temp.path())).unwrap();
        assert_eq!(config.api_key.expose_secret(), "legacy-key");
    }

    #[test]
    fn discovers_http_trace_file_from_config() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join(".hypercli");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("config"),
            "HYPER_API_KEY=file-key\nHYPER_HTTP_TRACE_FILE=/tmp/hypercli-trace.jsonl\n",
        )
        .unwrap();

        let config = discover_client_config_from(&BTreeMap::new(), Some(temp.path())).unwrap();
        assert_eq!(
            config.trace_file,
            Some(PathBuf::from("/tmp/hypercli-trace.jsonl"))
        );
    }

    #[test]
    fn discovers_agents_api_base_from_config_file() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join(".hypercli");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("config"), "HYPER_API_BASE=http://file.test\n").unwrap();

        let base = discover_agents_api_base_from(&BTreeMap::new(), Some(temp.path())).unwrap();
        assert_eq!(base.as_str(), "http://file.test/agents");
    }

    #[test]
    fn discovers_agents_api_base_from_env_without_home() {
        let env = BTreeMap::from([(
            "HYPER_API_BASE".to_owned(),
            "http://env.test/base".to_owned(),
        )]);

        let base = discover_agents_api_base_from(&env, None).unwrap();
        assert_eq!(base.as_str(), "http://env.test/base/agents");
    }

    #[test]
    fn legacy_agents_overrides_are_ignored() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join(".hypercli");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("config"),
            "AGENTS_API_BASE_URL=http://file.test\nHYPERCLI_API_URL=http://legacy.test\n",
        )
        .unwrap();
        let env = BTreeMap::from([
            (
                "AGENTS_API_BASE_URL".to_owned(),
                "http://env.test/base".to_owned(),
            ),
            ("AGENTS_WS_URL".to_owned(), "wss://env.test/ws".to_owned()),
        ]);

        let base = discover_agents_api_base_from(&env, Some(temp.path())).unwrap();
        assert_eq!(base.as_str(), DEFAULT_AGENTS_API_BASE);
        let ws = discover_agents_ws_url_from(&env, Some(temp.path())).unwrap();
        assert_eq!(ws.as_str(), DEFAULT_AGENTS_WS_URL);
    }

    #[test]
    fn discovers_agents_ws_url_derived_from_product_base() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join(".hypercli");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("config"),
            "HYPER_API_BASE=https://api.dev.hypercli.com\n",
        )
        .unwrap();

        let ws = discover_agents_ws_url_from(&BTreeMap::new(), Some(temp.path())).unwrap();
        assert_eq!(ws.as_str(), "wss://api.agents.dev.hypercli.com/ws");

        let env = BTreeMap::from([(
            "HYPER_API_BASE".to_owned(),
            "http://127.0.0.1:8787".to_owned(),
        )]);
        let ws = discover_agents_ws_url_from(&env, Some(temp.path())).unwrap();
        assert_eq!(ws.as_str(), "ws://127.0.0.1:8787/ws");
    }

    #[test]
    fn save_api_base_writes_the_override_and_seen_by_discovery() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join(".hypercli");
        save_api_base_in_data_dir(&dir, "https://api.dev.hypercli.com/agents").unwrap();

        let body = fs::read_to_string(dir.join("config")).unwrap();
        assert!(body.contains("HYPER_API_BASE=https://api.dev.hypercli.com/agents"));

        let base = discover_agents_api_base_from_config_dir(&BTreeMap::new(), Some(dir.as_path()))
            .unwrap();
        assert_eq!(base.as_str(), "https://api.dev.hypercli.com/agents");
    }

    #[test]
    fn save_api_base_overwrites_and_an_empty_value_removes_only_its_own_line() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join(".hypercli");
        fs::create_dir_all(&dir).unwrap();
        fs::write(
            dir.join("config"),
            "HYPER_API_KEY=file-key\nHYPER_API_BASE=https://old.example\n",
        )
        .unwrap();

        save_api_base_in_data_dir(&dir, "  https://new.example  ").unwrap();
        let body = fs::read_to_string(dir.join("config")).unwrap();
        assert!(body.contains("HYPER_API_KEY=file-key"));
        assert!(body.contains("HYPER_API_BASE=https://new.example"));
        assert!(!body.contains("old.example"));

        save_api_base_in_data_dir(&dir, "   ").unwrap();
        let body = fs::read_to_string(dir.join("config")).unwrap();
        assert_eq!(body, "HYPER_API_KEY=file-key\n");

        // Removal from a file without the key (or no file at all) is a no-op.
        save_api_base_in_data_dir(&dir, "").unwrap();
        save_api_base_in_data_dir(&temp.path().join("absent"), "").unwrap();
        assert!(!temp.path().join("absent/config").exists());
    }

    #[test]
    #[cfg(unix)]
    fn save_api_base_keeps_the_config_owner_only() {
        use std::os::unix::fs::PermissionsExt;
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join(".hypercli");
        save_api_base_in_data_dir(&dir, "https://api.dev.hypercli.com/agents").unwrap();

        let mode = fs::metadata(dir.join("config"))
            .unwrap()
            .permissions()
            .mode();
        assert_eq!(mode & 0o777, 0o600);
    }

    #[test]
    fn agents_ws_url_defaults_to_agents_host() {
        let ws = discover_agents_ws_url_from(&BTreeMap::new(), None).unwrap();
        assert_eq!(ws.as_str(), DEFAULT_AGENTS_WS_URL);
    }

    #[test]
    fn normalize_agents_ws_url_swaps_scheme_and_appends_ws_suffix() {
        assert_eq!(
            normalize_agents_ws_url("https://example.com/agents")
                .unwrap()
                .as_str(),
            "wss://example.com/agents/ws"
        );
        assert_eq!(
            normalize_agents_ws_url("http://127.0.0.1:8787/agents")
                .unwrap()
                .as_str(),
            "ws://127.0.0.1:8787/agents/ws"
        );
        assert_eq!(
            normalize_agents_ws_url("wss://example.com/agents/ws/")
                .unwrap()
                .as_str(),
            "wss://example.com/agents/ws"
        );
        assert!(normalize_agents_ws_url("").is_err());
        assert!(normalize_agents_ws_url("ftp://example.com/ws").is_err());
    }

    #[test]
    fn hyper_home_is_data_dir_and_suppresses_default_home_config() {
        let temp = tempfile::tempdir().unwrap();
        let real_home = temp.path().join("home");
        let hyper_home = temp.path().join("custom-data");
        fs::create_dir_all(real_home.join(".hypercli")).unwrap();
        fs::create_dir_all(&hyper_home).unwrap();
        fs::write(
            real_home.join(".hypercli/config"),
            "HYPER_API_KEY=home-key\n",
        )
        .unwrap();
        fs::write(hyper_home.join("config"), "HYPER_API_KEY=hyper-home-key\n").unwrap();
        let env = BTreeMap::from([(
            "HYPER_HOME".to_owned(),
            hyper_home.to_string_lossy().to_string(),
        )]);

        let config = discover_client_config_from(&env, Some(real_home.as_path())).unwrap();
        assert_eq!(config.api_key.expose_secret(), "hyper-home-key");
    }

    #[test]
    fn missing_hyper_home_config_does_not_read_default_home_config() {
        let temp = tempfile::tempdir().unwrap();
        let real_home = temp.path().join("home");
        let hyper_home = temp.path().join("custom-data");
        fs::create_dir_all(real_home.join(".hypercli")).unwrap();
        fs::create_dir_all(&hyper_home).unwrap();
        fs::write(
            real_home.join(".hypercli/config"),
            "HYPER_API_KEY=home-key\n",
        )
        .unwrap();
        let env = BTreeMap::from([(
            "HYPER_HOME".to_owned(),
            hyper_home.to_string_lossy().to_string(),
        )]);

        assert!(matches!(
            discover_client_config_from(&env, Some(real_home.as_path())),
            Err(ConfigError::MissingCredential)
        ));
    }

    #[test]
    fn managed_agent_env_is_final_fallback_after_file_config() {
        let temp = tempfile::tempdir().unwrap();
        let dir = temp.path().join(".hypercli");
        fs::create_dir_all(&dir).unwrap();
        fs::write(dir.join("config"), "HYPER_API_KEY=file-key\n").unwrap();
        let env = BTreeMap::from([(
            "HYPER_AGENTS_API_KEY".to_owned(),
            "agent-env-key".to_owned(),
        )]);

        let config = discover_client_config_from(&env, Some(temp.path())).unwrap();
        assert_eq!(config.api_key.expose_secret(), "file-key");
    }

    #[test]
    fn normalizes_product_and_custom_api_urls() {
        assert_eq!(
            normalize_agents_api_base("https://api.hypercli.com")
                .unwrap()
                .as_str(),
            DEFAULT_AGENTS_API_BASE
        );
        assert_eq!(
            normalize_agents_api_base("http://localhost:8000/api")
                .unwrap()
                .as_str(),
            "http://localhost:8000/agents"
        );
    }

    #[test]
    fn accepts_scheme_less_input() {
        assert_eq!(
            normalize_agents_api_base("api.hypercli.com")
                .unwrap()
                .as_str(),
            DEFAULT_AGENTS_API_BASE
        );
        assert_eq!(
            normalize_agents_api_base("custom.example.com")
                .unwrap()
                .as_str(),
            "https://custom.example.com/agents"
        );
    }

    #[test]
    fn agents_path_is_preserved_even_on_alias_hosts() {
        assert_eq!(
            normalize_agents_api_base("https://api.dev.hyperclaw.app/agents")
                .unwrap()
                .as_str(),
            "https://api.dev.hyperclaw.app/agents"
        );
        assert_eq!(
            normalize_agents_api_base("https://api.hyperclaw.app/v2/agents/")
                .unwrap()
                .as_str(),
            "https://api.hyperclaw.app/v2/agents"
        );
    }

    #[test]
    fn api_suffix_is_rewritten_with_alias_special_cases() {
        assert_eq!(
            normalize_agents_api_base("https://custom.example.com/v1/api")
                .unwrap()
                .as_str(),
            "https://custom.example.com/v1/agents"
        );
        assert_eq!(
            normalize_agents_api_base("https://api.agents.hypercli.com/api")
                .unwrap()
                .as_str(),
            DEFAULT_AGENTS_API_BASE
        );
        assert_eq!(
            normalize_agents_api_base("https://api.agents.dev.hypercli.com/api")
                .unwrap()
                .as_str(),
            "https://api.dev.hypercli.com/agents"
        );
    }

    #[test]
    fn bare_alias_hosts_map_to_defaults() {
        for host in [
            "https://api.agents.hypercli.com",
            "https://api.hyperclaw.app",
        ] {
            assert_eq!(
                normalize_agents_api_base(host).unwrap().as_str(),
                DEFAULT_AGENTS_API_BASE
            );
        }
        for host in [
            "https://api.agents.dev.hypercli.com",
            "https://api.dev.hypercli.com",
            "https://api.dev.hyperclaw.app",
            "https://dev-api.hyperclaw.app",
        ] {
            assert_eq!(
                normalize_agents_api_base(host).unwrap().as_str(),
                "https://api.dev.hypercli.com/agents"
            );
        }
    }

    #[test]
    fn empty_input_yields_default_base() {
        assert_eq!(
            normalize_agents_api_base("").unwrap().as_str(),
            DEFAULT_AGENTS_API_BASE
        );
        assert_eq!(
            normalize_agents_api_base("   ").unwrap().as_str(),
            DEFAULT_AGENTS_API_BASE
        );
    }

    #[test]
    fn query_and_fragment_are_stripped() {
        assert_eq!(
            normalize_agents_api_base("http://env.test/base?x=1#frag")
                .unwrap()
                .as_str(),
            "http://env.test/base/agents"
        );
    }

    // LOCKSTEP cross-SDK byte-match vector table, mirrored with py-sdk
    // (tests/test_config.py `_LOCKSTEP_URL_VECTORS`) and ts-sdk
    // (agent-urls.ts: resolveAgentsApiBase / defaultAgentsWsUrl /
    // agentsAdminApiBaseFromProductBase). Every row must produce
    // byte-identical output in all three SDKs: host case is lowercased,
    // default ports are stripped, non-default ports are preserved, and
    // trailing slashes collapse before derivation.
    // Columns: (input, agents_api_base, agents_ws_url, agents_admin_base).
    const LOCKSTEP_URL_VECTORS: [(&str, &str, &str, &str); 20] = [
        (
            "",
            "https://api.hypercli.com/agents",
            "wss://api.agents.hypercli.com/ws",
            "https://api.agents.hypercli.com",
        ),
        (
            "https://api.hypercli.com",
            "https://api.hypercli.com/agents",
            "wss://api.agents.hypercli.com/ws",
            "https://api.agents.hypercli.com",
        ),
        (
            "https://api.hyperclaw.app",
            "https://api.hypercli.com/agents",
            "wss://api.agents.hypercli.com/ws",
            "https://api.agents.hypercli.com",
        ),
        (
            "https://api.agents.hypercli.com",
            "https://api.hypercli.com/agents",
            "wss://api.agents.hypercli.com/ws",
            "https://api.agents.hypercli.com",
        ),
        (
            "api.hypercli.com",
            "https://api.hypercli.com/agents",
            "wss://api.agents.hypercli.com/ws",
            "https://api.agents.hypercli.com",
        ),
        (
            "https://api.dev.hypercli.com",
            "https://api.dev.hypercli.com/agents",
            "wss://api.agents.dev.hypercli.com/ws",
            "https://api.agents.dev.hypercli.com",
        ),
        (
            "https://api.dev.hyperclaw.app",
            "https://api.dev.hypercli.com/agents",
            "wss://api.agents.dev.hypercli.com/ws",
            "https://api.agents.dev.hypercli.com",
        ),
        (
            "https://dev-api.hyperclaw.app",
            "https://api.dev.hypercli.com/agents",
            "wss://api.agents.dev.hypercli.com/ws",
            "https://api.agents.dev.hypercli.com",
        ),
        (
            "api.agents.dev.hypercli.com",
            "https://api.dev.hypercli.com/agents",
            "wss://api.agents.dev.hypercli.com/ws",
            "https://api.agents.dev.hypercli.com",
        ),
        (
            "https://api.hypercli.com:443/agents",
            "https://api.hypercli.com/agents",
            "wss://api.agents.hypercli.com/ws",
            "https://api.agents.hypercli.com",
        ),
        (
            "HTTPS://API.HYPERCLI.COM",
            "https://api.hypercli.com/agents",
            "wss://api.agents.hypercli.com/ws",
            "https://api.agents.hypercli.com",
        ),
        (
            "https://API.AGENTS.HYPERCLI.COM/api",
            "https://api.hypercli.com/agents",
            "wss://api.agents.hypercli.com/ws",
            "https://api.agents.hypercli.com",
        ),
        (
            "https://staging.eu.example.com",
            "https://staging.eu.example.com/agents",
            "wss://staging.eu.example.com/ws",
            "https://staging.eu.example.com",
        ),
        (
            "https://staging.example.com:8443",
            "https://staging.example.com:8443/agents",
            "wss://staging.example.com:8443/ws",
            "https://staging.example.com:8443",
        ),
        (
            "https://edge.example.com/api",
            "https://edge.example.com/agents",
            "wss://edge.example.com/ws",
            "https://edge.example.com",
        ),
        (
            "https://edge.example.com/agents",
            "https://edge.example.com/agents",
            "wss://edge.example.com/ws",
            "https://edge.example.com",
        ),
        (
            "https://edge.example.com/agents/",
            "https://edge.example.com/agents",
            "wss://edge.example.com/ws",
            "https://edge.example.com",
        ),
        (
            "http://127.0.0.1:8080",
            "http://127.0.0.1:8080/agents",
            "ws://127.0.0.1:8080/ws",
            "http://127.0.0.1:8080",
        ),
        (
            "http://127.0.0.1:80/api",
            "http://127.0.0.1/agents",
            "ws://127.0.0.1/ws",
            "http://127.0.0.1",
        ),
        (
            "https://edge.example.com/agents/admin",
            "https://edge.example.com/agents/admin/agents",
            "wss://edge.example.com/agents/admin/ws",
            "https://edge.example.com",
        ),
    ];

    #[test]
    fn agents_url_lockstep_vectors_byte_match_cross_sdk() {
        for (product_base, api_base, ws_url, admin_base) in LOCKSTEP_URL_VECTORS {
            assert_eq!(
                normalize_agents_api_base(product_base).unwrap().as_str(),
                api_base,
                "agents api base for {product_base:?}"
            );
            assert_eq!(
                agents_ws_url_from_product_base(product_base)
                    .unwrap()
                    .as_str(),
                ws_url,
                "agents ws url for {product_base:?}"
            );
            assert_eq!(
                agents_admin_base_url_from_product_base(product_base).unwrap(),
                admin_base,
                "agents admin base for {product_base:?}"
            );
        }
    }

    #[test]
    fn scheme_less_custom_host_carries_implied_https_scheme() {
        // Documented divergence from py/ts (mirrored by py
        // `test_agents_url_vectors_schemeless_custom_host_echoes_raw_input`):
        // they echo scheme-less custom input verbatim while the typed `Url`
        // output here carries the implied `https://` prefix, so these inputs
        // stay out of the shared LOCKSTEP table.
        assert_eq!(
            normalize_agents_api_base("staging.eu.example.com")
                .unwrap()
                .as_str(),
            "https://staging.eu.example.com/agents"
        );
        // The WS/admin derivations re-normalize their input in every SDK,
        // upgrading the scheme-less echo to the implied https<->wss scheme —
        // these three byte-match py/ts anyway.
        assert_eq!(
            agents_ws_url_from_product_base("staging.eu.example.com")
                .unwrap()
                .as_str(),
            "wss://staging.eu.example.com/ws"
        );
        assert_eq!(
            agents_admin_base_url_from_product_base("staging.eu.example.com").unwrap(),
            "https://staging.eu.example.com"
        );
    }

    #[test]
    fn ipv6_hosts_keep_brackets_and_ports_cross_sdk() {
        // Not an alias host, so py's raw-echo fallback and the typed `Url`
        // output byte-match (`url::Url` keeps the brackets; the normalized
        // netloc re-wraps them for the admin string).
        assert_eq!(
            normalize_agents_api_base("http://[::1]:8080")
                .unwrap()
                .as_str(),
            "http://[::1]:8080/agents"
        );
        assert_eq!(
            agents_ws_url_from_product_base("http://[::1]:8080")
                .unwrap()
                .as_str(),
            "ws://[::1]:8080/ws"
        );
        assert_eq!(
            agents_admin_base_url_from_product_base("http://[::1]:8080").unwrap(),
            "http://[::1]:8080"
        );
        // Default-port IPv6 input strips the port everywhere.
        assert_eq!(
            agents_admin_base_url_from_product_base("http://[::1]:80/api").unwrap(),
            "http://[::1]"
        );
    }

    #[test]
    fn default_port_on_alias_host_still_maps_to_defaults() {
        // `url::Url::port()` suppresses the scheme-default port, so the
        // alias-host compare succeeds and `/agents` is derived.
        assert_eq!(
            normalize_agents_api_base("https://api.hypercli.com:443")
                .unwrap()
                .as_str(),
            DEFAULT_AGENTS_API_BASE
        );
        assert_eq!(
            normalize_agents_api_base("https://api.dev.hypercli.com:443")
                .unwrap()
                .as_str(),
            "https://api.dev.hypercli.com/agents"
        );
        // A non-default port never matches an alias host.
        assert_eq!(
            normalize_agents_api_base("https://api.hypercli.com:8443")
                .unwrap()
                .as_str(),
            "https://api.hypercli.com:8443/agents"
        );
    }
}
