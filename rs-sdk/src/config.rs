use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use secrecy::SecretString;
use thiserror::Error;
use url::Url;

pub const DEFAULT_AGENTS_API_BASE: &str = "https://api.hypercli.com/agents";
const MAX_CREDENTIAL_FILE_BYTES: u64 = 64 * 1024;

/// Key names accepted for the API credential, in precedence order.
pub const API_KEY_CONFIG_KEYS: [&str; 3] =
    ["HYPER_AGENTS_API_KEY", "HYPER_API_KEY", "HYPERCLI_API_KEY"];

pub struct ClientConfig {
    pub api_base: Url,
    pub api_key: SecretString,
    pub trace_file: Option<PathBuf>,
}

#[derive(Debug, Error)]
pub enum ConfigError {
    #[error(
        "no HyperCLI credential found; set HYPER_AGENTS_API_KEY or HYPER_API_KEY, \
         run `hyper configure`, or run `hyper agent login`"
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

/// Upsert KEY=VALUE lines in `<home>/.hypercli/config` (created 0600 on
/// Unix), preserving unrelated lines.
pub fn write_config_values(
    home: &Path,
    values: &BTreeMap<String, String>,
) -> Result<(), ConfigError> {
    let dir = home.join(".hypercli");
    fs::create_dir_all(&dir).map_err(|_| ConfigError::ConfigWrite)?;
    let path = dir.join("config");
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
    let mut values = BTreeMap::new();
    values.insert("HYPER_API_KEY".to_owned(), api_key.trim().to_owned());
    write_config_values(home, &values)
}

/// Remove every API-key entry from `<home>/.hypercli/config`, preserving
/// other lines, and delete the legacy `agent-key.json` credential so a
/// logout is complete.
pub fn remove_config_api_keys(home: &Path) -> Result<(), ConfigError> {
    let dir = home.join(".hypercli");
    let path = dir.join("config");
    if let Ok(existing) = fs::read_to_string(&path) {
        let remaining: Vec<&str> = existing
            .lines()
            .filter(|line| match line.trim().split_once('=') {
                Some((key, _)) => !API_KEY_CONFIG_KEYS.contains(&key.trim()),
                None => true,
            })
            .collect();
        let mut content = remaining.join("\n");
        if !content.is_empty() {
            content.push('\n');
        }
        fs::write(&path, content).map_err(|_| ConfigError::ConfigWrite)?;
    }
    let _ = fs::remove_file(dir.join("agent-key.json"));
    Ok(())
}

pub fn discover_client_config() -> Result<ClientConfig, ConfigError> {
    let env: BTreeMap<String, String> = std::env::vars().collect();
    let home = dirs::home_dir();
    discover_client_config_from(&env, home.as_deref())
}

/// Deterministic credential discovery seam used by the provider and tests.
///
/// Precedence matches the Python CLI: agent env, product env, canonical
/// `~/.hypercli/config`, then the legacy `agent-key.json`.
pub fn discover_client_config_from(
    env: &BTreeMap<String, String>,
    home: Option<&Path>,
) -> Result<ClientConfig, ConfigError> {
    let file_config = match home {
        Some(home) => load_kv_file(&home.join(".hypercli").join("config"))?,
        None => BTreeMap::new(),
    };

    // Per-key env-then-file precedence, matching the Python CLI's
    // get_config_value semantics.
    let configured_key = first_nonempty([
        env.get("HYPER_AGENTS_API_KEY"),
        file_config.get("HYPER_AGENTS_API_KEY"),
        env.get("HYPER_API_KEY"),
        file_config.get("HYPER_API_KEY"),
        env.get("HYPERCLI_API_KEY"),
        file_config.get("HYPERCLI_API_KEY"),
    ])
    .map(ToOwned::to_owned);
    let api_key = match configured_key {
        Some(key) => key,
        None => match home {
            Some(home) => load_legacy_agent_key(&home.join(".hypercli/agent-key.json"))?
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
    })
}

/// Resolve the agents API base URL from env and `<home>/.hypercli/config`
/// without requiring a credential — for flows that authenticate with a
/// short-lived token (e.g. the desktop app's key mint) but must still honor
/// the caller's configured backend.
pub fn discover_agents_api_base() -> Result<Url, ConfigError> {
    let env: BTreeMap<String, String> = std::env::vars().collect();
    let file_config = match dirs::home_dir() {
        Some(home) => load_kv_file(&home.join(".hypercli").join("config"))?,
        None => BTreeMap::new(),
    };
    discover_api_base(&env, &file_config)
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
    fn environment_precedes_files_and_legacy_key() {
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
            ("HYPER_AGENTS_API_KEY".to_owned(), "env-key".to_owned()),
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
