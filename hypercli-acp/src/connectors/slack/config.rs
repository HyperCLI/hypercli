use std::env;

use thiserror::Error;
use url::Url;

#[derive(Debug, Clone, PartialEq, Eq)]
pub struct SlackRelayConfig {
    pub enabled: bool,
    pub agents_api_key: String,
    pub relay_url: Url,
    pub api_url: Url,
    pub gateway_id: String,
}

#[derive(Debug, Error, PartialEq, Eq)]
pub enum SlackRelayConfigError {
    #[error("HYPER_SLACK_APP_ENABLED is disabled")]
    Disabled,
    #[error("{0} is required when HYPER_SLACK_APP_ENABLED is enabled")]
    Missing(&'static str),
    #[error("{name} is not a valid URL: {source}")]
    InvalidUrl {
        name: &'static str,
        source: url::ParseError,
    },
}

impl SlackRelayConfig {
    pub fn from_env() -> Result<Self, SlackRelayConfigError> {
        let enabled = env_enabled("HYPER_SLACK_APP_ENABLED");
        if !enabled {
            return Err(SlackRelayConfigError::Disabled);
        }

        let agents_api_key = required_env("HYPER_AGENTS_API_KEY")?;
        let relay_url = required_url("HYPER_SLACK_RELAY_URL")?;
        let api_url = required_url("HYPER_SLACK_API_URL")?;
        let gateway_id = required_env("HYPER_SLACK_GATEWAY_ID")?;

        Ok(Self {
            enabled,
            agents_api_key,
            relay_url,
            api_url,
            gateway_id,
        })
    }
}

fn env_enabled(name: &'static str) -> bool {
    let Ok(value) = env::var(name) else {
        return false;
    };
    matches!(
        value.trim().to_ascii_lowercase().as_str(),
        "1" | "true" | "yes" | "on"
    )
}

fn required_env(name: &'static str) -> Result<String, SlackRelayConfigError> {
    env::var(name)
        .ok()
        .map(|value| value.trim().to_owned())
        .filter(|value| !value.is_empty())
        .ok_or(SlackRelayConfigError::Missing(name))
}

fn required_url(name: &'static str) -> Result<Url, SlackRelayConfigError> {
    let raw = required_env(name)?;
    Url::parse(&raw).map_err(|source| SlackRelayConfigError::InvalidUrl { name, source })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::Mutex;

    static ENV_LOCK: Mutex<()> = Mutex::new(());

    fn clear_env() {
        for name in [
            "HYPER_SLACK_APP_ENABLED",
            "HYPER_AGENTS_API_KEY",
            "HYPER_SLACK_RELAY_URL",
            "HYPER_SLACK_API_URL",
            "HYPER_SLACK_GATEWAY_ID",
        ] {
            env::remove_var(name);
        }
    }

    #[test]
    fn disabled_without_flag() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_env();
        assert_eq!(
            SlackRelayConfig::from_env().unwrap_err(),
            SlackRelayConfigError::Disabled
        );
    }

    #[test]
    fn requires_hypercli_relay_env_when_enabled() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_env();
        env::set_var("HYPER_SLACK_APP_ENABLED", "1");
        assert_eq!(
            SlackRelayConfig::from_env().unwrap_err(),
            SlackRelayConfigError::Missing("HYPER_AGENTS_API_KEY")
        );
    }

    #[test]
    fn loads_hosted_relay_config() {
        let _guard = ENV_LOCK.lock().unwrap();
        clear_env();
        env::set_var("HYPER_SLACK_APP_ENABLED", "true");
        env::set_var("HYPER_AGENTS_API_KEY", "runtime-key");
        env::set_var("HYPER_SLACK_RELAY_URL", "wss://api.example.com/slack/ws");
        env::set_var("HYPER_SLACK_API_URL", "https://api.example.com/slack/api/");
        env::set_var("HYPER_SLACK_GATEWAY_ID", "agent:123");

        let config = SlackRelayConfig::from_env().unwrap();
        assert!(config.enabled);
        assert_eq!(config.agents_api_key, "runtime-key");
        assert_eq!(config.gateway_id, "agent:123");
        assert_eq!(config.relay_url.as_str(), "wss://api.example.com/slack/ws");
        assert_eq!(
            config.api_url.as_str(),
            "https://api.example.com/slack/api/"
        );

        clear_env();
    }
}
