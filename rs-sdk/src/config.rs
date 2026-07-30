use std::collections::BTreeMap;
use std::fs;
use std::path::{Path, PathBuf};

use secrecy::SecretString;
use thiserror::Error;
use url::Url;

const DEFAULT_AGENTS_API_BASE: &str = "https://api.hypercli.com/agents";
const MAX_CREDENTIAL_FILE_BYTES: u64 = 64 * 1024;

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

    let configured_key = first_nonempty([
        env.get("HYPER_AGENTS_API_KEY"),
        env.get("HYPER_API_KEY"),
        env.get("HYPERCLI_API_KEY"),
        file_config.get("HYPER_AGENTS_API_KEY"),
        file_config.get("HYPER_API_KEY"),
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

    let configured_base = first_nonempty([
        env.get("AGENTS_API_BASE_URL"),
        file_config.get("AGENTS_API_BASE_URL"),
        env.get("HYPER_API_BASE"),
        file_config.get("HYPER_API_BASE"),
        env.get("HYPERCLI_API_URL"),
        file_config.get("HYPERCLI_API_URL"),
    ])
    .unwrap_or(DEFAULT_AGENTS_API_BASE);
    let trace_file = first_nonempty([
        env.get("HYPER_HTTP_TRACE_FILE"),
        file_config.get("HYPER_HTTP_TRACE_FILE"),
    ])
    .map(PathBuf::from);

    Ok(ClientConfig {
        api_base: normalize_agents_api_base(configured_base)?,
        api_key: SecretString::from(api_key),
        trace_file,
    })
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

pub fn normalize_agents_api_base(raw: &str) -> Result<Url, ConfigError> {
    let input = raw.trim().trim_end_matches('/');
    let mut parsed = Url::parse(input).map_err(|_| ConfigError::InvalidApiBase)?;
    if !matches!(parsed.scheme(), "http" | "https") || parsed.host_str().is_none() {
        return Err(ConfigError::InvalidApiBase);
    }

    let host = parsed.host_str().unwrap_or_default().to_ascii_lowercase();
    if matches!(
        host.as_str(),
        "api.agents.hypercli.com" | "api.hypercli.com" | "api.hyperclaw.app"
    ) {
        return Url::parse(DEFAULT_AGENTS_API_BASE).map_err(|_| ConfigError::InvalidApiBase);
    }
    if matches!(
        host.as_str(),
        "api.agents.dev.hypercli.com"
            | "api.dev.hypercli.com"
            | "api.dev.hyperclaw.app"
            | "dev-api.hyperclaw.app"
    ) {
        return Url::parse("https://api.dev.hypercli.com/agents")
            .map_err(|_| ConfigError::InvalidApiBase);
    }

    let path = parsed.path().trim_end_matches('/');
    let normalized_path = if path.ends_with("/agents") {
        path.to_owned()
    } else if path.ends_with("/api") {
        format!("{}/agents", path.trim_end_matches("/api"))
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
}
