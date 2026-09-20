use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};
use std::time::Duration;

use secrecy::SecretString;
use thiserror::Error;
use url::Url;

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

/// Remove every API-key entry from `<data_dir>/config`, preserving
/// other lines, and delete the legacy `agent-key.json` credential so a
/// logout is complete.
pub fn remove_config_api_keys_in_data_dir(data_dir: &Path) -> Result<(), ConfigError> {
    let path = data_dir.join("config");
    if let Ok(existing) = fs::read_to_string(&path) {
        let remaining: Vec<&str> = existing
            .lines()
            .filter(|line| match line.trim().split_once('=') {
                Some((key, _)) => {
                    !API_KEY_CONFIG_KEYS.contains(&key.trim())
                        && !REMOVED_API_KEY_CONFIG_KEYS.contains(&key.trim())
                }
                None => true,
            })
            .collect();
        let mut content = remaining.join("\n");
        if !content.is_empty() {
            content.push('\n');
        }
        fs::write(&path, content).map_err(|_| ConfigError::ConfigWrite)?;
    }
    let _ = fs::remove_file(data_dir.join("agent-key.json"));
    Ok(())
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
    let configured_base = first_nonempty([
        env.get("AGENTS_API_BASE_URL"),
        file_config.get("AGENTS_API_BASE_URL"),
        env.get("HYPER_API_BASE"),
        file_config.get("HYPER_API_BASE"),
        env.get("HYPERCLI_API_URL"),
        file_config.get("HYPERCLI_API_URL"),
    ])
    .unwrap_or(DEFAULT_AGENTS_API_BASE);
    normalize_agents_api_base(configured_base)
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
        .filter_map(|line| line.split_once('='))
        .map(|(key, value)| (key.trim().to_owned(), value.trim().to_owned()))
        .collect())
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
    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    let netloc = match parsed.port() {
        Some(port) => format!("{host}:{port}"),
        None => host,
    };

    let path = parsed.path().trim_end_matches('/').to_owned();
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

#[cfg(test)]
mod tests {
    use super::*;
    use secrecy::ExposeSecret;

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
        assert_eq!(config.api_base.as_str(), "http://env.test/base/agents");
        assert_eq!(config.trace_file, None);
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
        fs::write(dir.join("config"), "AGENTS_API_BASE_URL=http://file.test\n").unwrap();

        let base = discover_agents_api_base_from(&BTreeMap::new(), Some(temp.path())).unwrap();
        assert_eq!(base.as_str(), "http://file.test/agents");
    }

    #[test]
    fn discovers_agents_api_base_from_env_without_home() {
        let env = BTreeMap::from([(
            "AGENTS_API_BASE_URL".to_owned(),
            "http://env.test/base".to_owned(),
        )]);

        let base = discover_agents_api_base_from(&env, None).unwrap();
        assert_eq!(base.as_str(), "http://env.test/base/agents");
    }

    #[test]
    fn hyper_home_is_data_dir_and_suppresses_default_home_config() {
        let temp = tempfile::tempdir().unwrap();
        let real_home = temp.path().join("home");
        let hyper_home = temp.path().join("custom-data");
        fs::create_dir_all(real_home.join(".hypercli")).unwrap();
        fs::create_dir_all(&hyper_home).unwrap();
        fs::write(real_home.join(".hypercli/config"), "HYPER_API_KEY=home-key\n").unwrap();
        fs::write(
            hyper_home.join("config"),
            "HYPER_API_KEY=hyper-home-key\n",
        )
        .unwrap();
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
        fs::write(real_home.join(".hypercli/config"), "HYPER_API_KEY=home-key\n").unwrap();
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
}
